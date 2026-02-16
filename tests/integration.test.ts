import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { hasFrontMatter, parseFrontMatter } from "../src/index.js";
import { ExtractionError, ParseError, ValidationError } from "../src/types.js";

describe("parseFrontMatter — integration", () => {
  // -------------------------------------------------------------------------
  // YAML
  // -------------------------------------------------------------------------
  describe("YAML front matter", () => {
    it("should parse a full YAML markdown document", async () => {
      const source = `---
title: My Blog Post
date: 2026-01-15
tags:
  - typescript
  - rust
draft: false
---
# My Blog Post

This is the content of my blog post.`;

      const result = await parseFrontMatter(source);

      expect(result.format).toBe("yaml");
      expect(result.isEmpty).toBe(false);
      expect(result.data).toEqual({
        title: "My Blog Post",
        date: "2026-01-15",
        tags: ["typescript", "rust"],
        draft: false,
      });
      expect(result.content).toContain("# My Blog Post");
    });
  });

  // -------------------------------------------------------------------------
  // JSON
  // -------------------------------------------------------------------------
  describe("JSON front matter", () => {
    it("should parse a full JSON markdown document", async () => {
      const source = `---
{
  "title": "JSON Post",
  "count": 42,
  "published": true
}
---
# JSON Post

Content goes here.`;

      const result = await parseFrontMatter(source);

      expect(result.format).toBe("json");
      expect(result.isEmpty).toBe(false);
      expect(result.data).toEqual({
        title: "JSON Post",
        count: 42,
        published: true,
      });
      expect(result.content).toContain("# JSON Post");
    });
  });

  // -------------------------------------------------------------------------
  // TOML
  // -------------------------------------------------------------------------
  describe("TOML front matter", () => {
    it("should parse a full TOML markdown document", async () => {
      const source = `+++
title = "TOML Post"
count = 42
published = true
+++
# TOML Post

Content goes here.`;

      const result = await parseFrontMatter(source);

      expect(result.format).toBe("toml");
      expect(result.isEmpty).toBe(false);
      expect(result.data).toEqual({
        title: "TOML Post",
        count: 42,
        published: true,
      });
      expect(result.content).toContain("# TOML Post");
    });
  });

  // -------------------------------------------------------------------------
  // Valibot schema validation
  // -------------------------------------------------------------------------
  describe("schema validation", () => {
    const PostSchema = v.object({
      title: v.string(),
      count: v.number(),
    });

    it("should validate and type data when schema is provided", async () => {
      const source = `---
title: Validated
count: 7
---
Body`;

      const result = await parseFrontMatter(source, { schema: PostSchema });

      expect(result.data.title).toBe("Validated");
      expect(result.data.count).toBe(7);
    });

    it("should throw ValidationError when data does not match schema", async () => {
      const source = `---
title: 123
---
Body`;

      const StrictSchema = v.object({
        title: v.string(),
        count: v.number(),
      });

      // title is valid (YAML 123 without quotes is a number, will fail string())
      await expect(parseFrontMatter(source, { schema: StrictSchema })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Format override
  // -------------------------------------------------------------------------
  describe("format override", () => {
    it("should use the forced format instead of auto-detection", async () => {
      // Content looks like YAML but we force JSON parsing (will fail).
      const source = `---
title: Hello
---
Body`;

      await expect(parseFrontMatter(source, { format: "json" })).rejects.toThrow(ParseError);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe("edge cases", () => {
    it("should return isEmpty: true for no front matter", async () => {
      const result = await parseFrontMatter("# Just content\nNo front matter here.");
      expect(result.isEmpty).toBe(true);
      expect(result.data).toEqual({});
      expect(result.content).toBe("# Just content\nNo front matter here.");
    });

    it("should return isEmpty: true for empty string", async () => {
      const result = await parseFrontMatter("");
      expect(result.isEmpty).toBe(true);
    });

    it("should throw for unclosed delimiter", async () => {
      await expect(parseFrontMatter("---\ntitle: Broken\nNo closing")).rejects.toThrow(
        ExtractionError,
      );
    });

    it("should handle empty front matter block", async () => {
      const result = await parseFrontMatter("---\n---\n# Content");
      expect(result.isEmpty).toBe(true);
      expect(result.content).toBe("# Content");
      expect(result.data).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Input size limit
  // -------------------------------------------------------------------------
  describe("input size limit", () => {
    it("should throw FrontMatterError for oversized input (async)", async () => {
      const oversized = "a".repeat(1_048_577); // 1 byte over the limit
      await expect(parseFrontMatter(oversized)).rejects.toThrow(/Input too large/);
    });

    it("should accept input at exactly the limit (async)", async () => {
      const source = "a".repeat(1_048_576); // exactly at limit, no front matter
      const result = await parseFrontMatter(source);
      expect(result.isEmpty).toBe(true);
    });

    it("should measure size in bytes, not characters (async)", async () => {
      // Each CJK char is 3 bytes in UTF-8. 350,000 chars × 3 = 1,050,000 bytes > 1MB.
      const cjkChars = "\u4e16".repeat(350_000);
      await expect(parseFrontMatter(cjkChars)).rejects.toThrow(/Input too large/);
    });
  });

  // -------------------------------------------------------------------------
  // Excerpt integration
  // -------------------------------------------------------------------------
  describe("excerpt extraction", () => {
    it("should extract excerpt with default separator", async () => {
      const source = `---
title: Excerpt Test
---
First paragraph.

<!-- more -->

Rest of content.`;

      const result = await parseFrontMatter(source, { excerpt: true });
      expect(result.excerpt).toBe("First paragraph.");
      expect(result.data).toEqual({ title: "Excerpt Test" });
    });

    it("should extract excerpt with custom separator", async () => {
      const source = `---
title: Custom
---
Intro text.

---more---

Body.`;

      const result = await parseFrontMatter(source, {
        excerpt: { separator: "---more---" },
      });
      expect(result.excerpt).toBe("Intro text.");
    });

    it("should fall back to first paragraph when no separator", async () => {
      const source = `---
title: No Sep
---
# Heading

First real paragraph here.

Second paragraph.`;

      const result = await parseFrontMatter(source, { excerpt: true });
      expect(result.excerpt).toBe("First real paragraph here.");
    });
  });

  // -------------------------------------------------------------------------
  // rawData exposure
  // -------------------------------------------------------------------------
  describe("rawData", () => {
    it("should expose raw front matter text", async () => {
      const source = `---\ntitle: Hello\ncount: 42\n---\n# Content`;
      const result = await parseFrontMatter(source);
      expect(result.rawData).toBe("title: Hello\ncount: 42");
    });

    it("should not have rawData when isEmpty", async () => {
      const result = await parseFrontMatter("# No front matter");
      expect(result.rawData).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // YAML ... document end marker
  // -------------------------------------------------------------------------
  describe("YAML ... close marker", () => {
    it("should parse YAML closed with ...", async () => {
      const source = `---
title: Dots
tags:
  - a
  - b
...
# Content`;

      const result = await parseFrontMatter(source);
      expect(result.format).toBe("yaml");
      expect(result.isEmpty).toBe(false);
      expect(result.data).toEqual({ title: "Dots", tags: ["a", "b"] });
      expect(result.content).toBe("# Content");
    });
  });

  // -------------------------------------------------------------------------
  // BOM handling
  // -------------------------------------------------------------------------
  describe("BOM handling", () => {
    it("should parse front matter from BOM-prefixed source", async () => {
      const source = `\uFEFF---
title: BOM Test
---
# Content`;

      const result = await parseFrontMatter(source);
      expect(result.isEmpty).toBe(false);
      expect(result.data).toEqual({ title: "BOM Test" });
      expect(result.content).toBe("# Content");
    });
  });

  // -------------------------------------------------------------------------
  // hasFrontMatter quick detection
  // -------------------------------------------------------------------------
  describe("hasFrontMatter", () => {
    it("should return true for --- delimited content", () => {
      expect(hasFrontMatter("---\ntitle: Hello\n---\n# Content")).toBe(true);
    });

    it("should return true for +++ delimited content", () => {
      expect(hasFrontMatter('+++\ntitle = "Hello"\n+++\n# Content')).toBe(true);
    });

    it("should return true for ... close marker", () => {
      expect(hasFrontMatter("---\ntitle: Hello\n...\n# Content")).toBe(true);
    });

    it("should return false for no front matter", () => {
      expect(hasFrontMatter("# Just content")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(hasFrontMatter("")).toBe(false);
    });

    it("should handle BOM-prefixed source", () => {
      expect(hasFrontMatter("\uFEFF---\ntitle: Hello\n---\n# Content")).toBe(true);
    });

    it("should return false when delimiter is not at start", () => {
      expect(hasFrontMatter("some text\n---\ntitle: Hello\n---\n")).toBe(false);
    });

    it("should handle CRLF line endings", () => {
      expect(hasFrontMatter("---\r\ntitle: Hello\r\n---\r\n# Content")).toBe(true);
    });

    it("should throw for empty delimiter strings", () => {
      expect(() => hasFrontMatter("---\ntitle\n---", [{ open: "", close: "---" }])).toThrow(
        /non-empty/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Empty front matter respects user format
  // -------------------------------------------------------------------------
  describe("empty front matter with format override", () => {
    it("should return the user-specified format even when isEmpty", async () => {
      const result = await parseFrontMatter("---\n---\nBody", { format: "toml" });
      expect(result.isEmpty).toBe(true);
      expect(result.format).toBe("toml");
    });
  });
});
