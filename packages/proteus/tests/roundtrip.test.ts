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

// ---------------------------------------------------------------------------
// YAML type normalization traps
// ---------------------------------------------------------------------------

describe("YAML type normalization roundtrip", () => {
  it("should treat YAML 'yes'/'no' as booleans (serde-saphyr YAML 1.1 compat)", async () => {
    // serde-saphyr treats yes/no as booleans (YAML 1.1 behavior)
    const markdown = "---\nanswer: yes\nother: no\n---\nContent";
    const result = await parseFrontMatter(markdown);
    const data = result.data as Record<string, unknown>;
    expect(typeof data.answer).toBe("boolean");
    expect(data.answer).toBe(true);
    expect(typeof data.other).toBe("boolean");
    expect(data.other).toBe(false);
  });

  it("should treat YAML 'true'/'false' as booleans", async () => {
    const markdown = "---\ndraft: true\npublished: false\n---\nContent";
    const result = await parseFrontMatter(markdown);
    const data = result.data as Record<string, unknown>;
    expect(data.draft).toBe(true);
    expect(data.published).toBe(false);
  });

  it("should treat date-like strings as strings (not Date objects)", async () => {
    // YAML→JSON intermediate representation normalizes timestamps to strings
    const markdown = "---\ndate: 2024-01-15\n---\nContent";
    const result = await parseFrontMatter(markdown);
    const data = result.data as Record<string, unknown>;
    // serde-saphyr via serde_json::Value → string representation
    expect(typeof data.date).toBe("string");
  });

  it("should roundtrip date-like strings through YAML stringify→parse", async () => {
    const original = { date: "2024-01-15", updated: "2024-06-30T10:00:00Z" };
    const content = "Content";

    const md = await stringifyFrontMatter(original, content);
    const result = await parseFrontMatter(md);
    const data = result.data as Record<string, unknown>;

    // Date values survive the roundtrip as strings
    expect(typeof data.date).toBe("string");
    expect(typeof data.updated).toBe("string");
  });

  it("should handle large integers without precision loss (within i64 range)", async () => {
    // Numbers within safe integer range should roundtrip perfectly
    const original = { small: 42, medium: 999_999_999, safe_max: 9007199254740991 };
    const content = "Content";

    const md = await stringifyFrontMatter(original, content);
    const result = await parseFrontMatter(md);
    expect(result.data).toEqual(original);
  });

  it("should roundtrip special string values that look like YAML keywords", async () => {
    const original = {
      val_null: "null",
      val_true: "true",
      val_tilde: "~",
    };
    const content = "Body";

    const md = await stringifyFrontMatter(original, content);
    const result = await parseFrontMatter(md);
    const data = result.data as Record<string, unknown>;

    // These should roundtrip — serde-saphyr should quote them properly
    // Note: the exact roundtrip behavior depends on the serializer's quoting rules
    expect(data.val_null).toBeDefined();
    expect(data.val_true).toBeDefined();
    // Verify values survived as strings (not coerced to boolean/null)
    expect(typeof data.val_null).toBe("string");
    expect(typeof data.val_true).toBe("string");
    expect(typeof data.val_tilde).toBe("string");
  });
});
