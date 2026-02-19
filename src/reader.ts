/**
 * @module
 *
 * File reading utilities for `@quill/proteus`. Handles local file I/O
 * (Bun, Deno, Node.js) and HTTP/HTTPS URL fetching with SSRF protection.
 *
 * @internal This module is not part of the public API.
 */

// ---------------------------------------------------------------------------
// Runtime declarations
// ---------------------------------------------------------------------------

declare const Bun:
  | { file(path: string | URL): { text(): Promise<string>; exists(): Promise<boolean> } }
  | undefined;
declare const Deno: { readTextFile(path: string | URL): Promise<string> } | undefined;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum HTTP response size to read into memory (2 MB).
 * Prevents memory exhaustion from large remote responses before the parse-level check. */
const MAX_FETCH_SIZE = 2_097_152;

/** Default HTTP fetch timeout in milliseconds (30 seconds).
 * NOTE: `AbortSignal.timeout()` / `AbortController` behaviour may differ
 * between runtimes (e.g. older Cloudflare Workers may ignore abort signals).
 * The manual `setTimeout` + `controller.abort()` approach used in
 * `readFileContent` is the most portable pattern. */
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

/**
 * Check whether a hostname resolves to a private/internal network address.
 *
 * Covers:
 * - Loopback: `localhost`, `127.x.x.x`, `::1`, `[::1]`
 * - Private IPv4: `10.x`, `172.16-31.x`, `192.168.x`
 * - Link-local: `169.254.x`, `.local`
 * - Null range: `0.x.x.x` (entire 0.0.0.0/8)
 * - Unspecified: `::` (IPv6 all-zeros)
 * - IPv6 private: `fc00::/7` (ULA), `fe80::/10` (link-local)
 * - IPv4-mapped IPv6: `::ffff:127.0.0.1` etc.
 *
 * **Limitation — DNS rebinding:** This function only inspects the hostname
 * string literal.  An attacker who controls a domain's DNS records can return
 * a public IP on the first resolution (passing this check) and a private IP
 * on the second resolution (when `fetch()` connects).  Full protection
 * requires runtime-level DNS policies or network isolation (e.g. Cloudflare
 * Workers already restrict outbound connections to private ranges).
 */
export function isPrivateHostname(hostname: string): boolean {
  // URL.hostname strips brackets for IPv6, but check both forms defensively.
  const h = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const lower = h.toLowerCase();

  // Loopback
  if (lower === "localhost" || lower === "::1") return true;

  // IPv6 unspecified address (all-zeros)
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;

  // .local suffix (mDNS)
  if (lower.endsWith(".local")) return true;

  // IPv4 ranges
  if (/^127\./.test(lower)) return true; // 127.0.0.0/8
  if (/^0\./.test(lower) || lower === "0.0.0.0") return true; // 0.0.0.0/8
  if (/^10\./.test(lower)) return true; // 10.0.0.0/8
  if (/^192\.168\./.test(lower)) return true; // 192.168.0.0/16
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true; // 172.16.0.0/12
  if (/^169\.254\./.test(lower)) return true; // 169.254.0.0/16

  // IPv6 ULA (fc00::/7) and link-local (fe80::/10)
  if (/^fc/i.test(lower) || /^fd/i.test(lower)) return true;
  if (/^fe[89ab]/i.test(lower)) return true;

  // IPv4-mapped IPv6: ::ffff:A.B.C.D
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) {
    return isPrivateHostname(v4Mapped[1]);
  }

  return false;
}

// ---------------------------------------------------------------------------
// File Content Reading
// ---------------------------------------------------------------------------

/**
 * Read content from a file path or URL.
 *
 * Supports:
 * - HTTP/HTTPS URLs with SSRF protection and streaming size limits
 * - Bun local file API
 * - Deno local file API
 * - Node.js fs (fallback for Vitest workers)
 *
 * @internal
 */
export async function readFileContent(path: string | URL): Promise<string> {
  // 1. Fetch (HTTP/HTTPS) - prioritize for all runtimes
  if (
    (path instanceof URL && (path.protocol === "http:" || path.protocol === "https:")) ||
    (typeof path === "string" && /^https?:/.test(path))
  ) {
    return fetchContent(path);
  }

  // 2. Bun (Local Files & file: URLs)
  if (typeof Bun !== "undefined") {
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

// ---------------------------------------------------------------------------
// HTTP Fetch (internal)
// ---------------------------------------------------------------------------

async function fetchContent(path: string | URL): Promise<string> {
  // SSRF protection: block private/internal network addresses and non-http(s) schemes.
  const url = path instanceof URL ? path : new URL(path);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (isPrivateHostname(hostname)) {
    throw new Error(`Blocked request to private/internal address: ${hostname}`);
  }

  // Limit redirections — `fetch()` follows redirects by default.
  // Use `redirect: "manual"` is too restrictive; instead set a redirect
  // limit via `follow` on runtimes that support it, or rely on the default
  // (typically 20). This is a defence-in-depth note for integrators.
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
  // NOTE: Content-Length is untrusted; parse defensively to avoid NaN bypass.
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const cl = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(cl) && cl > MAX_FETCH_SIZE) {
      throw new Error(
        `Response too large (${contentLength} bytes, max ${MAX_FETCH_SIZE}): ${String(path)}`,
      );
    }
  }

  // Validate Content-Type is text-like.
  // NOTE: `application/octet-stream` is intentionally excluded — binary data
  // should not be silently decoded as UTF-8 text.
  // The primary MIME type is checked first; `charset=` alone is not sufficient
  // to accept an otherwise binary type (e.g. `application/octet-stream; charset=utf-8`).
  const ct = res.headers.get("content-type") ?? "";
  if (ct) {
    const mimeType = ct.split(";")[0].trim().toLowerCase();
    const isTextLike =
      mimeType.startsWith("text/") ||
      /^application\/(json|toml|yaml|x-yaml|markdown)$/.test(mimeType);
    if (!isTextLike) {
      throw new Error(`Unexpected Content-Type "${mimeType}" from ${String(path)} (expected text)`);
    }
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
        throw new Error(`Response body exceeded ${MAX_FETCH_SIZE} bytes from ${String(path)}`);
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
