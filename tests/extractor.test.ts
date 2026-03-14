import { describe, expect, it } from "vitest";
import { extractFrontMatter } from "../src/extractor.js";

describe("extractFrontMatter", () => {
  const check = (source: string, expectedRaw: string, expectedContent = "# Content") => {
    const result = extractFrontMatter(source);
    expect(result).not.toBeNull();
    expect(result?.rawData).toBe(expectedRaw);
    expect(result?.content).toBe(expectedContent);
    return result;
  };

  describe("--- delimiter", () => {
    it("should extract YAML front matter", () => {
      check("---\ntitle: Hello\n---\n# Content", "title: Hello");
    });

    it("should extract JSON front matter", () => {
      check('---\n{"title":"Hello"}\n---\n# Content', '{"title":"Hello"}');
    });

    it("should handle multi-line front matter", () => {
      check(
        "---\ntitle: Hello\ndate: 2024-01-01\ntags:\n  - a\n  - b\n---\n# Content",
        "title: Hello\ndate: 2024-01-01\ntags:\n  - a\n  - b",
      );
    });

    it("should return body content after the delimiter", () => {
      check(
        "---\ntitle: Test\n---\n# Hello\n\nParagraph here.",
        "title: Test",
        "# Hello\n\nParagraph here.",
      );
    });
  });

  describe("+++ delimiter", () => {
    it("should extract TOML front matter", () => {
      const res = check('+++\ntitle = "Hello"\n+++\n# Content', 'title = "Hello"');
      expect(res?.delimiter).toEqual({ open: "+++", close: "+++" });
    });

    it("should handle multi-line TOML", () => {
      const source = '+++\ntitle = "Hello"\ncount = 42\n\n[author]\nname = "Alice"\n+++\n# Content';
      const result = extractFrontMatter(source);
      expect(result?.rawData).toContain('title = "Hello"');
      expect(result?.rawData).toContain("[author]");
    });
  });

  describe("edge cases", () => {
    it("should return null for empty or whitespace strings", () => {
      expect(extractFrontMatter("")).toBeNull();
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
      check("---\n---\n# Content", "");
    });

    it("should handle Windows-style line endings", () => {
      check("---\r\ntitle: Hello\r\n---\r\n# Content", "title: Hello");
    });

    it("should strip UTF-8 BOM", () => {
      check("\uFEFF---\ntitle: Hello\n---\n# Content", "title: Hello");
      check("\uFEFF---\r\ntitle: BOM\r\n---\r\n# Content", "title: BOM");
    });
  });

  describe("YAML ... close marker", () => {
    it("should extract with ... marker", () => {
      const res = check("---\ntitle: Hello\n...\n# Content", "title: Hello");
      expect(res?.delimiter).toEqual({ open: "---", close: "..." });
    });

    it("should handle empty with ... close", () => {
      check("---\n...\n# Content", "");
    });
  });

  describe("custom delimiters", () => {
    it("should support symmetric and asymmetric delimiters", () => {
      const res1 = extractFrontMatter("~~~\ntitle: Hello\n~~~\n# Content", [
        { open: "~~~", close: "~~~" },
      ]);
      expect(res1?.rawData).toBe("title: Hello");

      const res2 = extractFrontMatter("<!--\ntitle: Hello\n-->\n# Content", [
        { open: "<!--", close: "-->" },
      ]);
      expect(res2?.rawData).toBe("title: Hello");
    });

    it("should return null when custom delimiters don't match", () => {
      expect(
        extractFrontMatter("---\ntitle: Hello\n---\n# Content", [{ open: "~~~", close: "~~~" }]),
      ).toBeNull();
    });

    it("should try multiple custom delimiters in order", () => {
      const result = extractFrontMatter(";;;;\nkey = 1\n;;;;\n# Content", [
        { open: "---", close: "---" },
        { open: ";;;;", close: ";;;;" },
      ]);
      expect(result?.rawData).toBe("key = 1");
    });
  });

  describe("delimiter validation", () => {
    it("should throw for empty delimiters", () => {
      expect(() => extractFrontMatter("c", [{ open: "", close: "---" }])).toThrow(/non-empty/);
      expect(() => extractFrontMatter("c", [{ open: "---", close: "" }])).toThrow(/non-empty/);
    });
  });
});
