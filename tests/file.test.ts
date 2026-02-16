import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFrontMatter, readFrontMatterMany } from "../src/index.js";

const TEST_DIR = "tests/fixtures/file-read";
const FILE_1 = join(TEST_DIR, "1.md");
const FILE_2 = join(TEST_DIR, "2.md");

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
    const results = await readFrontMatterMany([FILE_1, FILE_2]);
    expect(results).toHaveLength(2);
    expect((results[0] as { data: { title: string } }).data.title).toBe("Test 1");
    expect((results[1] as { data: { title: string } }).data.title).toBe("Test 2");
  });

  it("should error on missing file", async () => {
    await expect(readFrontMatter("nonexistent.md")).rejects.toThrow();
  });
});
