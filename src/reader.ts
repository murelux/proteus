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

  // IPv4-mapped IPv6: ::ffff:A.B.C.D or ::ffff:hex
  if (lower.startsWith("::ffff:")) {
    const remainder = lower.slice(7);

    // Case 1: Dot-decimal notation (::ffff:127.0.0.1)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(remainder)) {
      return isPrivateHostname(remainder);
    }

    // Case 2: Hex notation (::ffff:7f00:1)
    // Convert hex parts to IPv4 string
    // e.g. "7f00:1" -> "127.0.0.1"
    const hexParts = remainder.split(":");
    if (hexParts.length <= 2) {
      try {
        let ipInt = 0;
        for (const part of hexParts) {
          if (!/^[0-9a-f]{1,4}$/.test(part)) return false; // Invalid hex
          ipInt = (ipInt << 16) | Number.parseInt(part, 16);
        }

        // Convert 32-bit integer to dot-decimal string
        // Use unsigned right shift to handle negative numbers from bitwise ops
        const p1 = (ipInt >>> 24) & 255;
        const p2 = (ipInt >>> 16) & 255;
        const p3 = (ipInt >>> 8) & 255;
        const p4 = ipInt & 255;
        return isPrivateHostname(`${p1}.${p2}.${p3}.${p4}`);
      } catch {
        // Fall through to false if parsing fails
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// File Content Reading
// ---------------------------------------------------------------------------

/**
 * Validates that a file path resolves within the allowed base directory.
 * Prevents path traversal vulnerabilities.
 */
async function validatePath(path: string | URL, baseDir?: string): Promise<void> {
  if (!baseDir) return;

  const { resolve, sep } = await import("node:path");

  let filePath: string;
  if (typeof path === "string") {
    // If it's a file:// URL string, convert it to a path
    if (path.startsWith("file://")) {
      const { fileURLToPath } = await import("node:url");
      filePath = fileURLToPath(path);
    } else {
      filePath = path;
    }
  } else {
    // It's a URL object
    if (path.protocol === "file:") {
      const { fileURLToPath } = await import("node:url");
      filePath = fileURLToPath(path);
    } else {
      // Non-file URLs (e.g. HTTP) are handled separately in readFileContent
      return;
    }
  }

  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(filePath);

  // Ensure basePrefix always ends with a separator, avoiding double slashes if resolvedBase is root
  const basePrefix = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;

  // Check if the resolved path starts with the base directory + separator
  // or exactly equals the base directory
  if (!resolvedPath.startsWith(basePrefix) && resolvedPath !== resolvedBase) {
    throw new Error(`Path traversal blocked: ${String(path)} is outside base directory ${baseDir}`);
  }
}

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
export async function readFileContent(
  path: string | URL,
  options?: { allowRemoteUrls?: boolean; baseDir?: string },
): Promise<string> {
  // 1. Fetch (HTTP/HTTPS) - prioritize for all runtimes
  if (
    (path instanceof URL && (path.protocol === "http:" || path.protocol === "https:")) ||
    (typeof path === "string" && /^https?:/.test(path))
  ) {
    if (!options?.allowRemoteUrls) {
      throw new Error(
        `Remote URL fetching is disabled by default for security. Pass \`allowRemoteUrls: true\` in options to read from ${String(path)}`,
      );
    }
    return fetchContent(path);
  }

  // Validate local file path against baseDir (if provided)
  await validatePath(path, options?.baseDir);

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
  let url = path instanceof URL ? path : new URL(path);
  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let redirectCount = 0;
  const MAX_REDIRECTS = 10;

  try {
    while (true) {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Unsupported URL scheme: ${url.protocol}`);
      }
      const hostname = url.hostname.toLowerCase();
      if (isPrivateHostname(hostname)) {
        throw new Error(`Blocked request to private/internal address: ${hostname}`);
      }

      try {
        // Use manual redirect to enforce SSRF checks on the redirection targets
        res = await fetch(url, { signal: controller.signal, redirect: "manual" });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${String(path)}`);
        }
        throw err;
      }

      // Handle redirects manually
      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`Too many redirects (max ${MAX_REDIRECTS}) for ${String(path)}`);
        }
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`Missing location header for redirect from ${String(path)}`);
        }
        url = new URL(location, url);
        // Consume the body of the redirect response to free up the socket
        if (res.body) await res.text().catch(() => {});
        continue;
      }

      break;
    }
  } finally {
    clearTimeout(timeout);
  }

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
