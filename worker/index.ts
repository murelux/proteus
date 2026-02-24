// @ts-expect-error: no type declarations for generated _bg.js
import * as bgModule from "../pkg/matter_wasm_bg.js";
// @ts-expect-error: wrangler resolves .wasm imports as WebAssembly.Module
import wasmBinary from "../pkg/matter_wasm_bg.wasm";
import { sanitizeErrorMessage } from "../src/error-utils.js";
import { parseFrontMatter } from "../src/index.js";
import { _preloadWasmModule } from "../src/wasm-loader.js";
import type { KVLike, WorkerEnv } from "./utils.js";
import {
  corsHeaders,
  isValidNamespace,
  jsonError,
  jsonSuccess,
  MAX_BODY_SIZE,
  readKVEntry,
  resolveKV,
  validateSlugAndKV,
} from "./utils.js";

/**
 * The Env interface uses WorkerEnv's dynamic `[key: string]` index signature.
 * KV namespace bindings (e.g., KV_CONTENT, KV_PAGES) are managed via the
 * Cloudflare Dashboard and appear at runtime as properties on `env`.
 */
type Env = WorkerEnv;

/** Cached TextDecoder instance for the worker. */
const textDecoder = new TextDecoder();

/**
 * Eagerly initialise the WASM module using statically-imported artefacts
 * so that the first request does not pay the loading cost.
 *
 * If initialisation fails, `ready` becomes a rejected promise and all
 * subsequent requests will receive a 500 response (see fetch handler).
 */
const ready = (async () => {
  const instance = await WebAssembly.instantiate(wasmBinary, {
    "./matter_wasm_bg.js": bgModule,
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
})().catch((err) => {
  // Log initialization failure to prevent unhandled promise rejection.
  // The fetch handler will await `ready` and return a 503 on failure.
  console.error("WASM init failed:", err instanceof Error ? err.message : String(err));
  throw err;
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    // Fail fast if WASM initialisation failed.
    try {
      await ready;
    } catch (err) {
      console.error("WASM init failed:", err instanceof Error ? err.message : String(err));
      return jsonError("Service unavailable: WASM initialization failed", 503, cors);
    }

    const url = new URL(request.url);

    // 1. CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Max-Age": "86400" },
      });
    }

    // 2. POST — Markdown front matter parsing
    if (request.method === "POST") {
      return handlePost(request, cors);
    }

    // Only GET beyond this point
    if (request.method !== "GET") {
      return jsonError("Method not allowed", 405, cors);
    }

    // Parse path: /:namespace/by-slug/:slug or /:namespace/:slug
    let segments: string[];
    try {
      segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    } catch {
      return jsonError("Invalid URL encoding", 400, cors);
    }

    if (segments.length === 1 && segments[0] === "") {
      return jsonError("Missing namespace and slug. Usage: GET /:namespace/:slug", 400, cors);
    }

    const namespace = segments[0];
    if (!isValidNamespace(namespace)) {
      return jsonError("Invalid namespace format", 400, cors);
    }

    const kv = resolveKV(env, namespace);
    if (!kv) {
      return jsonError(`Unknown namespace: ${namespace}`, 404, cors);
    }

    // 3. GET /:namespace/by-slug/:slug — lookup article by slug via index
    if (segments.length >= 3 && segments[1] === "by-slug") {
      const slug = segments.slice(2).join("/");
      return handleBySlug(slug, kv, cors);
    }

    // 4. GET /:namespace/:slug — direct KV read
    if (segments.length >= 2) {
      const slug = segments.slice(1).join("/");
      return handleGetSlug(slug, kv, cors);
    }

    // 5. Namespace without slug
    return jsonError("Missing slug. Usage: GET /:namespace/:slug", 400, cors);
  },
};

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handlePost(request: Request, cors: Record<string, string>): Promise<Response> {
  // Validate Content-Type: only accept text/* and application/json.
  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType &&
    !contentType.startsWith("text/") &&
    !contentType.startsWith("application/json")
  ) {
    return jsonError(`Unsupported Content-Type: ${contentType.split(";")[0]}`, 415, cors);
  }

  try {
    // Fast-reject: use Content-Length as an early hint (untrusted).
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return jsonError(`Request body too large (max: ${MAX_BODY_SIZE} bytes)`, 413, cors);
    }

    // Stream-read the body with a size cap to avoid buffering oversized
    // payloads entirely into memory before rejecting them.
    // NOTE: `request.body` may be null for edge-case POST requests with
    // no body. A bare `new ReadableStream()` (no underlying source) would
    // hang forever on `reader.read()` because `close()` is never called.
    // Create a properly-closed empty stream so the reader immediately
    // signals `done: true`.
    const body =
      request.body ??
      new ReadableStream<Uint8Array>({
        start(c) {
          c.close();
        },
      });
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_SIZE) {
        reader.cancel();
        return jsonError(`Request body too large (max: ${MAX_BODY_SIZE} bytes)`, 413, cors);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const markdown = textDecoder.decode(merged);
    const result = await parseFrontMatter(markdown);
    return jsonSuccess(result, cors);
  } catch (err) {
    // Reuse the shared sanitization logic from the core library.
    const raw = err instanceof Error ? err.message : String(err);
    const message = sanitizeErrorMessage(raw);
    return jsonError(message, 400, cors);
  }
}

async function handleBySlug(
  slug: string,
  kv: KVLike,
  cors: Record<string, string>,
): Promise<Response> {
  const validationError = validateSlugAndKV(slug, kv, cors);
  if (validationError) return validationError;

  try {
    // Read the _index to find the KV key for this slug
    const indexRaw = await kv.get("_index", "text");
    if (!indexRaw) {
      return jsonError("Index not available", 503, cors);
    }

    let index: unknown;
    try {
      index = JSON.parse(indexRaw);
    } catch {
      console.error("Failed to parse _index from KV");
      return jsonError("Internal server error", 500, cors);
    }

    if (!Array.isArray(index)) {
      console.error("_index is not an array");
      return jsonError("Internal server error", 500, cors);
    }

    const entry = (index as { key: string; slug?: string }[]).find(
      (e) => e && typeof e === "object" && e.slug === slug,
    );

    if (!entry) {
      return jsonError("Not found", 404, cors);
    }

    if (typeof entry.key !== "string" || !entry.key) {
      console.error(`_index entry for slug "${slug}" has no valid key`);
      return jsonError("Internal server error", 500, cors);
    }

    // Fetch the full article by its KV key
    return readKVEntry(kv, entry.key, slug, cors);
  } catch (err) {
    console.error(
      `Error resolving slug "${slug}":`,
      err instanceof Error ? err.message : String(err),
    );
    return jsonError("Internal server error", 500, cors);
  }
}

async function handleGetSlug(
  slug: string,
  kv: KVLike,
  cors: Record<string, string>,
): Promise<Response> {
  const validationError = validateSlugAndKV(slug, kv, cors);
  if (validationError) return validationError;

  try {
    return await readKVEntry(kv, slug, slug, cors);
  } catch (err) {
    console.error(
      `KV read error for slug "${slug}":`,
      err instanceof Error ? err.message : String(err),
    );
    return jsonError("Internal server error", 500, cors);
  }
}
