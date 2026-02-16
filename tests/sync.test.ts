import { beforeAll, describe, expect, it } from "vitest";
import { initWasm, parseFrontMatter, parseFrontMatterSync } from "../src/index.js";
import { _resetWasmCache } from "../src/wasm-loader.js";

describe("parseFrontMatterSync", () => {
  describe("without initWasm", () => {
    it("should throw if WASM is not initialized", () => {
      _resetWasmCache();
      expect(() => parseFrontMatterSync("---\ntitle: Hello\n---\n# Content")).toThrow(
        /WASM not initialized/,
      );
    });
  });

  describe("with initWasm", () => {
    beforeAll(async () => {
      await initWasm();
    });

    it("should parse YAML synchronously", () => {
      const result = parseFrontMatterSync("---\ntitle: Hello\n---\n# Content");
      expect(result.data).toEqual({ title: "Hello" });
      expect(result.format).toBe("yaml");
      expect(result.content).toBe("# Content");
      expect(result.isEmpty).toBe(false);
    });

    it("should parse JSON synchronously", () => {
      const result = parseFrontMatterSync('---\n{"title": "Hello", "count": 42}\n---\n# Content');
      expect(result.data).toEqual({ title: "Hello", count: 42 });
      expect(result.format).toBe("json");
    });

    it("should parse TOML synchronously", () => {
      const result = parseFrontMatterSync('+++\ntitle = "Hello"\ncount = 42\n+++\n# Content');
      expect(result.data).toEqual({ title: "Hello", count: 42 });
      expect(result.format).toBe("toml");
    });

    it("should return empty result for no front matter", () => {
      const result = parseFrontMatterSync("# Just content");
      expect(result.data).toEqual({});
      expect(result.isEmpty).toBe(true);
    });

    it("should support custom delimiters", () => {
      const result = parseFrontMatterSync("~~~\ntitle: Hello\n~~~\n# Content", {
        delimiters: [{ open: "~~~", close: "~~~" }],
      });
      expect(result.data).toEqual({ title: "Hello" });
      expect(result.format).toBe("yaml");
    });

    it("should support format override", () => {
      const result = parseFrontMatterSync('---\n{"key": "value"}\n---\n# Content', {
        format: "json",
      });
      expect(result.data).toEqual({ key: "value" });
      expect(result.format).toBe("json");
    });

    it("should throw FrontMatterError for oversized input (sync)", () => {
      const oversized = "a".repeat(1_048_577);
      expect(() => parseFrontMatterSync(oversized)).toThrow(/Input too large/);
    });

    it("should measure size in bytes, not characters (sync)", () => {
      // Each CJK char is 3 bytes in UTF-8. 350,000 chars × 3 = 1,050,000 bytes > 1MB.
      const cjkChars = "\u4e16".repeat(350_000);
      expect(() => parseFrontMatterSync(cjkChars)).toThrow(/Input too large/);
    });

    it("should return correct content for empty front matter block", () => {
      const result = parseFrontMatterSync("---\n---\n# Content");
      expect(result.isEmpty).toBe(true);
      expect(result.content).toBe("# Content");
    });
  });
});

describe("error recovery (strict: false)", () => {
  describe("async", () => {
    it("should return error instead of throwing when strict is false", async () => {
      const result = await parseFrontMatter("---\n{invalid json\n---\n# Content", {
        format: "json",
        strict: false,
      });
      expect(result.error).toBeDefined();
      expect(result.data).toEqual({});
      expect(result.isEmpty).toBe(false);
      expect(result.content).toBe("# Content");
      expect(result.rawData).toBe("{invalid json");
    });

    it("should still throw extraction errors even with strict: false", async () => {
      await expect(parseFrontMatter("---\nunclosed block", { strict: false })).rejects.toThrow(
        /Unclosed front matter block/,
      );
    });
  });

  describe("sync", () => {
    beforeAll(async () => {
      await initWasm();
    });

    it("should return error instead of throwing when strict is false", () => {
      const result = parseFrontMatterSync("---\n{invalid json\n---\n# Content", {
        format: "json",
        strict: false,
      });
      expect(result.error).toBeDefined();
      expect(result.data).toEqual({});
      expect(result.isEmpty).toBe(false);
    });

    it("should throw normally when strict is true (default)", () => {
      expect(() =>
        parseFrontMatterSync("---\n{invalid json\n---\n# Content", {
          format: "json",
        }),
      ).toThrow();
    });
  });
});
