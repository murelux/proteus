/**
 * @module
 *
 * Detects the front matter format (YAML, TOML, or JSON) from the raw content
 * string and its delimiter pair. Used internally by the main parser pipeline
 * but also exported for standalone use.
 *
 * @example
 * ```ts
 * import { detectFormat } from "@quill/proteus/detector";
 *
 * const format = detectFormat('{"title":"Hi"}', { open: "---", close: "---" });
 * console.log(format); // "json"
 * ```
 */

import type { DelimiterPair, FrontMatterFormat } from "./types.js";

/** @internal Result of format detection that may include pre-parsed JSON data. */
export interface DetectionResult {
  format: FrontMatterFormat;
  /** Pre-parsed JSON data, present only when format is "json". Avoids double parsing. */
  preparsedData?: unknown;
}

/**
 * Detect the front matter format from the raw content and delimiter pair.
 *
 * -  `+++` delimiters → TOML
 * -  Content starts with `{` → JSON
 * -  Anything else → YAML (default)
 */
export function detectFormat(rawData: string, delimiter: DelimiterPair): FrontMatterFormat {
  return detectFormatWithPreparsed(rawData, delimiter).format;
}

/**
 * Detect the format and optionally return pre-parsed JSON data.
 *
 * Used internally by the main pipeline so JSON front matter is only
 * parsed once (by the native `JSON.parse`) rather than being parsed
 * again through the WASM layer.
 *
 * @internal
 */
export function detectFormatWithPreparsed(
  rawData: string,
  delimiter: DelimiterPair,
): DetectionResult {
  // TOML uses +++ delimiters by convention.
  if (delimiter.open === "+++") {
    return { format: "toml" };
  }

  // JSON detection: content starts with `{` or `[` and is valid JSON.
  // A simple `startsWith("{")` heuristic would misidentify YAML flow
  // mappings (e.g. `{key: value}`) as JSON, so we probe with JSON.parse.
  const trimmed = rawData.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const preparsedData = JSON.parse(trimmed);
      return { format: "json", preparsedData };
    } catch {
      // Not valid JSON — fall through to YAML default.
    }
  }

  return { format: "yaml" };
}
