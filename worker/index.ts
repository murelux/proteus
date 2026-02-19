// @ts-expect-error: no type declarations for generated _bg.js
import * as bgModule from "../pkg/quill_matter_wasm_bg.js";
// @ts-expect-error: wrangler resolves .wasm imports as WebAssembly.Module
import wasmBinary from "../pkg/quill_matter_wasm_bg.wasm";

import { parseFrontMatter, sanitizeErrorMessage } from "../src/index.js";
import { _preloadWasmModule } from "../src/wasm-loader.js";

interface Env {
  KV_CONTENT: KVNamespace;
  /** Comma-separated list of allowed origins (e.g. "https://example.com,https://app.example.com").
   *  When unset, defaults to rejecting cross-origin requests (no CORS header). */
  ALLOWED_ORIGINS?: string;
}

/** Maximum allowed request body size (1 MB). */
const MAX_BODY_SIZE = 1_048_576;

/** Allowed slug characters: alphanumeric, hyphens, underscores, dots, slashes.
 * Blocks path traversal sequences (".." consecutive dots). */
const SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9\-_/]|\.(?!\.))*$/;

/** Maximum slug length. */
const MAX_SLUG_LENGTH = 256;

/**
 * Build CORS headers based on the request origin and the configured allowlist.
 *
 * When `ALLOWED_ORIGINS` is set, only listed origins receive the
 * `Access-Control-Allow-Origin` header.  When unset, no CORS header is
 * emitted (effectively same-origin only).
 */
function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (!env.ALLOWED_ORIGINS || !origin) return headers;

  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  if (allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

/** Security headers applied to all non-preflight responses. */
const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Eagerly initialise the WASM module using statically-imported artefacts
 * so that the first request does not pay the loading cost.
 *
 * If initialisation fails, `ready` becomes a rejected promise and all
 * subsequent requests will receive a 500 response (see fetch handler).
 */
const ready = (async () => {
  const instance = await WebAssembly.instantiate(wasmBinary, {
    "./quill_matter_wasm_bg.js": bgModule,
  });

  // Wire the raw WASM exports into the JS glue layer.
  bgModule.__wbg_set_wasm(instance.exports);

  // Initialise the externref table (required by wasm-bindgen output).
  if (typeof instance.exports.__wbindgen_start === "function") {
    (instance.exports.__wbindgen_start as () => void)();
  }

  // Seed the generic loader cache so `getWasmParsers()` skips dynamic loading.
  // biome-ignore lint/suspicious/noExplicitAny: wasm-bindgen generated module shape
  _preloadWasmModule(bgModule as any);
})();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, env);

    // Fail fast if WASM initialisation failed.
    try {
      await ready;
    } catch (err) {
      console.error("WASM init failed:", err instanceof Error ? err.message : String(err));
      return Response.json(
        { error: "Service unavailable: WASM initialization failed" },
        { status: 503, headers: { ...cors, ...securityHeaders } },
      );
    }

    const url = new URL(request.url);

    // 1. CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors } });
    }

    // 2. Existing Markdown parsing
    if (request.method === "POST") {
      try {
        // Fast-reject: use Content-Length as an early hint (untrusted).
        const contentLength = request.headers.get("content-length");
        if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
          return Response.json(
            { error: `Request body too large (max: ${MAX_BODY_SIZE} bytes)` },
            { status: 413, headers: { ...cors, ...securityHeaders } },
          );
        }

        // Stream-read the body with a size cap to avoid buffering oversized
        // payloads entirely into memory before rejecting them.
        let markdown: string;
        if (request.body) {
          const reader = request.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_BODY_SIZE) {
              reader.cancel();
              return Response.json(
                { error: `Request body too large (max: ${MAX_BODY_SIZE} bytes)` },
                { status: 413, headers: { ...cors, ...securityHeaders } },
              );
            }
            chunks.push(value);
          }
          const merged = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          markdown = new TextDecoder().decode(merged);
        } else {
          markdown = await request.text();
          const byteLength = new TextEncoder().encode(markdown).byteLength;
          if (byteLength > MAX_BODY_SIZE) {
            return Response.json(
              { error: `Request body too large (max: ${MAX_BODY_SIZE} bytes)` },
              { status: 413, headers: { ...cors, ...securityHeaders } },
            );
          }
        }
        const result = await parseFrontMatter(markdown);
        return Response.json(result, {
          headers: { ...cors, ...securityHeaders },
        });
      } catch (err) {
        // Reuse the shared sanitization logic from the core library.
        const raw = err instanceof Error ? err.message : String(err);
        const message = sanitizeErrorMessage(raw);
        return Response.json(
          { error: message },
          { status: 400, headers: { ...cors, ...securityHeaders } },
        );
      }
    }

    // 3. GET /by-slug/:slug — lookup article by front-matter slug
    if (request.method === "GET" && url.pathname.startsWith("/by-slug/")) {
      const slug = decodeURIComponent(url.pathname.slice("/by-slug/".length));

      if (!slug || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
        return Response.json(
          { error: "Invalid slug format" },
          { status: 400, headers: { ...cors, ...securityHeaders } },
        );
      }

      if (!env.KV_CONTENT) {
        console.error("KV_CONTENT binding is not configured");
        return Response.json(
          { error: "Service unavailable: storage not configured" },
          { status: 503, headers: { ...cors, ...securityHeaders } },
        );
      }

      try {
        // Read the _index to find the KV key for this slug
        const indexRaw = await env.KV_CONTENT.get("_index", "text");
        if (!indexRaw) {
          return Response.json(
            { error: "Index not available" },
            { status: 503, headers: { ...cors, ...securityHeaders } },
          );
        }

        const index = JSON.parse(indexRaw) as { key: string; slug?: string }[];
        const entry = index.find((e) => e.slug === slug);

        if (!entry) {
          return Response.json(
            { error: "Not found" },
            { status: 404, headers: { ...cors, ...securityHeaders } },
          );
        }

        // Fetch the full article by its KV key
        const raw = await env.KV_CONTENT.get(entry.key, "text");
        if (!raw) {
          return Response.json(
            { error: "Not found" },
            { status: 404, headers: { ...cors, ...securityHeaders } },
          );
        }

        const data = JSON.parse(raw);
        return Response.json(data, {
          headers: { ...cors, ...securityHeaders, "Cache-Control": "s-maxage=300" },
        });
      } catch (err) {
        console.error(
          `Error resolving slug "${slug}":`,
          err instanceof Error ? err.message : String(err),
        );
        return Response.json(
          { error: "Internal server error" },
          { status: 500, headers: { ...cors, ...securityHeaders } },
        );
      }
    }

    // 4. GET / — missing slug
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json(
        { error: "Missing slug. Usage: GET /:slug" },
        { status: 400, headers: { ...cors, ...securityHeaders } },
      );
    }

    // 5. GET /:slug — KV read
    if (request.method === "GET") {
      const slug = decodeURIComponent(url.pathname.slice(1));

      if (slug === "") {
        return Response.json(
          { error: "Missing slug. Usage: GET /:slug" },
          { status: 400, headers: { ...cors, ...securityHeaders } },
        );
      }

      // Validate slug format to prevent key enumeration.
      if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
        return Response.json(
          { error: "Invalid slug format" },
          { status: 400, headers: { ...cors, ...securityHeaders } },
        );
      }

      // Guard: KV namespace may not be bound (e.g. local dev, missing wrangler config).
      if (!env.KV_CONTENT) {
        console.error("KV_CONTENT binding is not configured");
        return Response.json(
          { error: "Service unavailable: storage not configured" },
          { status: 503, headers: { ...cors, ...securityHeaders } },
        );
      }

      try {
        const raw = await env.KV_CONTENT.get(slug, "text");

        if (raw === null) {
          return Response.json(
            { error: "Not found" },
            { status: 404, headers: { ...cors, ...securityHeaders } },
          );
        }

        try {
          const data = JSON.parse(raw);
          return Response.json(data, {
            headers: { ...cors, ...securityHeaders, "Cache-Control": "s-maxage=300" },
          });
        } catch (parseError) {
          console.error(
            `JSON parse error for slug "${slug}":`,
            parseError instanceof Error ? parseError.message : String(parseError),
          );
          return Response.json(
            { error: "Internal server error" },
            { status: 500, headers: { ...cors, ...securityHeaders } },
          );
        }
      } catch (err) {
        console.error(
          `KV read error for slug "${slug}":`,
          err instanceof Error ? err.message : String(err),
        );
        return Response.json(
          { error: "Internal server error" },
          { status: 500, headers: { ...cors, ...securityHeaders } },
        );
      }
    }

    // 6. Method not allowed
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { ...cors, ...securityHeaders } },
    );
  },
};
