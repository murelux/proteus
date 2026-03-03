import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFrontMatter, readFrontMatterMany } from "../src/index.js";
import type { ParseResultError } from "../src/types.js";

const TEST_DIR = "tests/fixtures/file-read";
const FILE_1 = join(TEST_DIR, "1.md");
const FILE_2 = join(TEST_DIR, "2.md");
const FILE_EMPTY = join(TEST_DIR, "empty.md");
const FILE_BOM = join(TEST_DIR, "bom.md");
const FILE_NO_FM = join(TEST_DIR, "no-frontmatter.md");

const CONTENT_1 = `---
title: Test 1
---
Content 1`;

const CONTENT_2 = `---
title: Test 2
---
Content 2`;

describe("readFrontMatter", () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(FILE_1, CONTENT_1);
    await writeFile(FILE_2, CONTENT_2);
    await writeFile(FILE_EMPTY, "");
    // BOM + front matter
    await writeFile(FILE_BOM, `\uFEFF---\ntitle: BOM Test\n---\nBody`);
    await writeFile(FILE_NO_FM, "# Just markdown\n\nNo front matter here.");
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should read a single file (string path)", async () => {
    const result = await readFrontMatter<{ title: string }>(FILE_1);
    expect(result.data.title).toBe("Test 1");
    expect(result.content.trim()).toBe("Content 1");
  });

  it("should read a single file (URL)", async () => {
    const fileUrl = pathToFileURL(resolve(FILE_1));
    const result = await readFrontMatter<{ title: string }>(fileUrl);
    expect(result.data.title).toBe("Test 1");
  });

  it("should read multiple files", async () => {
    const results = await readFrontMatterMany<{ title: string }>([FILE_1, FILE_2]);
    expect(results).toHaveLength(2);
    expect(results[0].data.title).toBe("Test 1");
    expect(results[1].data.title).toBe("Test 2");
  });

  it("should error on missing file", async () => {
    await expect(readFrontMatter("nonexistent.md")).rejects.toThrow();
  });

  it("should handle empty files", async () => {
    const result = await readFrontMatter(FILE_EMPTY);
    expect(result.isEmpty).toBe(true);
    expect(result.data).toEqual({});
  });

  it("should handle files with BOM", async () => {
    const result = await readFrontMatter<{ title: string }>(FILE_BOM);
    expect(result.data.title).toBe("BOM Test");
    expect(result.isEmpty).toBe(false);
  });

  it("should handle files without front matter", async () => {
    const result = await readFrontMatter(FILE_NO_FM);
    expect(result.isEmpty).toBe(true);
    expect(result.content).toContain("Just markdown");
  });

  it("should enforce baseDir restriction for local files", async () => {
    const baseDir = TEST_DIR;
    // Reading inside baseDir should work
    const result = await readFrontMatter<{ title: string }>(FILE_1, { baseDir });
    expect(result.data.title).toBe("Test 1");

    // Reading outside baseDir should fail
    await expect(readFrontMatter("../../package.json", { baseDir })).rejects.toThrow(
      "Path traversal detected",
    );
  });

  it("should reject remote URLs unless allowRemoteUrls is true", async () => {
    // Attempting to read a remote URL without allowRemoteUrls should throw immediately
    await expect(readFrontMatter("https://example.com/file.md")).rejects.toThrow(
      "Remote URL fetching is disabled by default for security",
    );
  });

  it("should isolate errors in readFrontMatterMany", async () => {
    const results = await readFrontMatterMany([FILE_1, "nonexistent.md", FILE_2]);
    expect(results).toHaveLength(3);
    expect(results[0].data).toHaveProperty("title");
    // The failed file should have an error, not crash the batch
    const failed = results[1] as ParseResultError;
    expect(failed.error).toBeDefined();
    expect(results[2].data).toHaveProperty("title");
  });

  it("should respect concurrency parameter in readFrontMatterMany", async () => {
    // Run with concurrency=1 (sequential) — results should still be correct
    const results = await readFrontMatterMany<{ title: string }>([FILE_1, FILE_2], undefined, 1);
    expect(results).toHaveLength(2);
    expect(results[0].data.title).toBe("Test 1");
    expect(results[1].data.title).toBe("Test 2");
  });

  it("should return empty array for readFrontMatterMany with no paths", async () => {
    const results = await readFrontMatterMany([]);
    expect(results).toEqual([]);
  });
});
