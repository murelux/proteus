/// <reference lib="deno.ns" />
/**
 * Deno test file for proteus
 *
 * Run with: deno test --allow-read --allow-write tests/deno.test.ts
 */

// Import from source (Deno can import TS directly)
import {
  extractExcerpt,
  extractFrontMatter,
  initWasm,
  type ParseResult,
  ProteusIndexer,
  parseFrontMatter,
  parseFrontMatterSync,
  stringifyFrontMatter,
  stringifyFrontMatterSync,
} from "../src/index.ts";
import { assertEquals, assertExists } from "./deno_assert.ts";

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

Deno.test("parseFrontMatter - YAML", async () => {
  const source = `---
title: Hello World
count: 42
---
# Content here`;

  const result = await parseFrontMatter(source);

  assertEquals(result.data, { title: "Hello World", count: 42 });
  assertEquals(result.format, "yaml");
  assertEquals(result.content, "# Content here");
  assertEquals(result.isEmpty, false);
});

Deno.test("parseFrontMatter - JSON", async () => {
  const source = `---
{
  "title": "JSON Post",
  "count": 42
}
---
# Content`;

  const result = await parseFrontMatter(source);

  assertEquals(result.data, { title: "JSON Post", count: 42 });
  assertEquals(result.format, "json");
});

Deno.test("parseFrontMatter - TOML", async () => {
  const source = `+++
title = "TOML Post"
count = 42
+++
# Content`;

  const result = await parseFrontMatter(source);

  assertEquals(result.data, { title: "TOML Post", count: 42 });
  assertEquals(result.format, "toml");
});

Deno.test("parseFrontMatter - with excerpt", async () => {
  const source = `---
title: Test
---
This is the excerpt.

<!-- more -->

This is the rest.`;

  const result = await parseFrontMatter(source, { excerpt: true });

  assertEquals(result.data, { title: "Test" });
  assertEquals(result.excerpt, "This is the excerpt.");
});

Deno.test("parseFrontMatter - no front matter", async () => {
  const source = "# Just content\n\nNo front matter here.";

  const result = await parseFrontMatter(source);

  assertEquals(result.isEmpty, true);
  assertEquals(result.data, {});
});

// ---------------------------------------------------------------------------
// Sync parse tests
// ---------------------------------------------------------------------------

Deno.test("parseFrontMatterSync - after initWasm", async () => {
  await initWasm();

  const source = `---
title: Sync Test
---
Content`;

  const result = parseFrontMatterSync(source);

  assertEquals(result.data, { title: "Sync Test" });
  assertEquals(result.format, "yaml");
});

// ---------------------------------------------------------------------------
// Stringify tests
// ---------------------------------------------------------------------------

Deno.test("stringifyFrontMatter - YAML", async () => {
  const data = { title: "Hello", count: 42 };
  const content = "# Content";

  const result = await stringifyFrontMatter(data, content);

  assertEquals(result.includes("---"), true);
  assertEquals(result.includes("title:"), true);
  assertEquals(result.includes("# Content"), true);
});

Deno.test("stringifyFrontMatter - JSON", async () => {
  const data = { title: "Hello" };
  const content = "# Content";

  const result = await stringifyFrontMatter(data, content, { format: "json" });

  assertEquals(result.includes("---"), true);
  assertEquals(result.includes('"title"'), true);
});

Deno.test("stringifyFrontMatter - TOML", async () => {
  const data = { title: "Hello", count: 42 };
  const content = "# Content";

  const result = await stringifyFrontMatter(data, content, { format: "toml" });

  assertEquals(result.includes("+++"), true);
  assertEquals(result.includes('title = "Hello"'), true);
});

Deno.test("stringifyFrontMatterSync - after initWasm", async () => {
  await initWasm();

  const data = { title: "Sync" };
  const content = "Content";

  const result = stringifyFrontMatterSync(data, content);

  assertEquals(result.includes("---"), true);
  assertEquals(result.includes("title:"), true);
});

// ---------------------------------------------------------------------------
// Extractor tests
// ---------------------------------------------------------------------------

Deno.test("extractFrontMatter - basic", () => {
  const source = "---\ntitle: Hello\n---\n# Content";
  const result = extractFrontMatter(source);

  assertExists(result);
  assertEquals(result?.rawData, "title: Hello");
  assertEquals(result?.content, "# Content");
});

Deno.test("extractFrontMatter - no front matter", () => {
  const source = "# Just content";
  const result = extractFrontMatter(source);

  assertEquals(result, null);
});

// ---------------------------------------------------------------------------
// Excerpt tests
// ---------------------------------------------------------------------------

Deno.test("extractExcerpt - with separator", () => {
  const content = "This is excerpt.\n\n<!-- more -->\n\nRest of content.";
  const excerpt = extractExcerpt(content, true);

  assertEquals(excerpt, "This is excerpt.");
});

Deno.test("extractExcerpt - first paragraph fallback", () => {
  const content = "First paragraph.\n\nSecond paragraph.";
  const excerpt = extractExcerpt(content, true);

  assertEquals(excerpt, "First paragraph.");
});

// ---------------------------------------------------------------------------
// File I/O tests
// ---------------------------------------------------------------------------

import { readFrontMatter } from "../src/index.ts";

Deno.test("readFrontMatter - file", async () => {
  const path = "temp_deno_test.md";
  await Deno.writeTextFile(path, "---\ntitle: Deno File\n---\nContent");
  try {
    const result = await readFrontMatter<{ title: string }>(path);
    assertEquals(result.data.title, "Deno File");
    assertEquals(result.content, "Content");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("readFrontMatter - URL", async () => {
  const path = "temp_deno_url_test.md";
  await Deno.writeTextFile(path, "---\ntitle: Deno URL\n---\nContent");
  // Actually, import.meta.url is the test file URL.
  // Let's use a simple file:// URL constructed from CWD.
  const absPath = `${Deno.cwd()}/${path}`;
  // On Windows, convert backslashes to forward slashes for valid file:// URLs
  const normalizedPath = absPath.replaceAll("\\", "/");
  const url = new URL(`file://${Deno.build.os === "windows" ? "/" : ""}${normalizedPath}`);

  try {
    const result = await readFrontMatter<{ title: string }>(url);
    assertEquals(result.data.title, "Deno URL");
  } finally {
    await Deno.remove(path);
  }
});

// ---------------------------------------------------------------------------
// AST & Indexer tests
// ---------------------------------------------------------------------------

Deno.test("AST Extraction", async () => {
  const source = `---
title: AST Test
---
# Heading 1
[Link](https://deno.com)
`;
  const result = await parseFrontMatter(source, { extractAst: true });

  assertExists(result.ast);
  assertEquals(result.ast?.headings[0].text, "Heading 1");
  assertEquals(result.ast?.links[0].url, "https://deno.com");
});

Deno.test("ProteusIndexer - Deno", async () => {
  const docs = [
    { data: { title: "B", order: 2 }, content: "C1", isEmpty: false, format: "yaml", rawData: "" },
    { data: { title: "A", order: 1 }, content: "C2", isEmpty: false, format: "yaml", rawData: "" },
  ] as unknown as ParseResult<{ title: string; order: number }>[];

  // Use static load simulation since we have raw objects
  const indexer = new ProteusIndexer<{ title: string; order: number }>(docs);

  const sorted = indexer.sort("title", "asc").records;
  assertEquals(sorted[0].data.title, "A");
  assertEquals(sorted[1].data.title, "B");
});
