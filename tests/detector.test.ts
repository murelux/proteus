import { describe, expect, it } from "vitest";
import type { DetectionResult } from "../src/detector.js";
import { detectFormat, detectFormatWithPreparsed } from "../src/detector.js";

describe("detectFormat", () => {
  it("should detect YAML for --- delimiter", () => {
    expect(detectFormat("title: Hello", { open: "---", close: "---" })).toBe("yaml");
  });

  it("should detect TOML for +++ delimiter", () => {
    expect(detectFormat('title = "Hello"', { open: "+++", close: "+++" })).toBe("toml");
  });

  it("should detect JSON when content starts with {", () => {
    expect(detectFormat('{"title": "Hello"}', { open: "---", close: "---" })).toBe("json");
  });

  it("should detect JSON with leading whitespace", () => {
    expect(detectFormat('  {"title": "Hello"}', { open: "---", close: "---" })).toBe("json");
  });

  it("should default to YAML for --- delimiter", () => {
    expect(detectFormat("key: value", { open: "---", close: "---" })).toBe("yaml");
  });

  it("should detect TOML regardless of content for +++ delimiter", () => {
    expect(detectFormat('{"looks": "like json"}', { open: "+++", close: "+++" })).toBe("toml");
  });

  it("should detect YAML for custom delimiters", () => {
    expect(detectFormat("key: value", { open: "~~~", close: "~~~" })).toBe("yaml");
  });

  it("should detect YAML for YAML flow mappings starting with {", () => {
    expect(detectFormat("{key: value, another: true}", { open: "---", close: "---" })).toBe("yaml");
  });

  it("should detect JSON for valid JSON starting with {", () => {
    expect(detectFormat('{"key": "value"}', { open: "---", close: "---" })).toBe("json");
  });

  it("should detect YAML for JSON arrays starting with [ (arrays rejected as front matter)", () => {
    expect(detectFormat("[1, 2, 3]", { open: "---", close: "---" })).toBe("yaml");
  });

  it("should detect YAML for invalid JSON-like content starting with [", () => {
    expect(detectFormat("[not: valid json]", { open: "---", close: "---" })).toBe("yaml");
  });
});

describe("detectFormatWithPreparsed", () => {
  it("should return preparsedData for valid JSON", () => {
    const result: DetectionResult = detectFormatWithPreparsed('{"title": "Hello"}', {
      open: "---",
      close: "---",
    });
    expect(result.format).toBe("json");
    expect(result.preparsedData).toEqual({ title: "Hello" });
  });

  it("should not return preparsedData for YAML", () => {
    const result = detectFormatWithPreparsed("title: Hello", { open: "---", close: "---" });
    expect(result.format).toBe("yaml");
    expect(result.preparsedData).toBeUndefined();
  });

  it("should not return preparsedData for TOML", () => {
    const result = detectFormatWithPreparsed('title = "Hello"', { open: "+++", close: "+++" });
    expect(result.format).toBe("toml");
    expect(result.preparsedData).toBeUndefined();
  });

  it("should not return preparsedData for YAML flow mappings", () => {
    const result = detectFormatWithPreparsed("{key: value}", { open: "---", close: "---" });
    expect(result.format).toBe("yaml");
    expect(result.preparsedData).toBeUndefined();
  });

  it("should reject JSON arrays as preparsedData", () => {
    const result = detectFormatWithPreparsed("[1, 2, 3]", { open: "---", close: "---" });
    expect(result.format).toBe("yaml");
    expect(result.preparsedData).toBeUndefined();
  });

  it("should not return preparsedData for invalid JSON starting with {", () => {
    const result = detectFormatWithPreparsed("{not: valid: json}", { open: "---", close: "---" });
    expect(result.format).toBe("yaml");
    expect(result.preparsedData).toBeUndefined();
  });

  it("should handle empty string", () => {
    const result = detectFormatWithPreparsed("", { open: "---", close: "---" });
    expect(result.format).toBe("yaml");
    expect(result.preparsedData).toBeUndefined();
  });

  it("should handle whitespace-only string", () => {
    const result = detectFormatWithPreparsed("   ", { open: "---", close: "---" });
    expect(result.format).toBe("yaml");
    expect(result.preparsedData).toBeUndefined();
  });
});
