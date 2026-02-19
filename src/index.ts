/**
 * @module
 *
 * The main entry point for `@quill/proteus` — a fast, format-agnostic front
 * matter parser for YAML, TOML, and JSON.
 *
 * Provides {@linkcode parseFrontMatter} (async) and
 * {@linkcode parseFrontMatterSync} for parsing, {@linkcode hasFrontMatter} for
 * detection, {@linkcode stringifyFrontMatter} for serialisation, and
 * file-based helpers such as {@linkcode readFrontMatter}.
 *
 * @example
 * ```ts
 * import { parseFrontMatter } from "@quill/proteus";
 *
 * const result = await parseFrontMatter("---\ntitle: Hello\n---\n# Body");
 * console.log(result.data); // { title: "Hello" }
 * ```
 */

import type { DetectionResult } from "./detector.js";
import { detectFormatWithPreparsed } from "./detector.js";
import { extractExcerpt } from "./excerpt.js";
import { extractFrontMatter } from "./extractor.js";
import { createParserAdapter } from "./parsers.js";
import { sanitizeKeys } from "./sanitizer.js";
import type {
  DelimiterPair,
  ExcerptOptions,
  ExtractionResult,
  FrontMatterFormat,
  ParseResult,
  ParseResultEmpty,
  ParseResultError,
  ParseResultSuccess,
} from "./types.js";
import { DEFAULT_DELIMITERS, FrontMatterError } from "./types.js";
import type { WasmParsers } from "./wasm-loader.js";
import { getWasmParsers, getWasmParsersSync } from "./wasm-loader.js";

// ---------------------------------------------------------------------------
// Lazy-loaded validator (avoids requiring valibot at import time)
// ---------------------------------------------------------------------------

/** Valibot GenericSchema — declared locally to avoid requiring valibot at import time. */
type AnySchema = { readonly "~standard": unknown };

let _validateFn: ((data: unknown, schema: AnySchema) => unknown) | null = null;

/** Load the validator module on demand and cache it. */
async function lazyValidate<T>(data: unknown, schema: AnySchema): Promise<T> {
  if (!_validateFn) {
    const mod = await import("./validator.js");
    _validateFn = mod.validate as (data: unknown, schema: AnySchema) => unknown;
  }
  const fn = _validateFn;
  return fn(data, schema) as T;
}

/** Use the cached validator synchronously. Throws if not yet loaded. */
function lazyValidateSync<T>(data: unknown, schema: AnySchema): T {
  if (!_validateFn) {
    throw new FrontMatterError(
      "Schema validation in sync mode requires the validator to be pre-loaded. " +
        "Call `parseFrontMatter()` once with a schema first, or " +
        "pre-load with: await import('@quill/proteus/validator')",
    );
  }
  return _validateFn(data, schema) as T;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed input size in bytes (1 MB).
 * Both the TS layer and the Rust WASM layer enforce the same byte-level limit. */
const MAX_INPUT_SIZE = 1_048_576;

/** Maximum HTTP response size to read into memory (2 MB).
 * Prevents memory exhaustion from large remote responses before the parse-level check. */
const MAX_FETCH_SIZE = 2_097_152;

/** Default HTTP fetch timeout in milliseconds (30 seconds). */
const FETCH_TIMEOUT_MS = 30_000;

/** Maximum number of concurrent fetch requests for `readFrontMatterMany`. */
const MAX_CONCURRENCY = 8;

/**
 * Byte length of a string (UTF-8).
 *
 * Uses `TextEncoder` which is available in all target runtimes
 * (Bun, Deno, Cloudflare Workers, modern browsers).
 */
const byteLength: (s: string) => number = (() => {
  const encoder = new TextEncoder();
  return (s: string): number => encoder.encode(s).byteLength;
})();

// ---------------------------------------------------------------------------
// Quick detection
// ---------------------------------------------------------------------------

/**
 * Check whether a string contains a front matter block.
 *
 * This is a **fast, zero-cost** check — it does not load WASM, does not parse
 * the data, and performs only minimal string matching.
 *
 * Useful for filtering files before calling the full `parseFrontMatter()` pipeline.
 *
 * @example
 * ```ts
 * import { hasFrontMatter } from "@quill/proteus";
 *
 * if (hasFrontMatter(source)) {
 *   const result = await parseFrontMatter(source);
 * }
 * ```
 */
export function hasFrontMatter(
  source: string,
  delimiters: readonly DelimiterPair[] = DEFAULT_DELIMITERS,
): boolean {
  if (!source) return false;

  // Validate delimiter pairs (consistent with extractFrontMatter).
  for (const { open, close } of delimiters) {
    if (!open || !close) {
      throw new FrontMatterError(
        "Invalid delimiter pair: both open and close must be non-empty strings.",
      );
    }
  }

  // Strip BOM for consistency with extractFrontMatter.
  const s = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

  for (const { open, close } of delimiters) {
    if (s.startsWith(`${open}\n`) || s.startsWith(`${open}\r\n`)) {
      // Look for the closing delimiter on its own line, followed by \n, \r\n or EOF.
      const openEnd = s[open.length] === "\r" ? open.length + 2 : open.length + 1;
      let pos = openEnd - 1;
      for (;;) {
        let idx = s.indexOf(`\n${close}`, pos);
        if (idx === -1) {
          idx = s.indexOf(`\r\n${close}`, pos);
          if (idx !== -1) idx += 1;
        }
        if (idx === -1) break;
        const afterClose = idx + 1 + close.length;
        if (
          afterClose >= s.length ||
          s[afterClose] === "\n" ||
          (s[afterClose] === "\r" && s[afterClose + 1] === "\n")
        ) {
          return true;
        }
        pos = idx + 1;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for `parseFrontMatter` and `parseFrontMatterSync`.
 */
export interface ParseOptions {
  /**
   * Optional Valibot schema to validate the parsed data against.
   * When provided, the returned `data` is typed & validated.
   *
   * Note: without a schema, the generic `T` is unchecked at runtime —
   * the caller is responsible for ensuring the cast is sound.
   */
  schema?: AnySchema;

  /**
   * Force a specific format instead of relying on auto-detection.
   */
  format?: FrontMatterFormat;

  /**
   * Custom delimiter pairs to try when extracting front matter.
   * Defaults to `[{ open: "---", close: "---" }, { open: "---", close: "..." }, { open: "+++", close: "+++" }]`.
   */
  delimiters?: DelimiterPair[];

  /**
   * When `false`, **parse and validation** errors are caught and returned
   * as `result.error` instead of throwing.  The `result.data` will be `{}`.
   *
   * **Note:** Extraction errors (e.g. unclosed delimiters) are structural
   * and always throw, regardless of this setting.
   *
   * @default true
   */
  strict?: boolean;

  /**
   * Extract an excerpt from the content.
   * - `true` — Use default separator `<!-- more -->`, fallback to first paragraph.
   * - `{ separator: "..." }` — Use custom separator.
   *
   * @default false
   */
  excerpt?: boolean | ExcerptOptions;
}

/**
 * Parse front matter from a Markdown source string (async).
 *
 * Pipeline: extract → detect format → parse via WASM → validate (optional).
 *
 * The WASM module is lazily loaded on first call and cached.
 *
 * @example
 * ```ts
 * import { parseFrontMatter } from "@quill/proteus";
 *
 * const result = await parseFrontMatter(`---
 * title: Hello World
 * ---
 * # Content here`);
 *
 * console.log(result.data);    // { title: "Hello World" }
 * console.log(result.format);  // "yaml"
 * console.log(result.content); // "# Content here"
 * ```
 *
 * @remarks
 * Synchronous parsing errors are caught inside the try/catch block and
 * handled according to the `strict` option, giving consumers a uniform
 * error-handling path.
 */
export async function parseFrontMatter<T = Record<string, unknown>>(
  source: string,
  options?: ParseOptions,
): Promise<ParseResult<T>> {
  return parseFrontMatterCore<T>(source, options, {
    getWasm: () => getWasmParsers(),
    validate: (data, schema) => lazyValidate<T>(data, schema),
  });
}

/**
 * Parse front matter synchronously.
 *
 * **Requires** `await initWasm()` to have been called first.
 *
 * @throws {Error} if WASM module is not initialized.
 *
 * @example
 * ```ts
 * import { initWasm, parseFrontMatterSync } from "@quill/proteus";
 *
 * await initWasm(); // once at startup
 * const result = parseFrontMatterSync(source);
 * ```
 */
export function parseFrontMatterSync<T = Record<string, unknown>>(
  source: string,
  options?: ParseOptions,
): ParseResult<T> {
  return parseFrontMatterCore<T>(source, options, {
    getWasm: () => getWasmParsersSync(),
    validate: (data, schema) => lazyValidateSync<T>(data, schema),
  }) as ParseResult<T>;
}

// ---------------------------------------------------------------------------
// Shared core implementation
// ---------------------------------------------------------------------------

/** Runtime-specific callbacks injected by the async / sync entry points. */
interface ParseCallbacks<T> {
  getWasm: () => WasmParsers | Promise<WasmParsers>;
  validate: (data: unknown, schema: AnySchema) => T | Promise<T>;
}

/**
 * Core parsing logic shared between the async and sync public APIs.
 *
 * The `callbacks` parameter abstracts away the only two differences:
 * how to obtain the WASM module and how to run validation.
 *
 * SAFETY: The sync entry-point (`parseFrontMatterSync`) injects synchronous
 * callbacks (`getWasmParsersSync`, `lazyValidateSync`) so `rawOrPromise` is
 * never a `Promise`. The `instanceof Promise` branch only executes in the
 * async path. Do not change the callbacks without preserving this invariant.
 */
function parseFrontMatterCore<T = Record<string, unknown>>(
  source: string,
  options: ParseOptions | undefined,
  callbacks: ParseCallbacks<T>,
): ParseResult<T> | Promise<ParseResult<T>> {
  const size = byteLength(source);
  if (size > MAX_INPUT_SIZE) {
    throw new FrontMatterError(`Input too large: ${size} bytes (max: ${MAX_INPUT_SIZE})`);
  }

  const extraction = extractFrontMatter(source, options?.delimiters);

  if (extraction === null || extraction.rawData.length === 0) {
    const body = extraction?.content ?? source;
    const fmt = options?.format ?? "yaml";
    const excerpt = options?.excerpt ? extractExcerpt(body, options.excerpt) : undefined;
    return {
      data: {} as Record<string, never>,
      content: body,
      format: fmt,
      isEmpty: true,
      excerpt,
    } satisfies ParseResultEmpty;
  }

  const detection = detectFormatWithPreparsed(extraction.rawData, extraction.delimiter);
  const format = options?.format ?? detection.format;
  const strict = options?.strict !== false;
  const excerpt = options?.excerpt
    ? extractExcerpt(extraction.content, options.excerpt)
    : undefined;

  try {
    // Resolve raw data — may be sync or async depending on WASM loading.
    const rawOrPromise = resolveRawData<T>(extraction, detection, format, callbacks);

    // Build the result once raw data is available.
    const buildResult = (raw: unknown): ParseResult<T> | Promise<ParseResult<T>> => {
      const sanitised = sanitizeKeys(raw);

      if (options?.schema) {
        const validated = callbacks.validate(sanitised, options.schema);
        // Handle both sync and async validation.
        if (validated instanceof Promise) {
          return validated.then((data) => makeSuccess<T>(data, extraction, format, excerpt));
        }
        return makeSuccess<T>(validated, extraction, format, excerpt);
      }

      return makeSuccess<T>(sanitised as T, extraction, format, excerpt);
    };

    if (rawOrPromise instanceof Promise) {
      return rawOrPromise
        .then(buildResult)
        .catch((err) => handleError(err, strict, extraction, format, excerpt));
    }
    return buildResult(rawOrPromise);
  } catch (err) {
    return handleError(err, strict, extraction, format, excerpt);
  }
}

/**
 * Resolve parsed data, reusing pre-parsed JSON when possible.
 *
 * SAFETY NOTE: Even when the JSON fast path returns pre-parsed data that
 * bypasses WASM, the caller (`parseFrontMatterCore`) ALWAYS runs
 * `sanitizeKeys()` on the result. Do not remove/skip that call.
 */
function resolveRawData<T>(
  extraction: ExtractionResult,
  detection: DetectionResult,
  format: FrontMatterFormat,
  callbacks: ParseCallbacks<T>,
): unknown | Promise<unknown> {
  if (
    format === detection.format &&
    "preparsedData" in detection &&
    detection.preparsedData !== undefined
  ) {
    return detection.preparsedData;
  }

  const wasmOrPromise = callbacks.getWasm();
  if (wasmOrPromise instanceof Promise) {
    return wasmOrPromise.then((wasm) => {
      const adapter = createParserAdapter(format, wasm);
      return adapter.parse(extraction.rawData);
    });
  }

  const adapter = createParserAdapter(format, wasmOrPromise);
  return adapter.parse(extraction.rawData);
}

function makeSuccess<T>(
  data: T,
  extraction: ExtractionResult,
  format: FrontMatterFormat,
  excerpt: string | undefined,
): ParseResultSuccess<T> {
  return {
    data,
    content: extraction.content,
    format,
    isEmpty: false,
    excerpt,
    rawData: extraction.rawData,
  };
}

function handleError(
  err: unknown,
  strict: boolean,
  extraction: ExtractionResult,
  format: FrontMatterFormat,
  excerpt: string | undefined,
): ParseResultError {
  if (strict) throw err;

  // Sanitize error messages to prevent information leakage (internal paths,
  // stack traces, Rust panic details) when errors are returned to consumers.
  const rawMessage = err instanceof Error ? err.message : String(err);
  const sanitizedMessage = sanitizeErrorMessage(rawMessage);

  return {
    data: {} as Record<string, never>,
    content: extraction.content,
    format,
    isEmpty: false,
    error: new FrontMatterError(sanitizedMessage),
    excerpt,
    rawData: extraction.rawData,
  };
}

/** Strip file paths, stack traces, and internal details from error messages.
 * @internal Exported for reuse in the Worker entry-point. */
export function sanitizeErrorMessage(message: string): string {
  // Strip absolute file paths — Windows (C:\...) and Unix (/...).
  // Supports spaces, unicode chars, and common special characters in paths.
  let sanitized = message.replace(/(?:[A-Za-z]:)?[/\\](?:[^\s:*?"<>|\n]| (?=[^\s]))+/g, "<path>");
  // Strip relative paths like ../foo/bar or ./foo
  sanitized = sanitized.replace(/\.{1,2}[/\\](?:[^\s:*?"<>|\n]| (?=[^\s]))+/g, "<path>");
  // Strip stack trace lines
  sanitized = sanitized.replace(/\n\s+at\s+.+/g, "");
  // Strip Rust panic details ("panicked at ...", "thread '...'")
  sanitized = sanitized.replace(/thread\s+'[^']*'\s+panicked\s+at\s+[^\n]*/g, "<internal error>");
  // Truncate to prevent excessive error detail exposure
  if (sanitized.length > 300) {
    sanitized = `${sanitized.slice(0, 300)}…`;
  }
  return sanitized.trim();
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { detectFormat } from "./detector.js";
export { extractExcerpt } from "./excerpt.js";
export { extractFrontMatter } from "./extractor.js";

export { stringifyFrontMatter, stringifyFrontMatterSync } from "./stringify.js";
export type {
  DelimiterPair,
  ExcerptOptions,
  ExtractionResult,
  FrontMatterFormat,
  ParseResult,
  ParseResultEmpty,
  ParseResultError,
  ParseResultSuccess,
  ParserAdapter,
  StringifyOptions,
} from "./types.js";
export {
  DEFAULT_DELIMITERS,
  ExtractionError,
  FrontMatterError,
  ParseError,
  ValidationError,
} from "./types.js";
export { initWasm } from "./wasm-loader.js";

// Note: `validate` is NOT re-exported here to avoid pulling in the valibot
// dependency at import time.  Use the subpath import instead:
// ---------------------------------------------------------------------------
// Runtime detection & File API
// ---------------------------------------------------------------------------

declare const Bun:
  | { file(path: string | URL): { text(): Promise<string>; exists(): Promise<boolean> } }
  | undefined;
declare const Deno: { readTextFile(path: string | URL): Promise<string> } | undefined;

/**
 * Read and parse front matter from a file path or URL.
 *
 * Automatically detects the runtime (Bun, Deno) or falls back to `fetch`
 * for URL inputs in other environments (Cloudflare Workers, Browsers).
 *
 * @param path - File path (string) or URL to read.
 * @param options - Parse options (format, delimiters, schema, etc).
 * @returns The parsed front matter result.
 * @throws {Error} If the file cannot be read or runtime is unsupported.
 */
export async function readFrontMatter<T = Record<string, unknown>>(
  path: string | URL,
  options?: ParseOptions,
): Promise<ParseResult<T>> {
  const content = await readFileContent(path);
  return parseFrontMatter<T>(content, options);
}

/**
 * Read and parse multiple files with concurrency control.
 *
 * Limits parallel operations to avoid resource exhaustion when processing
 * many URLs. Local file reads are also gated for consistency.
 *
 * Individual file errors are caught and returned as `ParseResultError`
 * entries so that one failing file does not reject the entire batch.
 *
 * @param paths - Array of file paths or URLs.
 * @param options - Parse options (shared across all files).
 * @param concurrency - Maximum number of parallel operations (default: 8).
 * @returns Array of results in the same order as inputs.
 */
export async function readFrontMatterMany<T = Record<string, unknown>>(
  paths: (string | URL)[],
  options?: ParseOptions,
  concurrency = MAX_CONCURRENCY,
): Promise<ParseResult<T>[]> {
  const limit = Math.max(1, Math.min(concurrency, paths.length));
  const results: ParseResult<T>[] = new Array(paths.length);
  // SAFETY: `nextIdx++` is safe without synchronisation because JavaScript
  // is single-threaded. Each async worker yields only at `await` boundaries,
  // and the post-increment is atomic within a single turn of the event loop.
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < paths.length) {
      const idx = nextIdx++;
      try {
        results[idx] = await readFrontMatter<T>(paths[idx], options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[idx] = {
          data: {} as Record<string, never>,
          content: "",
          format: options?.format ?? "yaml",
          isEmpty: false,
          error: new FrontMatterError(message),
          rawData: "",
        } satisfies ParseResultError as ParseResult<T>;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function readFileContent(path: string | URL): Promise<string> {
  // 1. Fetch (HTTP/HTTPS) - prioritize for all runtimes
  if (
    (path instanceof URL && (path.protocol === "http:" || path.protocol === "https:")) ||
    (typeof path === "string" && /^https?:/.test(path))
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(path, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${String(path)}`);
      }
      throw err;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Failed to fetch ${String(path)}: ${res.status} ${res.statusText}`);
    }

    // Guard against unexpectedly large responses before reading the full body.
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_FETCH_SIZE) {
      throw new Error(
        `Response too large (${contentLength} bytes, max ${MAX_FETCH_SIZE}): ${String(path)}`,
      );
    }

    // Validate Content-Type is text-like.
    // NOTE: `application/octet-stream` is intentionally excluded — binary data
    // should not be silently decoded as UTF-8 text.
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/(text\/|application\/(json|toml|yaml|x-yaml|markdown)|charset=)/i.test(ct)) {
      throw new Error(
        `Unexpected Content-Type "${ct.split(";")[0]}" from ${String(path)} (expected text)`,
      );
    }

    // Stream-read with a size cap to prevent memory exhaustion.
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_FETCH_SIZE) {
          reader.cancel();
          throw new Error(
            `Response body exceeded ${MAX_FETCH_SIZE} bytes from ${String(path)}`,
          );
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(merged);
    }

    // Fallback for environments without ReadableStream body
    return res.text();
  }

  // 2. Bun (Local Files & file: URLs)
  if (typeof Bun !== "undefined") {
    // Bun.file() handles absolute/relative paths and file:// URLs correctly
    const file = Bun.file(path);
    try {
      return await file.text();
    } catch {
      throw new Error(`File not found: ${String(path)}`);
    }
  }

  // 3. Deno (Local Files & file: URLs)
  if (typeof Deno !== "undefined") {
    return Deno.readTextFile(path);
  }

  // 4. Fallback: node:fs (covers Vitest workers where Bun global is unavailable)
  try {
    const { readFile } = await import("node:fs/promises");
    // Convert URL to path string to avoid type conflicts between Deno and Node URL types
    let filePath: string;
    if (typeof path === "string") {
      filePath = path;
    } else {
      // For file:// URLs, convert to file path; for other URLs, use href
      if (path.protocol === "file:") {
        const { fileURLToPath } = await import("node:url");
        // Deno's URL type and Node's URL type have incompatible TypeScript definitions
        // (searchParams property differs), but they're runtime-compatible.
        // @ts-ignore - Suppress type error: Deno URL vs Node URL type mismatch
        filePath = fileURLToPath(path);
      } else {
        filePath = path.href;
      }
    }
    return await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`File not found: ${String(path)}`);
  }
}
