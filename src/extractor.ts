/**
 * @module
 *
 * Low-level extraction of the raw front matter block from a Markdown source
 * string. This module does **not** parse the front matter content — it only
 * locates the opening/closing delimiters and splits the source into the raw
 * data string and the remaining body.
 *
 * @example
 * ```ts
 * import { extractFrontMatter } from "@quill/proteus/extractor";
 *
 * const result = extractFrontMatter("---\ntitle: Hello\n---\n# Body");
 * console.log(result?.rawData); // "title: Hello"
 * ```
 */

import type { DelimiterPair, ExtractionResult } from "./types.js";
import { DEFAULT_DELIMITERS, ExtractionError } from "./types.js";

/**
 * Extract the front matter block and the remaining Markdown body from a source
 * string.
 *
 * Supports symmetric delimiters (`---`, `+++`) and asymmetric pairs
 * (e.g. `{ open: "<!--", close: "-->" }`).
 *
 * @param source    Raw Markdown source string.
 * @param delimiters  Optional array of delimiter pairs to try. Defaults to
 *                    `[{ open: "---", close: "---" }, { open: "---", close: "..." }, { open: "+++", close: "+++" }]`.
 *
 * @returns An `ExtractionResult` with the raw (unparsed) data, body content,
 *          and delimiter used — or `null` if no front matter is present.
 */
export function extractFrontMatter(
  source: string,
  delimiters: readonly DelimiterPair[] = DEFAULT_DELIMITERS,
): ExtractionResult | null {
  if (!source || source.trim().length === 0) {
    return null;
  }

  // Strip UTF-8 BOM — editors like Windows Notepad prepend \uFEFF which
  // would prevent the opening delimiter from matching.
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }

  // Validate delimiter pairs.
  for (const { open, close } of delimiters) {
    if (!open || !close) {
      throw new ExtractionError(
        "Invalid delimiter pair: both open and close must be non-empty strings.",
      );
    }
  }

  // Try each delimiter pair in order.
  // Only normalise line endings in the region we need (not the full source).
  let openMatched = false;
  for (const pair of delimiters) {
    const result = tryExtract(source, pair);
    if (result !== undefined) {
      return result;
    }
    // Track whether the opening delimiter matched at all.
    if (source.startsWith(`${pair.open}\n`) || source.startsWith(`${pair.open}\r\n`)) {
      openMatched = true;
    }
  }

  // The file starts with a known opening delimiter but none of the
  // corresponding closing delimiters were found.
  if (openMatched) {
    // Collect only the close delimiters that pair with the matched open.
    const matchedOpens = new Set(
      delimiters
        .filter((d) => source.startsWith(`${d.open}\n`) || source.startsWith(`${d.open}\r\n`))
        .map((d) => d.open),
    );
    const closes = [
      ...new Set(delimiters.filter((d) => matchedOpens.has(d.open)).map((d) => d.close)),
    ];
    throw new ExtractionError(
      `Unclosed front matter block: opening delimiter found but no closing delimiter (tried: ${closes.map((c) => `"${c}"`).join(", ")}).`,
    );
  }

  // No front matter found.
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tryExtract(source: string, pair: DelimiterPair): ExtractionResult | undefined {
  const { open, close } = pair;

  // The file must start with the opening delimiter followed by a newline.
  if (!source.startsWith(`${open}\n`) && !source.startsWith(`${open}\r\n`)) {
    return undefined; // signal "not this delimiter"
  }

  // Skip past `open` + newline (handle both \r\n and \n).
  const openEnd = source[open.length + 1] === "\n" ? open.length + 2 : open.length + 1;

  // Search for the closing delimiter on its own line.
  // Start from openEnd - 1 so the closing delimiter is found even when the
  // front matter body is completely empty (e.g. "---\n---\n").
  let closeIdx = source.indexOf(`\n${close}`, openEnd - 1);
  if (closeIdx === -1) {
    // Also try \r\n before close.
    closeIdx = source.indexOf(`\r\n${close}`, openEnd - 1);
    if (closeIdx !== -1) closeIdx += 1; // advance past \r so closeIdx points to \n
  }

  if (closeIdx === -1) {
    // Close delimiter not found — let the next pair be tried.
    return undefined;
  }

  const rawData = source.slice(openEnd, closeIdx).trim();
  const contentStart = closeIdx + 1 + close.length; // skip `\nclose`

  // Skip optional trailing newline after the closing delimiter.
  let bodyStart = contentStart;
  if (source[bodyStart] === "\n") {
    bodyStart += 1;
  } else if (source[bodyStart] === "\r" && source[bodyStart + 1] === "\n") {
    bodyStart += 2;
  }

  const content = source.slice(bodyStart);

  return { rawData, content, delimiter: pair };
}
