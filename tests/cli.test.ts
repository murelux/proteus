import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/style/noNonNullAssertion: import.meta.dirname is always defined in Bun/Node
const CLI_PATH = join(import.meta.dirname!, "..", "cli", "index.ts");

/** Run the CLI via Bun subprocess and capture output. */
async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync("bun", ["run", CLI_PATH, ...args], {
      timeout: 10_000,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? "").trim(),
      exitCode: e.code ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let yamlFile: string;
let jsonFile: string;
let tomlFile: string;
let noFmFile: string;

beforeAll(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  tmpDir = await mkdtemp(join(tmpdir(), "qm-cli-test-"));

  yamlFile = join(tmpDir, "yaml.md");
  await writeFile(yamlFile, `---\ntitle: Hello World\ncount: 42\n---\n# Content\n\nBody here.\n`);

  jsonFile = join(tmpDir, "json.md");
  await writeFile(jsonFile, `---\n{"title": "JSON Post", "count": 42}\n---\n# JSON Content\n`);

  tomlFile = join(tmpDir, "toml.md");
  await writeFile(tomlFile, `+++\ntitle = "TOML Post"\ncount = 42\n+++\n# TOML Content\n`);

  noFmFile = join(tmpDir, "nofm.md");
  await writeFile(noFmFile, "# Just content\nNo front matter.\n");
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI", () => {
  describe("parse command", () => {
    it("should parse YAML front matter", async () => {
      const { stdout, exitCode } = await runCli(["parse", yamlFile]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.data.title).toBe("Hello World");
      expect(parsed.data.count).toBe(42);
      expect(parsed.format).toBe("yaml");
    });

    it("should parse JSON front matter", async () => {
      const { stdout, exitCode } = await runCli(["parse", jsonFile]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.data.title).toBe("JSON Post");
      expect(parsed.format).toBe("json");
    });

    it("should parse TOML front matter", async () => {
      const { stdout, exitCode } = await runCli(["parse", tomlFile]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.data.title).toBe("TOML Post");
      expect(parsed.format).toBe("toml");
    });

    it("should pretty-print with --pretty", async () => {
      const { stdout, exitCode } = await runCli(["parse", yamlFile, "--pretty"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("\n"); // multi-line = pretty
      const parsed = JSON.parse(stdout);
      expect(parsed.data.title).toBe("Hello World");
    });
  });

  describe("extract command", () => {
    it("should extract raw front matter", async () => {
      const { stdout, exitCode } = await runCli(["extract", yamlFile]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("title: Hello World");
    });

    it("should exit 1 when no front matter found", async () => {
      const { exitCode, stderr } = await runCli(["extract", noFmFile]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("no front matter found");
    });
  });

  describe("detect command", () => {
    it("should detect yaml format", async () => {
      const { stdout, exitCode } = await runCli(["detect", yamlFile]);
      expect(exitCode).toBe(0);
      expect(stdout).toBe("yaml");
    });

    it("should detect toml format", async () => {
      const { stdout, exitCode } = await runCli(["detect", tomlFile]);
      expect(exitCode).toBe(0);
      expect(stdout).toBe("toml");
    });
  });

  describe("validate command", () => {
    it("should validate valid front matter", async () => {
      const { stdout, exitCode } = await runCli(["validate", yamlFile]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.valid).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should show help with --help", async () => {
      const { stdout, exitCode } = await runCli(["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("proteus");
      expect(stdout).toContain("parse");
    });

    it("should show help with no arguments", async () => {
      const { stdout, exitCode } = await runCli([]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Usage:");
    });

    it("should error on unknown command", async () => {
      const { exitCode, stderr } = await runCli(["badcmd", yamlFile]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("unknown command");
    });

    it("should error when no file specified", async () => {
      const { exitCode, stderr } = await runCli(["parse"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("no file specified");
    });

    it("should error on invalid format", async () => {
      const { exitCode, stderr } = await runCli(["parse", yamlFile, "-f", "xml"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("invalid format");
    });

    it("should error on non-existent file", async () => {
      const { exitCode, stderr } = await runCli(["parse", "/does/not/exist.md"]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("could not read file");
    });
  });
});
