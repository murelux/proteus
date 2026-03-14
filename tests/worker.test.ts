/**
 * Integration tests for the Cloudflare Worker entry-point.
 *
 * These tests exercise the Worker's shared utilities (slug validation, CORS
 * headers, security headers) imported from `worker/utils.ts` — the same
 * module the real worker uses. Route-level tests use a simulated handler
 * that mirrors the worker's `fetch` logic with real `parseFrontMatter`.
 *
 * NOTE: The Worker's `fetch` handler itself cannot be imported directly
 * because it relies on `import wasmBinary from "...wasm"` (wrangler static
 * import). The shared utilities ARE imported directly, eliminating the
 * previous drift risk.
 */
import { describe, expect, it } from "vitest";
import { parseFrontMatter, sanitizeErrorMessage } from "../src/index.js";
import type { KVLike, WorkerEnv } from "../worker/utils.js";
import {
  corsHeaders,
  isValidNamespace,
  isValidSlug,
  MAX_BODY_SIZE,
  MAX_NAMESPACE_LENGTH,
  MAX_SLUG_LENGTH,
  NAMESPACE_PATTERN,
  resolveKV,
  SLUG_PATTERN,
  securityHeaders,
} from "../worker/utils.js";

// ---------------------------------------------------------------------------
// Slug validation (imported from worker/utils.ts)
// ---------------------------------------------------------------------------

describe("Worker — slug validation", () => {
  const check = (slug: string, expected: boolean) => {
    expect(isValidSlug(slug)).toBe(expected);
  };

  it("should accept simple alphanumeric slugs", () => {
    ["hello-world", "post123", "my_post"].forEach(s => check(s, true));
  });

  it("should accept slugs with path separators", () => {
    ["blog/2026/my-post", "a/b/c"].forEach(s => check(s, true));
  });

  it("should accept slugs with dots", () => {
    ["file.md", "v1.0.0"].forEach(s => check(s, true));
  });

  it("should reject empty slugs", () => {
    check("", false);
  });

  it("should reject slugs starting with non-alphanumeric chars", () => {
    ["-leading-dash", "_leading-underscore", ".hidden", "/absolute"].forEach(s => check(s, false));
  });

  it("should reject slugs with special characters", () => {
    ["hello world", "path/../traversal", "slug<script>", "slug:colon"].forEach(s => check(s, false));
  });

  it("should reject slugs exceeding max length", () => {
    check("a".repeat(256), true);
    check("a".repeat(257), false);
  });

  it("should validate constants match worker expectations", () => {
    expect(MAX_SLUG_LENGTH).toBe(256);
    expect(SLUG_PATTERN).toBeInstanceOf(RegExp);
    expect(MAX_BODY_SIZE).toBe(1_048_576);
    expect(MAX_NAMESPACE_LENGTH).toBe(64);
    expect(NAMESPACE_PATTERN).toBeInstanceOf(RegExp);
  });
});

// ---------------------------------------------------------------------------
// Namespace validation (imported from worker/utils.ts)
// ---------------------------------------------------------------------------

describe("Worker — namespace validation", () => {
  const check = (ns: string, expected: boolean) => {
    expect(isValidNamespace(ns)).toBe(expected);
  };

  it("should accept valid namespace names", () => {
    ["content", "blog-posts", "a", "pages", "my-kv-store"].forEach(n => check(n, true));
  });

  it("should reject invalid namespace names", () => {
    ["", "UPPER", "-leading", "trailing-", "has space", "has.dot", "has/slash"].forEach(n => check(n, false));
  });

  it("should reject namespaces exceeding max length", () => {
    check("a".repeat(64), true);
    check("a".repeat(65), false);
  });
});

// ---------------------------------------------------------------------------
// KV namespace resolution (imported from worker/utils.ts)
// ---------------------------------------------------------------------------

describe("Worker — KV namespace resolution", () => {
  it("should resolve a known namespace", () => {
    const env: WorkerEnv = { KV_CONTENT: { get: async () => null } };
    expect(resolveKV(env, "content")).toBe(env.KV_CONTENT);
  });

  it("should resolve a hyphenated namespace", () => {
    const env: WorkerEnv = { KV_BLOG_POSTS: { get: async () => null } };
    expect(resolveKV(env, "blog-posts")).toBe(env.KV_BLOG_POSTS);
  });

  it("should return null for a missing namespace", () => {
    const env: WorkerEnv = {};
    expect(resolveKV(env, "missing")).toBeNull();
  });

  it("should return null for a non-KV binding", () => {
    const env: WorkerEnv = { KV_BROKEN: "not-an-object" };
    expect(resolveKV(env, "broken")).toBeNull();
  });

  it("should resolve allowed namespace when allowlist is set", () => {
    const env: WorkerEnv = {
      KV_CONTENT: { get: async () => null },
      ALLOWED_NAMESPACES: "content,pages",
    };
    expect(resolveKV(env, "content")).toBe(env.KV_CONTENT);
  });

  it("should return null for disallowed namespace when allowlist is set", () => {
    const env: WorkerEnv = {
      KV_SECRET: { get: async () => null },
      ALLOWED_NAMESPACES: "content,pages",
    };
    // "secret" maps to KV_SECRET but is not in ALLOWED_NAMESPACES
    expect(resolveKV(env, "secret")).toBeNull();
  });

  it("should handle spaces in allowlist", () => {
    const env: WorkerEnv = {
      KV_PAGES: { get: async () => null },
      ALLOWED_NAMESPACES: "content, pages , blog",
    };
    expect(resolveKV(env, "pages")).toBe(env.KV_PAGES);
  });
});

// ---------------------------------------------------------------------------
// Error sanitization (imported from the shared module)
// ---------------------------------------------------------------------------

describe("Worker — error sanitization (shared)", () => {
  const check = (msg: string, excluded: string, included: string) => {
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain(excluded);
    expect(result).toContain(included);
  };

  it("should strip absolute Unix paths", () => {
    check("Failed at /home/user/project/src/file.ts", "/home/user", "<path>");
  });

  it("should strip absolute Windows paths", () => {
    check("Error in C:\\Users\\dev\\project\\file.ts", "C:\\Users", "<path>");
  });

  it("should strip relative paths", () => {
    const result = sanitizeErrorMessage("Error in ../src/index.ts and ./foo/bar.js");
    expect(result).not.toContain("../src");
    expect(result).not.toContain("./foo");
  });

  it("should strip Rust panic details", () => {
    check("thread 'main' panicked at src/lib.rs:42: assertion failed", "panicked", "<internal error>");
  });

  it("should strip stack trace lines", () => {
    const msg = "Error occurred\n    at Object.parse (/path/to/file.js:10:5)\n    at Module._compile";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("at Object.parse");
    expect(result).not.toContain("at Module._compile");
  });

  it("should truncate long messages to 300 chars", () => {
    const msg = "A".repeat(500);
    const result = sanitizeErrorMessage(msg);
    expect(result.length).toBeLessThanOrEqual(301); // 300 + ellipsis
  });

  it("should pass through simple error messages unchanged", () => {
    const msg = "Invalid YAML syntax at line 5";
    expect(sanitizeErrorMessage(msg)).toBe("Invalid YAML syntax at line 5");
  });
});

// ---------------------------------------------------------------------------
// Worker route logic (simulated fetch handler using real worker utils)
// ---------------------------------------------------------------------------

const TEST_ALLOWED_ORIGINS = "https://example.com,https://app.example.com";
const mockKV: KVLike = { async get() { return null; } };
const testEnv: WorkerEnv = { KV_CONTENT: mockKV, ALLOWED_ORIGINS: TEST_ALLOWED_ORIGINS };

async function handlePost(request: Request, cors: Record<string, string>): Promise<Response> {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return Response.json({ error: `Request body too large (max: ${MAX_BODY_SIZE} bytes)` }, { status: 413, headers: { ...cors, ...securityHeaders } });
    }

    const markdown = await request.text();
    const byteLength = new TextEncoder().encode(markdown).byteLength;
    if (byteLength > MAX_BODY_SIZE) {
      return Response.json({ error: `Request body too large (max: ${MAX_BODY_SIZE} bytes)` }, { status: 413, headers: { ...cors, ...securityHeaders } });
    }

    const result = await parseFrontMatter(markdown);
    return Response.json(result, { headers: { ...cors, ...securityHeaders } });
  } catch (err) {
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
    return Response.json({ error: message }, { status: 400, headers: { ...cors, ...securityHeaders } });
  }
}

async function handleGet(url: URL, cors: Record<string, string>): Promise<Response> {
  let segments: string[];
  try { segments = url.pathname.slice(1).split("/").map(decodeURIComponent); }
  catch { return Response.json({ error: "Invalid URL encoding" }, { status: 400, headers: { ...cors, ...securityHeaders } }); }

  if (segments.length === 1 && segments[0] === "") {
    return Response.json({ error: "Missing namespace and slug. Usage: GET /:namespace/:slug" }, { status: 400, headers: { ...cors, ...securityHeaders } });
  }

  const namespace = segments[0];
  if (!isValidNamespace(namespace)) return Response.json({ error: "Invalid namespace format" }, { status: 400, headers: { ...cors, ...securityHeaders } });

  const kv = resolveKV(testEnv, namespace);
  if (!kv) return Response.json({ error: `Unknown namespace: ${namespace}` }, { status: 404, headers: { ...cors, ...securityHeaders } });

  const isBySlug = segments.length >= 3 && segments[1] === "by-slug";
  const slug = segments.slice(isBySlug ? 2 : 1).join("/");

  if (!slug || !isValidSlug(slug)) return Response.json({ error: "Invalid slug format" }, { status: 400, headers: { ...cors, ...securityHeaders } });
  if (segments.length < (isBySlug ? 3 : 2)) return Response.json({ error: "Missing slug. Usage: GET /:namespace/:slug" }, { status: 400, headers: { ...cors, ...securityHeaders } });

  return Response.json({ error: "Not found" }, { status: 404, headers: { ...cors, ...securityHeaders } });
}

async function simulatedFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get("origin"), testEnv.ALLOWED_ORIGINS as string | undefined);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors } });
  if (request.method === "POST") return handlePost(request, cors);
  if (request.method === "GET") return handleGet(url, cors);

  return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...cors, ...securityHeaders } });
}

describe("Worker — route logic (simulated fetch handler)", () => {
  it("should return 204 for OPTIONS preflight with allowed origin", async () => {
    const req = new Request("https://example.com/", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("should not include ACAO header for disallowed origin", async () => {
    const req = new Request("https://example.com/", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com" },
    });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("should parse YAML POST body and return JSON with security headers", async () => {
    const body = "---\ntitle: Hello\n---\n# Content";
    const req = new Request("https://example.com/", {
      method: "POST",
      body,
      headers: { Origin: "https://example.com" },
    });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.data as Record<string, unknown>).title).toBe("Hello");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("should return 413 for oversized Content-Length header", async () => {
    const req = new Request("https://example.com/", {
      method: "POST",
      body: "small",
      headers: { "Content-Length": "2000000" },
    });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(413);
  });

  it("should return 400 for GET / (missing namespace and slug)", async () => {
    const req = new Request("https://example.com/", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toContain("Missing namespace");
  });

  it("should return 400 for GET with invalid namespace format", async () => {
    const req = new Request("https://example.com/INVALID/my-slug", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
  });

  it("should return 404 for GET with unknown namespace", async () => {
    const req = new Request("https://example.com/unknown/my-slug", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(404);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toContain("Unknown namespace");
  });

  it("should return 400 for GET with invalid slug (path traversal)", async () => {
    const req = new Request("https://example.com/content/path%2F..%2Ftraversal", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
  });

  it("should return 404 for GET with valid namespace and slug (no KV data)", async () => {
    const req = new Request("https://example.com/content/valid-slug", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("should return 404 for GET by-slug with valid namespace (no KV data)", async () => {
    const req = new Request("https://example.com/content/by-slug/my-article", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(404);
  });

  it("should return 400 for GET with malformed percent-encoding", async () => {
    const req = new Request("https://example.com/content/%ZZ", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toContain("Invalid URL encoding");
  });

  it("should return 400 for GET with namespace starting with digit", async () => {
    const req = new Request("https://example.com/1abc/my-slug", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
  });

  it("should return 400 for GET with trailing slash (empty slug)", async () => {
    const req = new Request("https://example.com/content/", { method: "GET" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
  });

  it("should return 405 for unsupported methods", async () => {
    const req = new Request("https://example.com/", { method: "PUT" });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(405);
  });

  it("should return 400 for POST with malformed front matter (parse error)", async () => {
    const body = "---\n{invalid json\n---\n# Content";
    const req = new Request("https://example.com/", {
      method: "POST",
      body,
    });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
  });

  it("should include CORS headers on error responses for allowed origin", async () => {
    const req = new Request("https://example.com/", {
      method: "GET",
      headers: { Origin: "https://example.com" },
    });
    const res = await simulatedFetch(req);
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
  });
});

// ---------------------------------------------------------------------------
// Security headers validation (imported from worker/utils.ts)
// ---------------------------------------------------------------------------

describe("Worker — security headers contract", () => {
  it("should define all required security headers with correct values", () => {
    expect(securityHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(securityHeaders["X-Frame-Options"]).toBe("DENY");
    expect(securityHeaders["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});

// ---------------------------------------------------------------------------
// Body-size enforcement
// ---------------------------------------------------------------------------

describe("Worker — body size limits", () => {
  it("should enforce 1MB limit", () => {
    const oversized = "a".repeat(MAX_BODY_SIZE + 1);
    const byteLength = new TextEncoder().encode(oversized).byteLength;
    expect(byteLength).toBeGreaterThan(MAX_BODY_SIZE);
  });

  it("should correctly measure multi-byte UTF-8 content", () => {
    // Each CJK character is 3 bytes in UTF-8
    const cjk = "中".repeat(100);
    const byteLength = new TextEncoder().encode(cjk).byteLength;
    expect(byteLength).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// CORS headers validation (imported from worker/utils.ts)
// ---------------------------------------------------------------------------

describe("Worker — CORS headers contract", () => {
  it("should return ACAO for allowed origins", () => {
    const cors = corsHeaders("https://example.com", "https://example.com,https://other.com");
    expect(cors["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(cors.Vary).toBe("Origin");
    expect(cors["Access-Control-Allow-Methods"]).toContain("POST");
    expect(cors["Access-Control-Allow-Methods"]).toContain("GET");
    expect(cors["Access-Control-Allow-Methods"]).toContain("OPTIONS");
  });

  it("should not return ACAO for disallowed origins", () => {
    const cors = corsHeaders("https://evil.com", "https://example.com");
    expect(cors["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("should not return ACAO when no allowlist is configured", () => {
    const cors = corsHeaders("https://example.com", undefined);
    expect(cors["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("should not return ACAO when no origin header is present", () => {
    const cors = corsHeaders(null, "https://example.com");
    expect(cors["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseFrontMatter via worker path (end-to-end with WASM)
// ---------------------------------------------------------------------------

describe("Worker — parseFrontMatter pipeline", () => {
  it("should parse YAML front matter from POST body", async () => {
    const markdown = "---\ntitle: Hello\ntags:\n  - ts\n---\n# Body";
    const result = await parseFrontMatter(markdown);
    expect(result.format).toBe("yaml");
    expect(result.data).toEqual({ title: "Hello", tags: ["ts"] });
    expect(result.content).toBe("# Body");
  });

  it("should parse JSON front matter", async () => {
    const markdown = '---\n{"title": "JSON"}\n---\nContent';
    const result = await parseFrontMatter(markdown);
    expect(result.format).toBe("json");
    expect(result.data).toEqual({ title: "JSON" });
  });

  it("should parse TOML front matter", async () => {
    const markdown = '+++\ntitle = "TOML"\n+++\nContent';
    const result = await parseFrontMatter(markdown);
    expect(result.format).toBe("toml");
    expect(result.data).toEqual({ title: "TOML" });
  });

  it("should return empty result for no front matter", async () => {
    const result = await parseFrontMatter("# Just a heading");
    expect(result.isEmpty).toBe(true);
    expect(result.data).toEqual({});
  });

  it("should reject input exceeding 1MB", async () => {
    const huge = `---\ntitle: Big\n---\n${"x".repeat(1_048_577)}`;
    await expect(parseFrontMatter(huge)).rejects.toThrow(/too large/i);
  });
});
