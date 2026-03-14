import { beforeAll, describe, expect, it } from "vitest";
import { createParserAdapter } from "../src/parsers.js";
import type { ParserAdapter } from "../src/types.js";
import { ParseError } from "../src/types.js";
import type { WasmParsers } from "../src/wasm-loader.js";
import { getWasmParsers } from "../src/wasm-loader.js";

describe("parsers (WASM)", () => {
  let wasm: WasmParsers;
  let yamlAdapter: ParserAdapter;
  let jsonAdapter: ParserAdapter;
  let tomlAdapter: ParserAdapter;

  beforeAll(async () => {
    wasm = await getWasmParsers();
    yamlAdapter = createParserAdapter("yaml", wasm);
    jsonAdapter = createParserAdapter("json", wasm);
    tomlAdapter = createParserAdapter("toml", wasm);
  });

  // -------------------------------------------------------------------------
  // YAML
  // -------------------------------------------------------------------------
  describe("YAML parser", () => {
    it("should parse valid YAML", () => {
      const result = yamlAdapter.parse("title: Hello World\ncount: 42") as Record<string, unknown>;
      expect(result.title).toBe("Hello World");
      expect(result.count).toBe(42);
    });

    it("should parse nested YAML", () => {
      const result = yamlAdapter.parse("meta:\n  author: Alice\n  year: 2026") as Record<
        string,
        unknown
      >;
      expect((result.meta as Record<string, unknown>).author).toBe("Alice");
    });

    it("should parse YAML arrays", () => {
      const result = yamlAdapter.parse("tags:\n  - rust\n  - wasm\n  - typescript") as Record<
        string,
        unknown
      >;
      expect(result.tags).toEqual(["rust", "wasm", "typescript"]);
    });

    it("should parse YAML booleans and null", () => {
      const result = yamlAdapter.parse("draft: true\npublished: false\ndeleted: null") as Record<
        string,
        unknown
      >;
      expect(result.draft).toBe(true);
      expect(result.published).toBe(false);
      // serde-wasm-bindgen converts JSON null to JS undefined
      expect(result.deleted).toBeUndefined();
    });

    it("should parse YAML with Unicode content", () => {
      const result = yamlAdapter.parse(
        "title: \u4f60\u597d\u4e16\u754c\nemoji: \uD83E\uDD80",
      ) as Record<string, unknown>;
      expect(result.title).toBe("\u4f60\u597d\u4e16\u754c");
      expect(result.emoji).toBe("\uD83E\uDD80");
    });

    it("should parse YAML multiline strings", () => {
      const input = "bio: |\n  Line one\n  Line two\n";
      const result = yamlAdapter.parse(input) as Record<string, unknown>;
      expect(result.bio).toContain("Line one");
      expect(result.bio).toContain("Line two");
    });

    it("should parse YAML flow sequences", () => {
      const result = yamlAdapter.parse("tags: [a, b, c]") as Record<string, unknown>;
      expect(result.tags).toEqual(["a", "b", "c"]);
    });

    it("should throw ParseError for invalid YAML", () => {
      expect(() => yamlAdapter.parse(":\n  - invalid: [yaml: broken")).toThrow(ParseError);
    });

    it("should throw ParseError with format info", () => {
      try {
        yamlAdapter.parse(":\n  - invalid: [yaml: broken");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).format).toBe("yaml");
      }
    });
  });

  // -------------------------------------------------------------------------
  // JSON
  // -------------------------------------------------------------------------
  describe("JSON parser", () => {
    it("should parse valid JSON", () => {
      const result = jsonAdapter.parse('{"title": "Hello", "count": 42}') as Record<
        string,
        unknown
      >;
      expect(result.title).toBe("Hello");
      expect(result.count).toBe(42);
    });

    it("should parse nested JSON objects", () => {
      const result = jsonAdapter.parse('{"a": {"b": {"c": "deep"}}}') as Record<string, unknown>;
      expect(((result.a as Record<string, unknown>).b as Record<string, unknown>).c).toBe("deep");
    });

    it("should parse JSON arrays", () => {
      const result = jsonAdapter.parse('{"items": [1, "two", true, null]}') as Record<
        string,
        unknown
      >;
      // serde-wasm-bindgen converts JSON null to JS undefined
      expect(result.items).toEqual([1, "two", true, undefined]);
    });

    it("should parse JSON with Unicode escape sequences", () => {
      const result = jsonAdapter.parse(String.raw`{"text": "Hello \u4e16\u754c"}`) as Record<
        string,
        unknown
      >;
      expect(result.text).toBeDefined();
    });

    it("should parse JSON with special characters in strings", () => {
      const result = jsonAdapter.parse(
        String.raw`{"quote": "He said \"hello\"", "newline": "line1\nline2"}`,
      ) as Record<string, unknown>;
      expect(result.quote).toContain("hello");
      expect(result.newline).toContain("line1");
    });

    it("should throw ParseError for invalid JSON", () => {
      expect(() => jsonAdapter.parse("{ not valid json }")).toThrow(ParseError);
    });

    it("should throw ParseError with line/column info", () => {
      try {
        jsonAdapter.parse('{"a": invalid}');
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).format).toBe("json");
        // Error message should mention line/column
        expect((err as ParseError).message).toMatch(/line|column/i);
      }
    });

    it("should reject trailing commas", () => {
      expect(() => jsonAdapter.parse('{"a": 1,}')).toThrow(ParseError);
    });
  });

  // -------------------------------------------------------------------------
  // TOML
  // -------------------------------------------------------------------------
  describe("TOML parser", () => {
    it("should parse valid TOML", () => {
      const result = tomlAdapter.parse('title = "Hello"\ncount = 42') as Record<string, unknown>;
      expect(result.title).toBe("Hello");
      expect(result.count).toBe(42);
    });

    it("should parse TOML tables", () => {
      const input = `[meta]\nauthor = "Alice"\nyear = 2026`;
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      expect((result.meta as Record<string, unknown>).author).toBe("Alice");
    });

    it("should parse TOML nested tables", () => {
      const input = '[parent]\nkey = "val"\n\n[parent.child]\nnested = true';
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      const parent = result.parent as Record<string, unknown>;
      expect(parent.key).toBe("val");
      expect((parent.child as Record<string, unknown>).nested).toBe(true);
    });

    it("should parse TOML arrays", () => {
      const input = 'tags = ["rust", "wasm", "typescript"]';
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      expect(result.tags).toEqual(["rust", "wasm", "typescript"]);
    });

    it("should parse TOML multiline strings", () => {
      const input = 'bio = """\nLine one\nLine two\n"""';
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      expect(result.bio).toContain("Line one");
      expect(result.bio).toContain("Line two");
    });

    it("should parse TOML inline tables", () => {
      const input = "point = { x = 1, y = 2 }";
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      const point = result.point as Record<string, unknown>;
      expect(point.x).toBe(1);
      expect(point.y).toBe(2);
    });

    it("should parse TOML booleans", () => {
      const input = "draft = true\npublished = false";
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      expect(result.draft).toBe(true);
      expect(result.published).toBe(false);
    });

    it("should parse TOML datetime", () => {
      const input = "created = 2026-02-19T10:00:00Z";
      const result = tomlAdapter.parse(input) as Record<string, unknown>;
      expect(result.created).toBeDefined();
      // TOML datetime is serialized as an object by serde-wasm-bindgen
      expect(typeof result.created).toBe("object");
    });

    it("should throw ParseError for invalid TOML", () => {
      expect(() => tomlAdapter.parse("= no key here")).toThrow(ParseError);
    });

    it("should throw ParseError with format info", () => {
      try {
        tomlAdapter.parse("= no key here");
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).format).toBe("toml");
      }
    });
  });
});
