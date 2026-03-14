import { describe, expect, it } from "vitest";
import { extractExcerpt } from "../src/excerpt.js";

describe("extractExcerpt", () => {
  describe("with separator", () => {
    it("should extract content before default separator", () => {
      const content = `This is the excerpt.

<!-- more -->

This is the rest of the content.`;

      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBe("This is the excerpt.");
    });

    it("should extract content before custom separator", () => {
      const content = `This is the excerpt.

---more---

This is the rest of the content.`;

      const excerpt = extractExcerpt(content, { separator: "---more---" });
      expect(excerpt).toBe("This is the excerpt.");
    });

    it("should return undefined if separator produces empty excerpt", () => {
      const content = `<!-- more -->

This is the content.`;

      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBeUndefined();
    });
  });

  describe("without separator (fallback to first paragraph)", () => {
    it("should extract first paragraph", () => {
      const content = `This is the first paragraph.

This is the second paragraph.`;

      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBe("This is the first paragraph.");
    });

    it("should skip heading-only first paragraph", () => {
      const content = `# Heading

This is the first real paragraph.

Another paragraph.`;

      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBe("This is the first real paragraph.");
    });

    it("should handle content with only heading", () => {
      const content = `# Just a Heading`;

      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should return undefined for empty content", () => {
      expect(extractExcerpt("", true)).toBeUndefined();
    });

    it("should return undefined for whitespace-only content", () => {
      expect(extractExcerpt("   \n\n   ", true)).toBeUndefined();
    });

    it("should handle single paragraph content", () => {
      const content = "Just one paragraph here.";
      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBe("Just one paragraph here.");
    });

    it("should handle multi-line first paragraph", () => {
      const content = `This is line one.
This is line two.
This is line three.

Second paragraph.`;

      const excerpt = extractExcerpt(content, true);
      expect(excerpt).toBe("This is line one.\nThis is line two.\nThis is line three.");
    });
  });
});
