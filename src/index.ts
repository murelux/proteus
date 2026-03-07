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
import { sanitizeErrorMessage } from "./error-utils.js";
import { extractExcerpt } from "./excerpt.js";
import {
  extractFrontMatter,
  findCloseDelimiter,
  stripBom,
  validateDelimiters,
} from "./extractor.js";
import { createParserAdapter } from "./parsers.js";
import { readFileContent } from "./reader.js";
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
// Lazy-loaded validator (avoids requiring any schema library at import time)
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for a Standard Schema (`~standard` protocol).
 * Declared locally so that no schema library needs to be installed by default.
 * Compatible with Zod v4, Valibot, ArkType, and any other Standard Schema impl.
 */
type AnySchema = { readonly "~standard": unknown };

let _validateFn: ((data: unknown, schema: AnySchema) => unknown) | null = null;

/** Load the validator module on demand and cache it. */
async function lazyValidate<T>(data: unknown, schema: AnySchema): Promise<T> {
  if (!_validateFn) {
    await initValidator();
  }
  if (!_validateFn) {
    throw new FrontMatterError("Failed to initialize validator");
  }
  const fn = _validateFn;
  // fn may return T or Promise<T> depending on the schema — async functions
  // automatically unwrap a returned Promise so this resolves correctly.
  return fn(data, schema) as T;
}

/**
 * Pre-load the schema validation module.
 *
 * This is required before using `parseFrontMatterSync` when a `schema` option
 * is provided. The validator supports any **Standard Schema**-compliant
 * library (Zod v4+, Valibot, ArkType, etc.).
 *
 * @example
 * ```ts
 * import { initValidator, parseFrontMatterSync } from "@quill/proteus";
 * await initValidator();
 * const result = parseFrontMatterSync(source, { schema: MySchema });
 * ```
 */
export async function initValidator(): Promise<void> {
  if (!_validateFn) {
    const mod = await import("./validator.js");
    _validateFn = mod.validate as (data: unknown, schema: AnySchema) => unknown;
  }
}

/** Use the cached validator synchronously. Throws if not yet loaded. */
function lazyValidateSync<T>(data: unknown, schema: AnySchema): T {
  if (!_validateFn) {
    throw new FrontMatterError(
      "Schema validation in sync mode requires the validator to be pre-loaded. " +
        "Call `await initValidator()` first before attempting synchronous parsing with a schema.",
    );
  }
  const result = _validateFn(data, schema);
  // Standard Schema's validate() can be async; reject early with a helpful
  // message rather than silently wrapping a Promise as the data value.
  if (
    result !== null &&
    typeof result === "object" &&
    "then" in (result as Record<string, unknown>) &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    throw new FrontMatterError(
      "Schema validation in sync mode returned a Promise. " +
        "Use `parseFrontMatter()` (async) when your schema's validate() is asynchronous.",
    );
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed input size in bytes (1 MB).
 * Both the TS layer and the Rust WASM layer enforce the same byte-level limit. */
const MAX_INPUT_SIZE = 1_048_576;

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

  // Reuse shared validation and BOM-stripping from the extractor module
  // to ensure consistent behaviour and eliminate duplicated logic.
  validateDelimiters(delimiters);
  const s = stripBom(source);

  for (const { open, close } of delimiters) {
    if (s.startsWith(`${open}\n`) || s.startsWith(`${open}\r\n`)) {
      const openEnd = s[open.length] === "\r" ? open.length + 2 : open.length + 1;
      if (findCloseDelimiter(s, close, openEnd) !== -1) {
        return true;
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
   * Optional **Standard Schema**-compliant schema to validate the parsed data
   * against. Compatible with Zod v4+, Valibot, ArkType, and any library that
   * implements the `~standard` interface.
   *
   * When provided, the returned `data` is typed and validated at runtime.
   * Without a schema, the generic `T` is unchecked — the caller is responsible
   * for ensuring the cast is sound.
   *
   * @example
   * ```ts
   * // Zod
   * import { z } from "zod";
   * const schema = z.object({ title: z.string() });
   * const result = await parseFrontMatter(src, { schema });
   *
   * // Valibot
   * import * as v from "valibot";
   * const schema = v.object({ title: v.string() });
   * const result = await parseFrontMatter(src, { schema });
   * ```
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

  /**
   * Allow `readFrontMatter` / `readFrontMatterMany` to fetch content from
   * remote HTTP/HTTPS URLs.
   *
   * Remote URL fetching is **disabled by default** to prevent accidental SSRF
   * in server-side environments. Set this to `true` only when you explicitly
   * need to read from trusted remote sources.
   *
   * Has no effect when the `path` argument is a local file path.
   *
   * @default false
   */
  allowRemoteUrls?: boolean;

  /**
   * Restrict local file reads to a specific base directory to prevent
   * path traversal vulnerabilities.
   *
   * When provided, `readFrontMatter` will verify that the resolved
   * target path is contained within this `baseDir`. Reads outside
   * this directory will throw an error.
   */
  baseDir?: string;
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
  const result = parseFrontMatterCore<T>(source, options, {
    getWasm: () => getWasmParsersSync(),
    validate: (data, schema) => lazyValidateSync<T>(data, schema),
  });

  // Runtime guard: the sync path must never produce a Promise.
  // If it does, a code change has violated the sync-callback invariant.
  if (result instanceof Promise) {
    throw new FrontMatterError(
      "Internal error: parseFrontMatterSync produced a Promise. " +
        "This indicates a bug — sync callbacks must not return Promises.",
    );
  }

  return result;
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

    // The raw data resolved synchronously (e.g. JSON fast-path with
    // pre-parsed data), but `buildResult` may still return a Promise
    // when async schema validation is requested.  Attach a `.catch()`
    // so that validation rejections honour the `strict: false` contract
    // instead of propagating as unhandled rejections.
    const result = buildResult(rawOrPromise);
    if (result instanceof Promise) {
      return result.catch((err) => handleError(err, strict, extraction, format, excerpt));
    }
    return result;
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

  // Preserve the original error as `cause` so consumers can inspect it
  // (e.g. access `ParseError.line` / `ValidationError.issues`) while still
  // getting a sanitized top-level message.
  const wrappedError = new FrontMatterError(sanitizedMessage);
  wrappedError.cause = err;

  return {
    data: {} as Record<string, never>,
    content: extraction.content,
    format,
    isEmpty: false,
    error: wrappedError,
    excerpt,
    rawData: extraction.rawData,
  };
}

/** Strip file paths, stack traces, and internal details from error messages.
 * @internal Re-exported from error-utils for backward compatibility. */
export { sanitizeErrorMessage } from "./error-utils.js";

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

// Note: `validate` is NOT re-exported here to avoid pulling in any schema
// library dependency at import time.  Use the subpath import instead:
//   import { validate } from "@quill/proteus/validator"

// ---------------------------------------------------------------------------
// File API
// ---------------------------------------------------------------------------

/**
 * Read and parse front matter from a file path or URL.
 *
 * Automatically detects the runtime (Bun, Deno) or falls back to `fetch`
 * for URL inputs in other environments (Cloudflare Workers, Browsers).
 *
 * Remote HTTP/HTTPS URLs are blocked by default — pass
 * `options.allowRemoteUrls: true` to enable them.
 *
 * @param path - File path (string) or URL to read.
 * @param options - Parse options (format, delimiters, schema, allowRemoteUrls, etc.).
 * @returns The parsed front matter result.
 * @throws {Error} If the file cannot be read or runtime is unsupported.
 */
export async function readFrontMatter<T = Record<string, unknown>>(
  path: string | URL,
  options?: ParseOptions,
): Promise<ParseResult<T>> {
  const content = await readFileContent(path, {
    allowRemoteUrls: options?.allowRemoteUrls ?? false,
    baseDir: options?.baseDir,
  });
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
 * Remote HTTP/HTTPS URLs are blocked by default — pass
 * `options.allowRemoteUrls: true` to enable them.
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
  if (paths.length === 0) return [];

  const limit = Math.max(1, Math.min(concurrency, paths.length));
  const results: ParseResult<T>[] = new Array(paths.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < paths.length) {
      const idx = nextIndex++;
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
