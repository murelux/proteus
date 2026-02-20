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
  const input = stripBom(source);

  // Validate delimiter pairs.
  validateDelimiters(delimiters);

  // Try each delimiter pair in order.
  // Only normalise line endings in the region we need (not the full source).
  let openMatched = false;
  for (const pair of delimiters) {
    const result = tryExtract(input, pair);
    if (result !== undefined) {
      return result;
    }
    // Track whether the opening delimiter matched at all.
    if (input.startsWith(`${pair.open}\n`) || input.startsWith(`${pair.open}\r\n`)) {
      openMatched = true;
    }
  }

  // The file starts with a known opening delimiter but none of the
  // corresponding closing delimiters were found.
  if (openMatched) {
    // Collect only the close delimiters that pair with the matched open.
    const matchedOpens = new Set(
      delimiters
        .filter((d) => input.startsWith(`${d.open}\n`) || input.startsWith(`${d.open}\r\n`))
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
// Shared helpers (exported for reuse by hasFrontMatter)
// ---------------------------------------------------------------------------

/**
 * Validate delimiter pairs — throws ExtractionError if any pair has empty open/close.
 * @internal Shared between extractFrontMatter and hasFrontMatter.
 */
export function validateDelimiters(delimiters: readonly DelimiterPair[]): void {
  for (const { open, close } of delimiters) {
    if (!open || !close) {
      throw new ExtractionError(
        "Invalid delimiter pair: both open and close must be non-empty strings.",
      );
    }
  }
}

/**
 * Strip a leading UTF-8 BOM (\uFEFF) if present.
 * @internal Shared between extractFrontMatter and hasFrontMatter.
 */
export function stripBom(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

/**
 * Find the closing delimiter starting at `searchFrom`, requiring that the
 * delimiter occupies its own line (preceded by `\n` and followed by `\n`,
 * `\r\n`, or EOF).
 *
 * @internal Exported for reuse by hasFrontMatter.
 */
export function findCloseDelimiter(source: string, close: string, searchFrom: number): number {
  let pos = searchFrom - 1;
  for (;;) {
    let idx = source.indexOf(`\n${close}`, pos);
    if (idx === -1) {
      // Also try \r\n before close.
      idx = source.indexOf(`\r\n${close}`, pos);
      if (idx !== -1) idx += 1; // advance past \r so idx points to \n
    }
    if (idx === -1) return -1;

    // Check that the char immediately after the close delimiter is \n, \r\n or EOF.
    const afterClose = idx + 1 + close.length;
    if (
      afterClose >= source.length || // EOF
      source[afterClose] === "\n" || // \n
      (source[afterClose] === "\r" && source[afterClose + 1] === "\n") // \r\n
    ) {
      return idx;
    }

    // Not a valid close — advance and keep searching.
    pos = idx + 1;
  }
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
  // Check if the char right after `open` is \r (indicating \r\n), not \n.
  const openEnd = source[open.length] === "\r" ? open.length + 2 : open.length + 1;

  // Search for the closing delimiter on its own line.
  // Start from openEnd - 1 so the closing delimiter is found even when the
  // front matter body is completely empty (e.g. "---\n---\n").
  // The close delimiter must be followed by \n, \r\n, or EOF — nothing else
  // on the same line. This prevents false matches like `---extra text`.
  const closeIdx = findCloseDelimiter(source, close, openEnd);

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
