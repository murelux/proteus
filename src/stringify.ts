/**
 * @module
 *
 * Serialise a data object back into a Markdown string with front matter.
 * Supports YAML, TOML, and JSON output formats via the Rust WASM backend.
 *
 * @example
 * ```ts
 * import { stringifyFrontMatter } from "@quill/proteus/stringify";
 *
 * const md = await stringifyFrontMatter({ title: "Hello" }, "# Body");
 * ```
 */

import type { DelimiterPair, FrontMatterFormat, StringifyOptions } from "./types.js";
import { FrontMatterError } from "./types.js";
import type { WasmParsers } from "./wasm-loader.js";
import { getWasmParsers, getWasmParsersSync } from "./wasm-loader.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMAT_DELIMITERS: Record<FrontMatterFormat, DelimiterPair> = {
  yaml: { open: "---", close: "---" },
  json: { open: "---", close: "---" },
  toml: { open: "+++", close: "+++" },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate that `data` is a non-empty plain object. Returns `true` if empty (caller should return content as-is). */
function validateData(data: Record<string, unknown>): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    const actual = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
    throw new FrontMatterError(`Expected a plain object for front matter data, got ${actual}`);
  }
  return Object.keys(data).length === 0;
}

/**
 * Stringify data and content into a Markdown string with front matter.
 *
 * @param data - The front matter data object.
 * @param content - The Markdown content (without front matter).
 * @param options - Stringify options (format, delimiter).
 * @returns A complete Markdown string with front matter.
 *
 * @example
 * ```ts
 * import { stringifyFrontMatter } from "@quill/proteus";
 *
 * const markdown = await stringifyFrontMatter(
 *   { title: "Hello", tags: ["a", "b"] },
 *   "# Content here"
 * );
 * // ---
 * // title: Hello
 * // tags:
 * //   - a
 * //   - b
 * // ---
 * // # Content here
 * ```
 */
export async function stringifyFrontMatter(
  data: Record<string, unknown>,
  content: string,
  options?: StringifyOptions,
): Promise<string> {
  if (validateData(data)) return content;

  const format = options?.format ?? "yaml";
  const delimiter = options?.delimiter ?? FORMAT_DELIMITERS[format];

  const wasm = await getWasmParsers();
  const serialized = stringifyData(wasm, data, format);

  return assembleMarkdown(serialized, content, delimiter);
}

/**
 * Stringify data and content synchronously.
 *
 * **Requires** `await initWasm()` to have been called first.
 *
 * @throws {Error} if WASM module is not initialized.
 */
export function stringifyFrontMatterSync(
  data: Record<string, unknown>,
  content: string,
  options?: StringifyOptions,
): string {
  if (validateData(data)) return content;

  const format = options?.format ?? "yaml";
  const delimiter = options?.delimiter ?? FORMAT_DELIMITERS[format];

  const wasm = getWasmParsersSync();
  const serialized = stringifyData(wasm, data, format);

  return assembleMarkdown(serialized, content, delimiter);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Maximum allowed output size in bytes (1 MB), consistent with parse limits. */
const MAX_OUTPUT_SIZE = 1_048_576;

const encoder = new TextEncoder();

function stringifyData(
  wasm: WasmParsers,
  data: Record<string, unknown>,
  format: FrontMatterFormat,
): string {
  let result: string;
  switch (format) {
    case "yaml":
      result = wasm.stringify_yaml(data);
      break;
    case "json":
      result = wasm.stringify_json(data);
      break;
    case "toml":
      result = wasm.stringify_toml(data);
      break;
    default:
      throw new FrontMatterError(`Unknown format: ${format}`);
  }

  // Guard against unbounded output — mirrors the parse-side 1 MB byte limit.
  const size = encoder.encode(result).byteLength;
  if (size > MAX_OUTPUT_SIZE) {
    throw new FrontMatterError(
      `Serialized front matter too large: ${size} bytes (max: ${MAX_OUTPUT_SIZE})`,
    );
  }

  return result;
}

function assembleMarkdown(frontMatter: string, content: string, delimiter: DelimiterPair): string {
  const trimmedFM = frontMatter.trim();

  // Build the final markdown — preserve original content whitespace.
  const parts = [delimiter.open, trimmedFM, delimiter.close];

  if (content.length > 0) {
    parts.push(content);
  }

  // End with a single trailing newline — avoid double newline when content is empty.
  const result = parts.join("\n");
  return result.endsWith("\n") ? result : `${result}\n`;
}
