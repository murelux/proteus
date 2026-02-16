import { describe, expect, it } from "vitest";
import { parseFrontMatter, stringifyFrontMatter } from "../src/index.js";

describe("stringify → parse roundtrip", () => {
  // -------------------------------------------------------------------------
  // YAML
  // -------------------------------------------------------------------------

  it("should roundtrip simple YAML data", async () => {
    const original = { title: "Hello World", count: 42, draft: false };
    const content = "# My Post\n\nBody content here.";

    const markdown = await stringifyFrontMatter(original, content);
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
    expect(result.content.trim()).toBe(content.trim());
    expect(result.format).toBe("yaml");
  });

  it("should roundtrip YAML with arrays", async () => {
    const original = { tags: ["typescript", "rust", "wasm"] };
    const content = "Content";

    const markdown = await stringifyFrontMatter(original, content);
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
  });

  it("should roundtrip YAML with nested objects", async () => {
    const original = {
      title: "Post",
      author: { name: "Alice", email: "alice@example.com" },
    };
    const content = "# Title";

    const markdown = await stringifyFrontMatter(original, content);
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
  });

  // -------------------------------------------------------------------------
  // JSON
  // -------------------------------------------------------------------------

  it("should roundtrip JSON data", async () => {
    const original = { title: "JSON Post", count: 42, published: true };
    const content = "# JSON Content";

    const markdown = await stringifyFrontMatter(original, content, { format: "json" });
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
    expect(result.format).toBe("json");
  });

  it("should roundtrip JSON with nested structures", async () => {
    const original = {
      meta: { version: 1, tags: ["a", "b"] },
    };
    const content = "Body";

    const markdown = await stringifyFrontMatter(original, content, { format: "json" });
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
  });

  // -------------------------------------------------------------------------
  // TOML
  // -------------------------------------------------------------------------

  it("should roundtrip TOML data", async () => {
    const original = { title: "TOML Post", count: 42 };
    const content = "# TOML Content";

    const markdown = await stringifyFrontMatter(original, content, { format: "toml" });
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
    expect(result.format).toBe("toml");
  });

  it("should roundtrip TOML with nested tables", async () => {
    const original = {
      title: "Test",
      author: { name: "Bob", active: true },
    };
    const content = "Content";

    const markdown = await stringifyFrontMatter(original, content, { format: "toml" });
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("should roundtrip empty content", async () => {
    const original = { title: "No Content" };

    const markdown = await stringifyFrontMatter(original, "");
    const result = await parseFrontMatter(markdown);

    expect(result.data).toEqual(original);
  });

  it("should roundtrip with custom delimiter", async () => {
    const original = { title: "Custom" };
    const content = "Body";
    const delimiter = { open: "~~~", close: "~~~" };

    const markdown = await stringifyFrontMatter(original, content, { delimiter });
    const result = await parseFrontMatter(markdown, { delimiters: [delimiter] });

    expect(result.data).toEqual(original);
    expect(result.content.trim()).toBe(content);
  });

  it("should preserve data fidelity through multiple roundtrips", async () => {
    const original = { title: "Multi", version: 3 };
    const content = "# Hello";

    // First roundtrip
    const md1 = await stringifyFrontMatter(original, content);
    const r1 = await parseFrontMatter(md1);

    // Second roundtrip
    const md2 = await stringifyFrontMatter(r1.data as Record<string, unknown>, r1.content);
    const r2 = await parseFrontMatter(md2);

    expect(r2.data).toEqual(original);
  });
});
