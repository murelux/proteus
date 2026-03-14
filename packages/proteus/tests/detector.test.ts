import { describe, expect, it } from "vitest";
import { detectFormat, detectFormatWithPreparsed } from "../src/detector.js";

describe("detectFormat", () => {
  const yamlDelim = { open: "---", close: "---" };
  const tomlDelim = { open: "+++", close: "+++" };

  it("should detect basic formats", () => {
    expect(detectFormat("title: Hello", yamlDelim)).toBe("yaml");
    expect(detectFormat('title = "Hello"', tomlDelim)).toBe("toml");
  });

  it("should detect JSON for braced content", () => {
    expect(detectFormat('{"title": "Hello"}', yamlDelim)).toBe("json");
    expect(detectFormat('  {"title": "Hello"}', yamlDelim)).toBe("json");
    expect(detectFormat('{"key": "value"}', yamlDelim)).toBe("json");
  });

  it("should default to YAML for ambiguities", () => {
    expect(detectFormat("key: value", yamlDelim)).toBe("yaml");
    expect(detectFormat("key: value", { open: "~~~", close: "~~~" })).toBe("yaml");
    expect(detectFormat("{key: value, another: true}", yamlDelim)).toBe("yaml");
    expect(detectFormat("[1, 2, 3]", yamlDelim)).toBe("yaml");
    expect(detectFormat("[not: valid json]", yamlDelim)).toBe("yaml");
  });

  it("should honor explicit TOML delimiter", () => {
    expect(detectFormat('{"looks": "like json"}', tomlDelim)).toBe("toml");
  });
});

describe("detectFormatWithPreparsed", () => {
  const yamlDelim = { open: "---", close: "---" };

  it("should return preparsedData for valid JSON objects", () => {
    const res = detectFormatWithPreparsed('{"title": "Hello"}', yamlDelim);
    expect(res.format).toBe("json");
    expect(res.preparsedData).toEqual({ title: "Hello" });
  });

  it("should not return preparsedData for non-JSON or invalid JSON", () => {
    const cases = ["title: Hello", "{key: value}", "[1, 2, 3]", "{not: valid}", "", "   "];
    for (const c of cases) {
      const res = detectFormatWithPreparsed(c, yamlDelim);
      expect(res.preparsedData).toBeUndefined();
    }
  });

  it("should not return preparsedData for TOML even if looking like JSON", () => {
    const result = detectFormatWithPreparsed('title = "Hello"', { open: "+++", close: "+++" });
    expect(result.format).toBe("toml");
    expect(result.preparsedData).toBeUndefined();
  });
});
