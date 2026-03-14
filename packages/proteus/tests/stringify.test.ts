import { beforeAll, describe, expect, it } from "vitest";
import { initWasm, stringifyFrontMatter, stringifyFrontMatterSync } from "../src/index.js";

describe("stringifyFrontMatter", () => {
  describe("async", () => {
    it("should stringify to YAML by default", async () => {
      const data = { title: "Hello", count: 42 };
      const content = "# Content here";

      const result = await stringifyFrontMatter(data, content);

      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---\n/);
      expect(result).toContain("title:");
      expect(result).toContain("Hello");
      expect(result).toContain("# Content here");
      expect(result.endsWith("\n")).toBe(true);
    });

    it("should stringify to JSON", async () => {
      const data = { title: "Hello", count: 42 };
      const content = "# Content";

      const result = await stringifyFrontMatter(data, content, { format: "json" });

      // Should wrap JSON in --- delimiters
      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---\n/);
      // JSON must have quoted keys
      expect(result).toContain('"title"');
      expect(result).toContain('"Hello"');
      expect(result).toContain("42");
      // Verify parseable JSON between delimiters
      const jsonBlock = result.split("---")[1].trim();
      const parsed = JSON.parse(jsonBlock);
      expect(parsed.title).toBe("Hello");
      expect(parsed.count).toBe(42);
    });

    it("should stringify to TOML with +++ delimiter", async () => {
      const data = { title: "Hello", count: 42 };
      const content = "# Content";

      const result = await stringifyFrontMatter(data, content, { format: "toml" });

      // TOML uses +++ delimiters
      expect(result).toMatch(/^\+\+\+\n/);
      expect(result).toMatch(/\n\+\+\+\n/);
      expect(result).toContain('title = "Hello"');
      expect(result).toContain("count = 42");
      expect(result).toContain("# Content");
    });

    it("should use custom delimiter", async () => {
      const data = { title: "Test" };
      const content = "Content";

      const result = await stringifyFrontMatter(data, content, {
        delimiter: { open: "~~~", close: "~~~" },
      });

      expect(result).toMatch(/^~~~\n/);
      expect(result).toMatch(/\n~~~\n/);
      expect(result.split("~~~").length).toBe(3);
    });

    it("should handle empty content", async () => {
      const data = { title: "Test" };

      const result = await stringifyFrontMatter(data, "");

      expect(result).toMatch(/^---\n/);
      expect(result).toContain("title:");
      expect(result.endsWith("\n")).toBe(true);
    });

    it("should return content only when data is empty object", async () => {
      const result = await stringifyFrontMatter({}, "# Hello World");
      expect(result).toBe("# Hello World");
      expect(result).not.toContain("---");
    });

    it("should return empty content when data is empty and content is empty", async () => {
      const result = await stringifyFrontMatter({}, "");
      expect(result).toBe("");
    });

    it("should handle complex nested data", async () => {
      const data = {
        title: "Test",
        tags: ["a", "b", "c"],
        author: { name: "Alice", email: "alice@example.com" },
      };

      const result = await stringifyFrontMatter(data, "# Content");

      expect(result).toMatch(/^---\n/);
      expect(result).toContain("tags:");
      expect(result).toContain("author:");
      expect(result).toContain("Alice");
      expect(result).toContain("alice@example.com");
    });
  });

  // Sync stringify tests — require WASM to be pre-initialised.
  // The "not initialized" guard is covered by sync.test.ts and wasm-loader.test.ts.
  describe("sync", () => {
    beforeAll(async () => {
      await initWasm();
    });

    it("should stringify synchronously after initWasm", () => {
      const result = stringifyFrontMatterSync({ title: "Hello" }, "# Content");

      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---\n/);
      expect(result).toContain("title:");
      expect(result).toContain("Hello");
      expect(result).toContain("# Content");
    });

    it("should stringify to JSON synchronously", () => {
      const result = stringifyFrontMatterSync({ title: "Hello" }, "# Content", {
        format: "json",
      });

      expect(result).toMatch(/^---\n/);
      expect(result).toContain('"title"');
      expect(result).toContain('"Hello"');
    });

    it("should stringify to TOML synchronously", () => {
      const result = stringifyFrontMatterSync({ title: "Hello", count: 42 }, "# Content", {
        format: "toml",
      });

      expect(result).toMatch(/^\+\+\+\n/);
      expect(result).toMatch(/\n\+\+\+\n/);
      expect(result).toContain('title = "Hello"');
      expect(result).toContain("count = 42");
    });
  });

  describe("error handling", () => {
    it("should throw for null data (async)", async () => {
      await expect(
        stringifyFrontMatter(null as unknown as Record<string, unknown>, "content"),
      ).rejects.toThrow(/plain object/);
    });

    it("should throw for array data (async)", async () => {
      await expect(
        stringifyFrontMatter([] as unknown as Record<string, unknown>, "content"),
      ).rejects.toThrow(/plain object/);
    });

    it("should throw for null data (sync)", () => {
      expect(() =>
        stringifyFrontMatterSync(null as unknown as Record<string, unknown>, "content"),
      ).toThrow(/plain object/);
    });

    it("should throw for array data (sync)", () => {
      expect(() =>
        stringifyFrontMatterSync([] as unknown as Record<string, unknown>, "content"),
      ).toThrow(/plain object/);
    });

    it("should reject oversized stringify output", async () => {
      // Build a data object whose serialized YAML exceeds 1 MB.
      const big: Record<string, string> = {};
      for (let i = 0; i < 20_000; i++) {
        big[`key_${i}`] = "x".repeat(60);
      }
      await expect(stringifyFrontMatter(big, "content")).rejects.toThrow(
        /too large|Output too large/,
      );
    });
  });
});
