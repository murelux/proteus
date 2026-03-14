/**
 * @module
 *
 * Shared error sanitization utilities for `@quill/proteus`.
 *
 * Used by the core library (src/index.ts) and the Cloudflare Worker
 * (worker/index.ts) to strip sensitive information from error messages
 * before exposing them to consumers.
 *
 * @internal This module is not part of the public API surface.
 */

/**
 * Strip file paths, stack traces, and internal details from error messages.
 *
 * Prevents information leakage (internal paths, Rust panic details, stack
 * traces) when error messages are returned to consumers in non-strict mode
 * or included in HTTP responses.
 *
 * @internal Exported for reuse in the Worker entry-point.
 */
export function sanitizeErrorMessage(message: string): string {
  // Strip absolute file paths — Windows (C:\...) and Unix (/...).
  // Supports spaces, unicode chars, and common special characters in paths.
  let sanitized = message.replaceAll(/(?:[A-Za-z]:)?[/\\](?:[^\s:*?"<>|]| (?=[^\s]))+/g, "<path>");
  sanitized = sanitized.replaceAll(/\\\\[^\s:*?"<>|]+/g, "<path>");
  sanitized = sanitized.replaceAll(/\.{1,2}[/\\](?:[^\s:*?"<>|]| (?=[^\s]))+/g, "<path>");
  sanitized = sanitized.replaceAll(/\n\s+at\s+.+/g, "");
  sanitized = sanitized.replaceAll(
    /thread\s+'[^']*'\s+panicked\s+at\s+[^\n]*/g,
    "<internal error>",
  );
  // Truncate to prevent excessive error detail exposure
  if (sanitized.length > 300) {
    sanitized = `${sanitized.slice(0, 300)}…`;
  }
  return sanitized.trim();
}
