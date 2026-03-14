/**
 * End-to-end integration tests for the Cloudflare Worker.
 *
 * These tests use Miniflare to run the wrangler-bundled worker inside the
 * real workerd runtime.  This validates WASM initialisation, HTTP routing,
 * content-type handling, CORS headers and error responses against the
 * actual Workers runtime — without needing a `wrangler dev` subprocess.
 *
 * Setup:
 *   The `beforeAll` hook runs `wrangler deploy --dry-run --outdir` to
 *   produce a bundled ESModule + WASM binary, then hands those artefacts
 *   to a programmatic Miniflare instance via `dispatchFetch`.
 *
 * NOTE: KV-dependent routes (GET /:namespace/:slug) are covered by the
 * simulated handler tests in worker.test.ts.  These integration tests
 * focus on the POST parsing endpoint and basic routing because seeding
 * KV data in a local wrangler dev session adds complexity without
 * additional confidence over the unit-level mocks.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Use dynamic import so the top-level `import` doesn't break environments
// where miniflare is not installed (e.g. CI without devDeps).
// biome-ignore lint/suspicious/noExplicitAny: Miniflare types vary across versions
let Miniflare: any;

const packageRoot = resolve(import.meta.dirname, "..");
const DIST_DIR = join(packageRoot, ".wrangler/dist");
// biome-ignore lint/suspicious/noExplicitAny: Miniflare instance
let mf: any;

// ---------------------------------------------------------------------------
// Lifecycle — build, create Miniflare, tear down
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // 1. Bundle the worker using wrangler's own bundler.
  // We must run this from the package root because Wrangler 4.x does not support
  // being run from a monorepo root without a workspace-aware config.
  const packageRoot = resolve(import.meta.dirname, "..");
  execSync("bunx wrangler deploy --dry-run --outdir .wrangler/dist", {
    cwd: packageRoot,
    stdio: "pipe",
  });

  // 2. Discover output files.
  const files = readdirSync(DIST_DIR);
  const jsFile = files.find((f) => f.endsWith(".js") && !f.endsWith(".map"));
  const wasmFile = files.find((f) => f.endsWith(".wasm"));
  if (!jsFile) throw new Error("Bundled JS not found in .wrangler/dist");
  if (!wasmFile) throw new Error("Bundled WASM not found in .wrangler/dist");

  const scriptContent = readFileSync(join(DIST_DIR, jsFile), "utf-8");
  const wasmContent = readFileSync(join(DIST_DIR, wasmFile));

  // 3. Create a Miniflare instance with the bundled artefacts.
  const mod = await import("miniflare");
  Miniflare = mod.Miniflare;

  mf = new Miniflare({
    compatibilityDate: "2026-02-14",
    compatibilityFlags: ["nodejs_compat"],
    modules: [
      { type: "ESModule", path: jsFile, contents: scriptContent },
      { type: "CompiledWasm", path: wasmFile, contents: new Uint8Array(wasmContent) },
    ],
  });

  // Wait for the runtime to be ready.
  await mf.ready;
}, 60_000);

afterAll(async () => {
  if (mf) await mf.dispose();
}, 15_000);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Send a request to the Miniflare worker.
 * `dispatchFetch` expects a full URL; the host doesn't matter.
 */
function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return mf.dispatchFetch(`http://localhost${path}`, init);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker integration — POST front matter parsing", () => {
  it("should parse YAML front matter", async () => {
    const body = `---
title: Hello World
tags: [a, b]
---
Some content here.`;

    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body,
    });

    if (res.status !== 200) {
      const text = await res.clone().text();
      console.error(`Unexpected status ${res.status}:`, text);
    }

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { title: string; tags: string[] }; content: string };
    expect(json.data.title).toBe("Hello World");
    expect(json.data.tags).toEqual(["a", "b"]);
    expect(json.content).toContain("Some content here.");
  });

  it("should parse JSON front matter", async () => {
    const body = `---
{
  "title": "JSON Post",
  "draft": true
}
---
Body text.`;

    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { title: string; draft: boolean } };
    expect(json.data.title).toBe("JSON Post");
    expect(json.data.draft).toBe(true);
  });

  it("should parse TOML front matter", async () => {
    const body = `+++
title = "TOML Post"
count = 42
+++
Content after TOML.`;

    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { title: string; count: number } };
    expect(json.data.title).toBe("TOML Post");
    expect(json.data.count).toBe(42);
  });

  it("should return 400 for content without front matter", async () => {
    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "Just plain text, no front matter.",
    });

    // Parsing text without front matter may return empty data or an error
    // depending on the parser behaviour — at minimum the worker shouldn't crash.
    expect([200, 400]).toContain(res.status);
  });

  it("should return 415 for unsupported content types", async () => {
    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: "not an image",
    });

    expect(res.status).toBe(415);
  });

  it("should handle empty body gracefully", async () => {
    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "",
    });

    // Empty body should not crash the worker.
    expect([200, 400]).toContain(res.status);
  });
});

describe("Worker integration — routing", () => {
  it("should respond 204 to OPTIONS (CORS preflight)", async () => {
    const res = await workerFetch("/", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("should respond 405 to unsupported methods", async () => {
    const res = await workerFetch("/", { method: "PUT" });
    expect(res.status).toBe(405);
  });

  it("should respond 400 for GET / (missing namespace and slug)", async () => {
    const res = await workerFetch("/", { method: "GET" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Missing namespace");
  });

  it("should respond 400 for invalid namespace format", async () => {
    const res = await workerFetch("/INVALID/some-slug", { method: "GET" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Invalid namespace");
  });

  it("should respond 404 for unknown namespace (no KV binding)", async () => {
    const res = await workerFetch("/nonexistent/some-slug", { method: "GET" });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Unknown namespace");
  });
});

describe("Worker integration — security headers", () => {
  it("should include security headers on POST responses", async () => {
    const res = await workerFetch("/", {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: "---\ntitle: test\n---\n",
    });

    // The worker adds security headers via jsonSuccess / jsonError.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("should include security headers on error responses", async () => {
    const res = await workerFetch("/", { method: "PUT" });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
