import { beforeAll, describe, expect, it } from "vitest";
import { initWasm, parseFrontMatter } from "../src/index.js";

describe("Markdown AST Extraction", () => {
  beforeAll(async () => {
    // Ensure WASM is loaded before tests
    await initWasm();
  });

  it("should extract headings with generated slug IDs", async () => {
    const source = `---
title: Test
---
# Main Heading
Some text.
## 2nd Level-Heading!
More text.
### A Heading with Emoji 🚀
`;
    const result = await parseFrontMatter(source, { extractAst: true });

    expect(result.isEmpty).toBe(false);
    expect(result.ast).toBeDefined();
    expect(result.ast?.headings).toHaveLength(3);

    // Check heading structures
    expect(result.ast?.headings[0]).toEqual({
      level: 1,
      text: "Main Heading",
      id: "main-heading",
    });

    expect(result.ast?.headings[1]).toEqual({
      level: 2,
      text: "2nd Level-Heading!",
      id: "2nd-level-heading",
    });

    expect(result.ast?.headings[2]).toEqual({
      level: 3,
      text: "A Heading with Emoji 🚀",
      id: "a-heading-with-emoji",
    });
  });

  it("should extract links and images", async () => {
    const source = `---
type: doc
---
Check out [this link](https://example.com) and this picture:
![An image](/path/to/img.png)
`;
    const result = await parseFrontMatter(source, { extractAst: true });

    expect(result.ast?.links).toBeDefined();
    expect(result.ast?.links).toHaveLength(1);
    expect(result.ast?.links[0]).toEqual({
      text: "this link",
      url: "https://example.com",
    });

    expect(result.ast?.images).toBeDefined();
    expect(result.ast?.images).toHaveLength(1);
    expect(result.ast?.images[0]).toEqual({
      alt: "An image",
      url: "/path/to/img.png",
    });
  });

  it("should extract code blocks", async () => {
    const source = `---
type: code
---
Here is some code:

\`\`\`typescript
const x = 42;
\`\`\`

And without language:

\`\`\`
Plain text block.
\`\`\`
`;
    const result = await parseFrontMatter(source, { extractAst: true });

    expect(result.ast?.code_blocks).toBeDefined();
    expect(result.ast?.code_blocks).toHaveLength(2);
    expect(result.ast?.code_blocks[0]).toEqual({
      language: "typescript",
      code: "const x = 42;\n",
    });
    expect(result.ast?.code_blocks[1]).toEqual({
      language: undefined,
      code: "Plain text block.\n",
    });
  });

  it("should extract simple paragraph excerpts", async () => {
    const source = `---
title: Excerpt
---
This is the first paragraph. It has **bold** and \`code\`.

This is the second paragraph.
`;
    const result = await parseFrontMatter(source, { extractAst: true });

    expect(result.ast?.excerpt).toBeDefined();
    expect(result.ast?.excerpt).toBe("This is the first paragraph. It has bold and code .");
  });

  it("should not crash or be undefined if no AST is requested", async () => {
    const source = `---
title: Skip AST
---
# Heading
`;
    // Standard extraction
    const result = await parseFrontMatter(source);

    expect(result.isEmpty).toBe(false);
    expect(result.ast).toBeUndefined();
  });
});
