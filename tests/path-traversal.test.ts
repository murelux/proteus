import { describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { readFrontMatter } from "../src/index.js";

describe("Path Traversal Protection", () => {
  it("should allow reading files within the base directory", async () => {
    const baseDir = resolve(__dirname, "fixtures");
    mkdirSync(baseDir, { recursive: true });

    const validFile = join(baseDir, "valid.md");
    writeFileSync(validFile, "---\ntitle: test\n---\ncontent", "utf-8");

    const result = await readFrontMatter(validFile, { baseDir });
    expect(result.data).toEqual({ title: "test" });
  });

  it("should block reading files outside the base directory via relative path", async () => {
    const baseDir = resolve(__dirname, "fixtures");
    const validFile = join(baseDir, "valid.md");

    const outsideFile = join(baseDir, "../file.test.ts"); // A file outside baseDir

    await expect(readFrontMatter(outsideFile, { baseDir })).rejects.toThrow(/Path traversal blocked/);
  });

  it("should block reading files outside the base directory via absolute path", async () => {
    const baseDir = resolve(__dirname, "fixtures");

    // An absolute path outside baseDir
    const outsideFile = resolve(__dirname, "file.test.ts");

    await expect(readFrontMatter(outsideFile, { baseDir })).rejects.toThrow(/Path traversal blocked/);
  });

  it("should block path traversal attempts using ../", async () => {
    const baseDir = resolve(__dirname, "fixtures");

    // Path string that attempts to traverse out
    const traversalPath = join(baseDir, "../../package.json");

    await expect(readFrontMatter(traversalPath, { baseDir })).rejects.toThrow(/Path traversal blocked/);
  });

  it("should block path traversal using file:// URLs", async () => {
    const baseDir = resolve(__dirname, "fixtures");
    const traversalURL = new URL("file://" + resolve(__dirname, "../../package.json"));

    await expect(readFrontMatter(traversalURL, { baseDir })).rejects.toThrow(/Path traversal blocked/);
  });

  it("should allow if baseDir is exactly the file path", async () => {
    const baseDir = resolve(__dirname, "fixtures/valid.md");
    const result = await readFrontMatter(baseDir, { baseDir });
    expect(result.data).toEqual({ title: "test" });
  });

  it("should allow reading if baseDir is not provided", async () => {
    const outsideFile = resolve(__dirname, "file.test.ts");

    // Should not throw path traversal error, might throw parsing error but that's fine
    await expect(readFrontMatter(outsideFile)).resolves.toBeDefined();
  });
});
