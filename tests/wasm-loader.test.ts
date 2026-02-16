import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetWasmCache,
  getWasmParsers,
  getWasmParsersSync,
  initWasm,
} from "../src/wasm-loader.js";

describe("wasm-loader", () => {
  // -------------------------------------------------------------------------
  // Sync access guard
  // -------------------------------------------------------------------------

  describe("getWasmParsersSync", () => {
    beforeEach(() => {
      _resetWasmCache();
    });

    it("should throw when WASM has not been initialized", () => {
      expect(() => getWasmParsersSync()).toThrow(/WASM not initialized/);
    });

    it("should return the module after initWasm()", async () => {
      await initWasm();
      const mod = getWasmParsersSync();
      expect(mod).toBeDefined();
      expect(typeof mod.parse_yaml).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // Lazy loading and caching
  // -------------------------------------------------------------------------

  describe("getWasmParsers (async)", () => {
    beforeEach(() => {
      _resetWasmCache();
    });

    it("should load and return WASM parsers", async () => {
      const mod = await getWasmParsers();
      expect(mod).toBeDefined();
      expect(typeof mod.parse_yaml).toBe("function");
      expect(typeof mod.parse_json).toBe("function");
      expect(typeof mod.parse_toml).toBe("function");
      expect(typeof mod.stringify_yaml).toBe("function");
      expect(typeof mod.stringify_json).toBe("function");
      expect(typeof mod.stringify_toml).toBe("function");
    });

    it("should cache the module on subsequent calls", async () => {
      const first = await getWasmParsers();
      const second = await getWasmParsers();
      expect(first).toBe(second);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent deduplication
  // -------------------------------------------------------------------------

  describe("concurrent init deduplication", () => {
    beforeEach(() => {
      _resetWasmCache();
    });

    it("should deduplicate concurrent getWasmParsers calls", async () => {
      const [a, b, c] = await Promise.all([getWasmParsers(), getWasmParsers(), getWasmParsers()]);
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
  });

  // -------------------------------------------------------------------------
  // initWasm
  // -------------------------------------------------------------------------

  describe("initWasm", () => {
    beforeEach(() => {
      _resetWasmCache();
    });

    it("should pre-initialise the WASM module", async () => {
      await initWasm();
      // After initWasm, sync access should work
      expect(() => getWasmParsersSync()).not.toThrow();
    });

    it("should be idempotent", async () => {
      await initWasm();
      await initWasm();
      const mod = getWasmParsersSync();
      expect(mod).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  describe("_resetWasmCache", () => {
    it("should clear the cached module", async () => {
      await initWasm();
      expect(() => getWasmParsersSync()).not.toThrow();

      _resetWasmCache();
      expect(() => getWasmParsersSync()).toThrow(/WASM not initialized/);
    });

    it("should allow re-initialisation after reset", async () => {
      await initWasm();
      _resetWasmCache();
      await initWasm();
      expect(() => getWasmParsersSync()).not.toThrow();
    });
  });
});
