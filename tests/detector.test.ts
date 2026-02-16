import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/detector.js";

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

  it("should detect JSON for JSON arrays starting with [", () => {
    expect(detectFormat("[1, 2, 3]", { open: "---", close: "---" })).toBe("json");
  });

  it("should detect YAML for invalid JSON-like content starting with [", () => {
    expect(detectFormat("[not: valid json]", { open: "---", close: "---" })).toBe("yaml");
  });
});
