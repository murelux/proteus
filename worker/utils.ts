/**
 * Shared utility functions for the Cloudflare Worker.
 *
 * These are extracted from the worker entry-point so they can be tested
 * directly without requiring the WASM static imports.
 */

/** Allowed slug characters: alphanumeric, hyphens, underscores, dots, slashes.
 * Blocks path traversal sequences (".." consecutive dots) and leading special chars. */
export const SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9\-_/]|\.(?!\.))*$/;

/** Maximum slug length. */
export const MAX_SLUG_LENGTH = 256;

/** Maximum allowed request body size (1 MB). */
export const MAX_BODY_SIZE = 1_048_576;

/** Validate a slug string against length and pattern rules. */
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

// ---------------------------------------------------------------------------
// KV namespace resolution
// ---------------------------------------------------------------------------

/** Minimal KV-like interface used for binding resolution. */
export interface KVLike {
  get(key: string, type: "text"): Promise<string | null>;
}

/**
 * Namespace name pattern: starts with a lowercase letter, followed by
 * lowercase alphanumeric characters, with optional hyphen-separated groups.
 * Examples: "content", "blog-posts", "my-kv-store".
 */
export const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Maximum namespace name length. */
export const MAX_NAMESPACE_LENGTH = 64;

/** Validate a KV namespace name. */
export function isValidNamespace(ns: string): boolean {
  return ns.length > 0 && ns.length <= MAX_NAMESPACE_LENGTH && NAMESPACE_PATTERN.test(ns);
}

/**
 * Resolve a namespace name to a KV binding from the environment.
 *
 * Maps a lowercase namespace name to a `KV_*` binding, e.g.:
 * - `"content"` → `KV_CONTENT`
 * - `"blog-posts"` → `KV_BLOG_POSTS`
 *
 * Returns `null` if the binding doesn't exist or isn't KV-like.
 */
export function resolveKV(env: WorkerEnv, namespace: string): KVLike | null {
  // Built-in shortcut for "posts" -> "KV_POSTS"
  const ns = namespace === "posts" ? "posts" : namespace;

  // If allowed namespaces are configured, check against the list.
  if (env.ALLOWED_NAMESPACES) {
    const allowed = env.ALLOWED_NAMESPACES.split(",").map((n) => n.trim());
    if (!allowed.includes(ns)) {
      return null;
    }
  }

  const bindingName = `KV_${ns.toUpperCase().replaceAll("-", "_")}`;
  const binding = (env as Record<string, unknown>)[bindingName];
  if (binding && typeof binding === "object" && "get" in binding) {
    return binding as KVLike;
  }
  return null;
}

/** Env type shared between worker and tests. */
export interface WorkerEnv {
  /** Comma-separated list of allowed origins. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated list of allowed namespaces. If unset, all matching KV bindings are exposed. */
  ALLOWED_NAMESPACES?: string;
  /**
   * KV namespace bindings are added dynamically via the Cloudflare Dashboard.
   * Convention: `KV_<NAMESPACE>` (e.g., `KV_CONTENT`, `KV_PAGES`).
   */
  [key: string]: unknown;
}

/**
 * Build CORS headers based on the request origin and the configured allowlist.
 *
 * When `ALLOWED_ORIGINS` is set, only listed origins receive the
 * `Access-Control-Allow-Origin` header.  When unset, no CORS header is
 * emitted (effectively same-origin only).
 */
export function corsHeaders(
  origin: string | null,
  allowedOrigins?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (!allowedOrigins || !origin) return headers;

  const allowed = allowedOrigins.split(",").map((o) => o.trim());
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

/** Security headers applied to all non-preflight responses. */
export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

// ---------------------------------------------------------------------------
// Shared KV helpers (used by multiple GET routes)
// ---------------------------------------------------------------------------

/** Create a JSON error response with standard headers. */
export function jsonError(error: string, status: number, cors: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { ...cors, ...securityHeaders } });
}

/** Create a JSON success response with standard headers and optional cache. */
export function jsonSuccess(data: unknown, cors: Record<string, string>, cache?: string): Response {
  const headers: Record<string, string> = { ...cors, ...securityHeaders };
  if (cache) headers["Cache-Control"] = cache;
  return Response.json(data, { headers });
}

/**
 * Validate a slug and the KV binding, returning an error Response if invalid.
 * Returns `null` when validation passes.
 */
export function validateSlugAndKV(
  slug: string,
  kvContent: unknown,
  cors: Record<string, string>,
): Response | null {
  if (!slug || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    return jsonError("Invalid slug format", 400, cors);
  }
  if (!kvContent) {
    console.error("KV binding is not configured for this namespace");
    return jsonError("Service unavailable: storage not configured", 503, cors);
  }
  return null;
}

/**
 * Read a KV entry, parse it as JSON, validate it's a plain object, and return
 * a success Response. Returns an error Response on failure.
 */
export async function readKVEntry(
  kv: KVLike,
  key: string,
  slug: string,
  cors: Record<string, string>,
): Promise<Response> {
  const raw = await kv.get(key, "text");
  if (raw === null) {
    return jsonError("Not found", 404, cors);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (parseError) {
    console.error(
      `JSON parse error for slug "${slug}":`,
      parseError instanceof Error ? parseError.message : String(parseError),
    );
    return jsonError("Internal server error", 500, cors);
  }

  if (data === null || typeof data !== "object") {
    console.error(`Unexpected data type for slug "${slug}": ${typeof data}`);
    return jsonError("Internal server error", 500, cors);
  }

  return jsonSuccess(data, cors, "s-maxage=300");
}
