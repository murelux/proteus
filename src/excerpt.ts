import type { ExcerptOptions } from "./types.js";

/** Default excerpt separator. */
const DEFAULT_SEPARATOR = "<!-- more -->";

/**
 * Extract an excerpt from markdown content.
 *
 * If the separator is found, returns everything before it.
 * Otherwise, returns the first paragraph.
 *
 * @param content - The markdown content (after front matter).
 * @param options - Excerpt extraction options.
 * @returns The extracted excerpt, or undefined if content is empty.
 */
export function extractExcerpt(
  content: string,
  options?: ExcerptOptions | boolean,
): string | undefined {
  // Explicitly handle `false` — no excerpt requested.
  if (options === false) return undefined;

  if (!content || content.trim().length === 0) {
    return undefined;
  }

  const separator =
    typeof options === "object" && options.separator ? options.separator : DEFAULT_SEPARATOR;

  const trimmed = content.trim();

  // Try to find the separator
  const separatorIndex = trimmed.indexOf(separator);
  if (separatorIndex !== -1) {
    const excerpt = trimmed.slice(0, separatorIndex).trim();
    return excerpt.length > 0 ? excerpt : undefined;
  }

  // Fallback: extract first paragraph
  // A paragraph is text separated by blank lines
  const paragraphs = trimmed.split(/\r?\n\s*\r?\n/);
  const firstParagraph = paragraphs[0]?.trim();

  // Skip if first "paragraph" is a heading alone
  if (firstParagraph && !isHeadingOnly(firstParagraph)) {
    return firstParagraph;
  }

  // If first is heading, try second paragraph
  if (paragraphs.length > 1) {
    const secondParagraph = paragraphs[1]?.trim();
    if (secondParagraph && !isHeadingOnly(secondParagraph)) {
      return secondParagraph;
    }
  }

  return undefined;
}

/**
 * Check if text is only a markdown heading.
 */
function isHeadingOnly(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  return lines.length === 1 && /^#{1,6}\s+/.test(lines[0]);
}
