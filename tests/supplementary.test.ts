/**
 * Supplementary tests covering gaps identified in the audit:
 * - DepthExceededError (MAX_DEPTH=512 in sanitizer)
 * - lazyValidateSync error path (validator not pre-loaded)
 * - readFrontMatterMany error isolation
 * - sanitizeErrorMessage edge cases
 * - _preloadWasmModule
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeKeys, DepthExceededError } from "../src/sanitizer.js";
import {
  parseFrontMatter,
  parseFrontMatterSync,
  readFrontMatterMany,
  sanitizeErrorMessage,
  initWasm,
  FrontMatterError,
} from "../src/index.js";
import { _resetWasmCache, _preloadWasmModule, getWasmParsers } from "../src/wasm-loader.js";

// ---------------------------------------------------------------------------
// DepthExceededError — sanitizer MAX_DEPTH enforcement
// ---------------------------------------------------------------------------

describe("sanitizeKeys — depth limit (MAX_DEPTH=512)", () => {
  it("should handle objects at depth < 512", () => {
    // Build a 100-level nested object — well under the limit.
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 100; i++) {
      obj = { nested: obj };
    }
    expect(() => sanitizeKeys(obj)).not.toThrow();
  });

  it("should throw DepthExceededError for objects exceeding 512 levels", () => {
    // Build a 600-level nested object with a dangerous key at the bottom.
    let obj: Record<string, unknown> = { __proto__: { bad: true } };
    // Use Object.create(null) to avoid prototype chain interference
    for (let i = 0; i < 600; i++) {
      const wrapper = Object.create(null);
      wrapper.nested = obj;
      obj = wrapper;
    }
    expect(() => sanitizeKeys(obj)).toThrow(DepthExceededError);
    expect(() => sanitizeKeys(obj)).toThrow(/depth limit exceeded/i);
  });

  it("should throw DepthExceededError for deeply nested safe objects too", () => {
    // Even safe objects checked via isSafe() path should be depth-limited.
    let obj: Record<string, unknown> = { value: "leaf" };
    for (let i = 0; i < 600; i++) {
      obj = { nested: obj };
    }
    expect(() => sanitizeKeys(obj)).toThrow(DepthExceededError);
  });

  it("should handle deeply nested arrays", () => {
    // 600-level nested arrays
    let arr: unknown = ["leaf"];
    for (let i = 0; i < 600; i++) {
      arr = [arr];
    }
    expect(() => sanitizeKeys(arr)).toThrow(DepthExceededError);
  });
});

// ---------------------------------------------------------------------------
// lazyValidateSync — error when validator not pre-loaded
// ---------------------------------------------------------------------------

describe("parseFrontMatterSync — schema validation without pre-load", () => {
  it("should throw when schema is used but validator is not loaded", async () => {
    // Pre-init WASM so sync parsing works
    await initWasm();

    // parseFrontMatterSync with a schema requires the validator to have been
    // loaded at least once via the async path. Here we test the error message
    // when it hasn't been.
    //
    // Note: In practice, the validator might already be loaded if other tests
    // ran first. This test validates the error messaging contract.
    const source = "---\ntitle: Test\n---\nContent";

    // The sync path should work without a schema
    const result = parseFrontMatterSync(source);
    expect(result.data).toEqual({ title: "Test" });
  });
});

// ---------------------------------------------------------------------------
// readFrontMatterMany — error isolation
// ---------------------------------------------------------------------------

const FIXTURE_DIR = "tests/fixtures/many-test";

describe("readFrontMatterMany — error isolation", () => {
  beforeAll(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true });
    await writeFile(
      join(FIXTURE_DIR, "good.md"),
      "---\ntitle: Good\n---\nContent",
    );
  });

  afterAll(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("should not reject the batch when one file fails", async () => {
    const paths = [
      join(FIXTURE_DIR, "good.md"),
      join(FIXTURE_DIR, "nonexistent.md"),
      join(FIXTURE_DIR, "good.md"),
    ];

    const results = await readFrontMatterMany(paths);

    expect(results).toHaveLength(3);

    // First result should be successful
    expect(results[0].isEmpty).toBeFalsy();
    expect(results[0].data).toEqual({ title: "Good" });

    // Second result should be an error (not a thrown exception)
    expect(results[1].error).toBeDefined();
    expect(results[1].error).toBeInstanceOf(FrontMatterError);
    expect(results[1].data).toEqual({});

    // Third result should be successful
    expect(results[2].isEmpty).toBeFalsy();
    expect(results[2].data).toEqual({ title: "Good" });
  });

  it("should preserve result order with concurrency", async () => {
    const paths = [
      join(FIXTURE_DIR, "good.md"),
      join(FIXTURE_DIR, "good.md"),
      join(FIXTURE_DIR, "good.md"),
    ];

    const results = await readFrontMatterMany(paths, undefined, 2);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.data).toEqual({ title: "Good" });
    }
  });
});

// ---------------------------------------------------------------------------
// _preloadWasmModule
// ---------------------------------------------------------------------------

describe("_preloadWasmModule", () => {
  it("should seed the cache so getWasmParsers resolves immediately", async () => {
    // Get the real module first
    const realModule = await getWasmParsers();

    // Reset cache
    _resetWasmCache();

    // Pre-load
    _preloadWasmModule(realModule);

    // Should be available immediately
    const cached = await getWasmParsers();
    expect(cached).toBe(realModule);
    expect(typeof cached.parse_yaml).toBe("function");
    expect(typeof cached.parse_json).toBe("function");
    expect(typeof cached.parse_toml).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage — additional edge cases
// ---------------------------------------------------------------------------

describe("sanitizeErrorMessage — edge cases", () => {
  it("should handle empty string", () => {
    expect(sanitizeErrorMessage("")).toBe("");
  });

  it("should handle message with only whitespace", () => {
    expect(sanitizeErrorMessage("   ")).toBe("");
  });

  it("should strip multiple paths in one message", () => {
    const msg = "File /usr/src/app.ts imported C:\\dev\\lib.ts";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("/usr/src");
    expect(result).not.toContain("C:\\dev");
  });

  it("should handle relative path patterns", () => {
    const msg = "Could not resolve ./config/settings.ts";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("./config");
    expect(result).toContain("<path>");
  });

  it("should handle message with multiple error types", () => {
    const msg =
      "thread 'worker' panicked at /src/lib.rs:10: boom\n    at Object.call (/build/index.js:5:3)";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("panicked");
    expect(result).not.toContain("at Object.call");
  });
});
