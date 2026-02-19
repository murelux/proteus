#!/usr/bin/env bun

import { detectFormat, extractFrontMatter, initWasm, parseFrontMatterSync } from "../src/index.js";
import type { DelimiterPair, FrontMatterFormat } from "../src/types.js";

// ---------------------------------------------------------------------------
// Runtime detection & Polyfills
// ---------------------------------------------------------------------------

declare const Bun: { argv: string[]; file(path: string): { text(): Promise<string> } } | undefined;
declare const Deno:
  | { args: string[]; readTextFile(path: string): Promise<string>; exit(code?: number): never }
  | undefined;

function getArgs(): string[] {
  if (typeof Bun !== "undefined") return Bun.argv.slice(2);
  if (typeof Deno !== "undefined") return Deno.args;
  throw new Error("Unsupported runtime — use Bun or Deno.");
}

function exit(code = 0): never {
  if (typeof Deno !== "undefined") Deno.exit(code);
  process.exit(code); // Bun supports process.exit
}

// ---------------------------------------------------------------------------
// Args Parser (Minimal — no external dependencies)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  values: {
    help?: boolean;
    format?: string;
    json?: boolean;
    pretty?: boolean;
    delimiter?: string;
  };
  positionals: string[];
}

function parseCliArgs(args: string[]): ParsedArgs {
  const values: ParsedArgs["values"] = {};
  const positionals: string[] = [];
  let dashdash = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (dashdash) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--") {
      dashdash = true;
      continue;
    }

    // Long options with `=` (e.g. --format=json, --delimiter=~~~)
    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIdx = arg.indexOf("=");
      const key = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx + 1);
      if (key === "format") {
        values.format = val;
      } else if (key === "delimiter") {
        values.delimiter = val;
      } else if (key === "help") {
        values.help = true;
      } else if (key === "json") {
        values.json = true;
      } else if (key === "pretty") {
        values.pretty = true;
      } else {
        die(`unknown option: --${key}`);
      }
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      values.help = true;
    } else if (arg === "-f" || arg === "--format") {
      if (i + 1 >= args.length) die("missing value for --format");
      values.format = args[++i];
    } else if (arg === "-j" || arg === "--json") {
      values.json = true;
    } else if (arg === "-p" || arg === "--pretty") {
      values.pretty = true;
    } else if (arg === "-d" || arg === "--delimiter") {
      if (i + 1 >= args.length) die("missing value for --delimiter");
      values.delimiter = args[++i];
    } else if (arg.startsWith("--")) {
      die(`unknown option: ${arg}`);
    } else if (arg.startsWith("-") && arg.length > 2) {
      // Combined short flags (e.g. -jp → -j -p)
      const flags = arg.slice(1);
      for (let fi = 0; fi < flags.length; fi++) {
        const ch = flags[fi];
        if (ch === "h") {
          values.help = true;
        } else if (ch === "j") {
          values.json = true;
        } else if (ch === "p") {
          values.pretty = true;
        } else if (ch === "f") {
          // -f consumes the rest of the combined flag or the next arg
          const rest = flags.slice(fi + 1);
          if (rest.length > 0) {
            values.format = rest;
          } else if (i + 1 >= args.length) {
            die("missing value for --format");
          } else {
            values.format = args[++i];
          }
          break;
        } else if (ch === "d") {
          const rest = flags.slice(fi + 1);
          if (rest.length > 0) {
            values.delimiter = rest;
          } else if (i + 1 >= args.length) {
            die("missing value for --delimiter");
          } else {
            values.delimiter = args[++i];
          }
          break;
        } else {
          die(`unknown option: -${ch}`);
        }
      }
    } else if (arg.startsWith("-")) {
      die(`unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { values, positionals };
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `
proteus — Parse YAML, JSON, and TOML front matter from Markdown files

Usage:
  proteus <command> <file> [options]

Commands:
  parse      Parse front matter and output as JSON
  extract    Output raw extracted front matter (unparsed)
  detect     Detect and print the front matter format
  validate   Parse and validate front matter (exits 1 on error)

Options:
  -f, --format <fmt>       Force format: yaml | json | toml
  -d, --delimiter <delim>  Custom delimiter (e.g. "~~~" or "<!--,-->")
  -j, --json               Output as compact JSON (default)
  -p, --pretty             Pretty-print JSON output
  -h, --help               Show this help message

Examples:
  proteus parse README.md
  proteus parse README.md --pretty
  proteus detect post.md
  proteus extract post.mdx -d "~~~"
  proteus parse post.md -f toml
`.trim();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(message: string, code = 1): never {
  console.error(`error: ${message}`);
  exit(code);
}

async function readInput(path?: string): Promise<string> {
  if (!path) die("no file specified — run with --help for usage");

  try {
    if (typeof Bun !== "undefined") {
      const file = Bun.file(path);
      // Bun.file().text() crashes the process on missing files instead of
      // rejecting the promise, so we must check existence first.
      if (!(await file.exists())) {
        die(`could not read file: ${path}`);
      }
      return await file.text();
    }
    if (typeof Deno !== "undefined") {
      return await Deno.readTextFile(path);
    }
  } catch {
    die(`could not read file: ${path}`);
  }
  throw new Error("Unsupported runtime");
}

function parseDelimiter(raw?: string): DelimiterPair[] | undefined {
  if (!raw) return undefined;
  if (raw.includes(",")) {
    const [open, close] = raw.split(",", 2);
    return [{ open: open.trim(), close: close.trim() }];
  }
  return [{ open: raw, close: raw }];
}

function output(data: unknown, pretty?: boolean): void {
  console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = getArgs();
  const { values, positionals } = parseCliArgs(args);

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    exit(0);
  }

  const [command, filePath] = positionals;
  const source = await readInput(filePath);
  const delimiters = parseDelimiter(values.delimiter);
  const VALID_FORMATS = ["yaml", "json", "toml"];
  const format: FrontMatterFormat | undefined = values.format
    ? VALID_FORMATS.includes(values.format)
      ? (values.format as FrontMatterFormat)
      : die(`invalid format: "${values.format}"`)
    : undefined;

  switch (command) {
    case "parse": {
      await initWasm();
      const result = parseFrontMatterSync(source, { format, delimiters });
      output(
        {
          data: result.data,
          format: result.format,
          isEmpty: result.isEmpty,
        },
        values.pretty,
      );
      break;
    }

    case "extract": {
      const extraction = extractFrontMatter(source, delimiters);
      if (!extraction) die("no front matter found");
      console.log(extraction.rawData);
      break;
    }

    case "detect": {
      const extraction = extractFrontMatter(source, delimiters);
      if (!extraction) die("no front matter found");
      const detected = format ?? detectFormat(extraction.rawData, extraction.delimiter);
      console.log(detected);
      break;
    }

    case "validate": {
      await initWasm();
      try {
        const result = parseFrontMatterSync(source, { format, delimiters });
        output({ valid: true, format: result.format, data: result.data }, values.pretty);
      } catch (err) {
        output({ valid: false, error: String(err) }, values.pretty);
        exit(1);
      }
      break;
    }

    default:
      die(`unknown command: ${command}`);
  }
}

main().catch((err) => {
  die(String(err));
});
