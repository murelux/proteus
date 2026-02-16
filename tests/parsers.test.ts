import { describe, expect, it } from "vitest";
import { createParserAdapter } from "../src/parsers.js";
import { ParseError } from "../src/types.js";
import { getWasmParsers } from "../src/wasm-loader.js";

describe("parsers (WASM)", () => {
  // -------------------------------------------------------------------------
  // YAML
  // -------------------------------------------------------------------------
  describe("YAML parser", () => {
    it("should parse valid YAML", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("yaml", wasm);
      const result = adapter.parse("title: Hello World\ncount: 42") as Record<string, unknown>;

      expect(result.title).toBe("Hello World");
      expect(result.count).toBe(42);
    });

    it("should parse nested YAML", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("yaml", wasm);
      const result = adapter.parse("meta:\n  author: Alice\n  year: 2026") as Record<
        string,
        unknown
      >;

      expect((result.meta as Record<string, unknown>).author).toBe("Alice");
    });

    it("should throw ParseError for invalid YAML", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("yaml", wasm);

      expect(() => adapter.parse(":\n  - invalid: [yaml: broken")).toThrow(ParseError);
    });
  });

  // -------------------------------------------------------------------------
  // JSON
  // -------------------------------------------------------------------------
  describe("JSON parser", () => {
    it("should parse valid JSON", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("json", wasm);
      const result = adapter.parse('{"title": "Hello", "count": 42}') as Record<string, unknown>;

      expect(result.title).toBe("Hello");
      expect(result.count).toBe(42);
    });

    it("should throw ParseError for invalid JSON", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("json", wasm);

      expect(() => adapter.parse("{ not valid json }")).toThrow(ParseError);
    });
  });

  // -------------------------------------------------------------------------
  // TOML
  // -------------------------------------------------------------------------
  describe("TOML parser", () => {
    it("should parse valid TOML", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("toml", wasm);
      const result = adapter.parse('title = "Hello"\ncount = 42') as Record<string, unknown>;

      expect(result.title).toBe("Hello");
      expect(result.count).toBe(42);
    });

    it("should parse TOML tables", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("toml", wasm);
      const input = `[meta]
author = "Alice"
year = 2026`;
      const result = adapter.parse(input) as Record<string, unknown>;

      expect((result.meta as Record<string, unknown>).author).toBe("Alice");
    });

    it("should throw ParseError for invalid TOML", async () => {
      const wasm = await getWasmParsers();
      const adapter = createParserAdapter("toml", wasm);

      expect(() => adapter.parse("= no key here")).toThrow(ParseError);
    });
  });
});
