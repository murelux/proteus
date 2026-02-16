import { describe, expect, it } from "vitest";
import { extractFrontMatter } from "../src/extractor.js";

describe("extractFrontMatter", () => {
  // ------------------------------------------------------------------
  // YAML / JSON (--- delimiter)
  // ------------------------------------------------------------------
  describe("--- delimiter", () => {
    it("should extract YAML front matter", () => {
      const source = "---\ntitle: Hello\n---\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello");
      expect(result?.content).toBe("# Content");
      expect(result?.delimiter).toEqual({ open: "---", close: "---" });
    });

    it("should extract JSON front matter", () => {
      const source = '---\n{"title":"Hello"}\n---\n# Content';
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe('{"title":"Hello"}');
      expect(result?.content).toBe("# Content");
    });

    it("should handle multi-line front matter", () => {
      const source = "---\ntitle: Hello\ndate: 2024-01-01\ntags:\n  - a\n  - b\n---\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello\ndate: 2024-01-01\ntags:\n  - a\n  - b");
    });

    it("should return body content after the delimiter", () => {
      const source = "---\ntitle: Test\n---\n# Hello\n\nParagraph here.";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.content).toBe("# Hello\n\nParagraph here.");
    });
  });

  // ------------------------------------------------------------------
  // TOML (+++ delimiter)
  // ------------------------------------------------------------------
  describe("+++ delimiter", () => {
    it("should extract TOML front matter", () => {
      const source = '+++\ntitle = "Hello"\n+++\n# Content';
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe('title = "Hello"');
      expect(result?.content).toBe("# Content");
      expect(result?.delimiter).toEqual({ open: "+++", close: "+++" });
    });

    it("should handle multi-line TOML", () => {
      const source = '+++\ntitle = "Hello"\ncount = 42\n\n[author]\nname = "Alice"\n+++\n# Content';
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toContain('title = "Hello"');
      expect(result?.rawData).toContain("[author]");
    });
  });

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------
  describe("edge cases", () => {
    it("should return null for empty string", () => {
      expect(extractFrontMatter("")).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      expect(extractFrontMatter("   \n\n  ")).toBeNull();
    });

    it("should return null when no front matter is present", () => {
      expect(extractFrontMatter("# Just a heading\n\nSome content.")).toBeNull();
    });

    it("should throw for unclosed delimiter", () => {
      expect(() => extractFrontMatter("---\ntitle: Hello\n")).toThrow(
        /Unclosed front matter block/,
      );
    });

    it("should handle empty front matter block", () => {
      const result = extractFrontMatter("---\n---\n# Content");
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("");
      expect(result?.content).toBe("# Content");
    });

    it("should handle Windows-style line endings", () => {
      const source = "---\r\ntitle: Hello\r\n---\r\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello");
    });

    it("should strip UTF-8 BOM and extract front matter", () => {
      const source = "\uFEFF---\ntitle: Hello\n---\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello");
      expect(result?.content).toBe("# Content");
    });

    it("should strip BOM with Windows line endings", () => {
      const source = "\uFEFF---\r\ntitle: BOM\r\n---\r\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: BOM");
    });
  });

  // ------------------------------------------------------------------
  // YAML ... document end marker
  // ------------------------------------------------------------------
  describe("YAML ... close marker", () => {
    it("should extract YAML with ... closing delimiter", () => {
      const source = "---\ntitle: Hello\n...\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello");
      expect(result?.content).toBe("# Content");
      expect(result?.delimiter).toEqual({ open: "---", close: "..." });
    });

    it("should handle empty front matter with ... close", () => {
      const source = "---\n...\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("");
      expect(result?.content).toBe("# Content");
    });

    it("should handle multi-line YAML with ... close", () => {
      const source = "---\ntitle: Hello\ndate: 2026-01-01\n...\n# Content";
      const result = extractFrontMatter(source);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello\ndate: 2026-01-01");
    });
  });

  // ------------------------------------------------------------------
  // Custom delimiters
  // ------------------------------------------------------------------
  describe("custom delimiters", () => {
    it("should support symmetric custom delimiters", () => {
      const source = "~~~\ntitle: Hello\n~~~\n# Content";
      const result = extractFrontMatter(source, [{ open: "~~~", close: "~~~" }]);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello");
      expect(result?.content).toBe("# Content");
      expect(result?.delimiter).toEqual({ open: "~~~", close: "~~~" });
    });

    it("should support asymmetric delimiters", () => {
      const source = "<!--\ntitle: Hello\n-->\n# Content";
      const result = extractFrontMatter(source, [{ open: "<!--", close: "-->" }]);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("title: Hello");
      expect(result?.content).toBe("# Content");
      expect(result?.delimiter).toEqual({ open: "<!--", close: "-->" });
    });

    it("should return null when custom delimiters don't match", () => {
      const source = "---\ntitle: Hello\n---\n# Content";
      const result = extractFrontMatter(source, [{ open: "~~~", close: "~~~" }]);
      expect(result).toBeNull();
    });

    it("should try multiple custom delimiters in order", () => {
      const source = ";;;;\nkey = 1\n;;;;\n# Content";
      const result = extractFrontMatter(source, [
        { open: "---", close: "---" },
        { open: ";;;;", close: ";;;;" },
      ]);
      expect(result).not.toBeNull();
      expect(result?.rawData).toBe("key = 1");
      expect(result?.delimiter).toEqual({ open: ";;;;", close: ";;;;" });
    });
  });

  // ------------------------------------------------------------------
  // Delimiter validation
  // ------------------------------------------------------------------
  describe("delimiter validation", () => {
    it("should throw for empty open delimiter", () => {
      expect(() => extractFrontMatter("some content", [{ open: "", close: "---" }])).toThrow(
        /non-empty/,
      );
    });

    it("should throw for empty close delimiter", () => {
      expect(() => extractFrontMatter("some content", [{ open: "---", close: "" }])).toThrow(
        /non-empty/,
      );
    });

    it("should throw for both empty delimiters", () => {
      expect(() => extractFrontMatter("some content", [{ open: "", close: "" }])).toThrow(
        /non-empty/,
      );
    });
  });
});
