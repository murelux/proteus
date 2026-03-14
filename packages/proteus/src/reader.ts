import { readStreamToString } from "./stream-utils.js";

/**
 * @module
 *
 * File reading utilities for `proteus`. Handles local file I/O
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

/** Maximum HTTP response size to read into memory (2 MB). */
const MAX_FETCH_SIZE = 2_097_152;

/** Default HTTP fetch timeout in milliseconds (30 seconds). */
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// SSRF Protection Helpers
// ---------------------------------------------------------------------------

function isIPv4Private(lower: string): boolean {
  return (
    lower.startsWith("127.") || // 127.0.0.0/8
    lower.startsWith("0.") || // 0.0.0.0/8
    lower === "0.0.0.0" ||
    lower.startsWith("10.") || // 10.0.0.0/8
    lower.startsWith("192.168.") || // 192.168.0.0/16
    /^172\.(1[6-9]|2\d|3[01])\./.test(lower) || // 172.16.0.0/12
    lower.startsWith("169.254.") // 169.254.0.0/16
  );
}

function isIPv6Private(lower: string): boolean {
  // Loopback, Unspecified, mDNS
  if (
    lower === "::1" ||
    lower === "::" ||
    lower === "0:0:0:0:0:0:0:0" ||
    lower.endsWith(".local")
  ) {
    return true;
  }
  // ULA (fc00::/7) and link-local (fe80::/10)
  return /^fc/i.test(lower) || /^fd/i.test(lower) || /^fe[89ab]/i.test(lower);
}

function isIPv4MappedIPv6Private(lower: string): boolean {
  if (!lower.startsWith("::ffff:")) return false;
  const remainder = lower.slice(7);

  // Case 1: Dot-decimal notation (::ffff:127.0.0.1)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(remainder)) {
    return isIPv4Private(remainder);
  }

  // Case 2: Hex notation (::ffff:7f00:1)
  const hexParts = remainder.split(":");
  if (hexParts.length > 2) return false;

  try {
    let ipInt = 0;
    for (const part of hexParts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return false;
      ipInt = (ipInt << 16) | Number.parseInt(part, 16);
    }
    const p1 = (ipInt >>> 24) & 255;
    const p2 = (ipInt >>> 16) & 255;
    const p3 = (ipInt >>> 8) & 255;
    const p4 = ipInt & 255;
    return isIPv4Private(`${p1}.${p2}.${p3}.${p4}`);
  } catch {
    return false;
  }
}

/**
 * Check whether a hostname resolves to a private/internal network address.
 */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const lower = h.toLowerCase();

  if (lower === "localhost") return true;
  if (isIPv4Private(lower)) return true;
  if (isIPv6Private(lower)) return true;
  if (isIPv4MappedIPv6Private(lower)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// File Content Reading
// ---------------------------------------------------------------------------

/**
 * Read content from a file path or URL.
 */
export async function readFileContent(
  path: string | URL,
  options?: { allowRemoteUrls?: boolean },
): Promise<string> {
  if (
    (path instanceof URL && (path.protocol === "http:" || path.protocol === "https:")) ||
    (typeof path === "string" && /^https?:/.test(path))
  ) {
    if (!options?.allowRemoteUrls) {
      throw new TypeError(
        `Remote URL fetching is disabled by default for security. Pass \`allowRemoteUrls: true\` in options to read from ${String(path)}`,
      );
    }
    return fetchContent(path);
  }

  if (typeof Bun !== "undefined") {
    try {
      return await Bun.file(path).text();
    } catch {
      throw new Error(`File not found: ${String(path)}`);
    }
  }

  if (typeof Deno !== "undefined") {
    return Deno.readTextFile(path);
  }

  return readLocalFileFallback(path);
}

async function readLocalFileFallback(path: string | URL): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    let filePath: string;
    if (typeof path === "string") {
      filePath = path;
    } else if (path.protocol === "file:") {
      const { fileURLToPath } = await import("node:url");
      filePath = fileURLToPath(path);
    } else {
      filePath = path.href;
    }
    return await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`File not found: ${String(path)}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP Fetch (internal)
// ---------------------------------------------------------------------------

async function performRedirectStep(
  url: URL,
  redirectCount: number,
  MAX_REDIRECTS: number,
  controller: AbortSignal,
): Promise<{ res: Response; nextUrl: URL | null }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported URL scheme: ${url.protocol}`);
  }
  if (isPrivateHostname(url.hostname)) {
    throw new RangeError(`Blocked request to private/internal address: ${url.hostname}`);
  }

  const res = await fetch(url.href, { signal: controller, redirect: "manual" });

  if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
    if (redirectCount >= MAX_REDIRECTS) {
      throw new RangeError(`Too many redirects (max ${MAX_REDIRECTS})`);
    }
    const location = res.headers.get("location");
    if (location === null) {
      throw new TypeError("Missing location header in redirect response");
    }
    const nextUrl = new URL(location, url);
    if (res.body) await res.text().catch(() => {});
    return { res, nextUrl };
  }

  return { res, nextUrl: null };
}

async function handleRedirects(
  initialUrl: URL,
  controller: AbortSignal,
): Promise<{ res: Response; finalUrl: URL }> {
  let url = initialUrl;
  let redirectCount = 0;
  const MAX_REDIRECTS = 10;

  while (true) {
    const { res, nextUrl } = await performRedirectStep(url, redirectCount, MAX_REDIRECTS, controller);
    if (nextUrl) {
      url = nextUrl;
      redirectCount++;
      continue;
    }
    return { res, finalUrl: url };
  }
}

function validateResponse(res: Response, url: string | URL): void {
  if (!res.ok) {
    throw new Error(`Failed to fetch ${String(url)}: ${res.status} ${res.statusText}`);
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const cl = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(cl) && cl > MAX_FETCH_SIZE) {
      throw new RangeError(`Response too large (${cl} bytes, max ${MAX_FETCH_SIZE})`);
    }
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct) {
    const mimeType = ct.split(";")[0].trim().toLowerCase();
    const isTextLike =
      mimeType.startsWith("text/") ||
      /^application\/(json|toml|yaml|x-yaml|markdown)$/.test(mimeType);
    if (!isTextLike) {
      throw new TypeError(`Unexpected Content-Type "${mimeType}" (expected text)`);
    }
  }
}

async function fetchContent(path: string | URL): Promise<string> {
  const url = path instanceof URL ? path : new URL(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const { res, finalUrl } = await handleRedirects(url, controller.signal);
    validateResponse(res, finalUrl);

    if (res.body) {
      return await readStreamToString(res.body, MAX_FETCH_SIZE, () => {
        return new Error(`Response body exceeded ${MAX_FETCH_SIZE} bytes`);
      });
    }
    return await res.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
