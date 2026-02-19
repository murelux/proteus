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
  let sanitized = message.replace(/(?:[A-Za-z]:)?[/\\](?:[^\s:*?"<>|\n]| (?=[^\s]))+/g, "<path>");
  // Strip UNC paths like \\server\share\...
  sanitized = sanitized.replace(/\\\\[^\s:*?"<>|\n]+/g, "<path>");
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
