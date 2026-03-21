#!/usr/bin/env -S bun

import { detectFormat, extractFrontMatter, initWasm, parseFrontMatterSync } from "../src/index.js";
import type { DelimiterPair, FrontMatterFormat } from "../src/types.js";

// ---------------------------------------------------------------------------
// Runtime detection & Polyfills
// ---------------------------------------------------------------------------

declare const Bun:
  | {
      argv: string[];
      file(path: string): { text(): Promise<string>; exists(): Promise<boolean> };
      stdin: { text(): Promise<string> };
    }
  | undefined;
declare const Deno:
  | {
      args: string[];
      readTextFile(path: string): Promise<string>;
      exit(code?: number): never;
      stdin: { readable: ReadableStream<Uint8Array> };
    }
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

function handleLongOption(arg: string, values: ParsedArgs["values"]): void {
  const eqIdx = arg.indexOf("=");
  const key = arg.slice(2, eqIdx === -1 ? arg.length : eqIdx);
  const val = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);

  switch (key) {
    case "format":
      values.format = val;
      break;
    case "delimiter":
      values.delimiter = val;
      break;
    case "help":
      values.help = true;
      break;
    case "json":
      values.json = true;
      break;
    case "pretty":
      values.pretty = true;
      break;
    default:
      die(`unknown option: --${key}`);
  }
}

function handleShortFlags(
  arg: string,
  i: number,
  args: string[],
  values: ParsedArgs["values"],
): number {
  const flags = arg.slice(1);
  for (let fi = 0; fi < flags.length; fi++) {
    const ch = flags[fi];
    switch (ch) {
      case "h":
        values.help = true;
        break;
      case "j":
        values.json = true;
        break;
      case "p":
        values.pretty = true;
        break;
      case "f":
      case "d": {
        const rest = flags.slice(fi + 1);
        let val: string;
        if (rest.length > 0) {
          val = rest;
        } else {
          if (i + 1 >= args.length) die(`missing value for -${ch}`);
          val = args[++i];
        }
        if (ch === "f") values.format = val;
        else values.delimiter = val;
        return i;
      }
      default:
        die(`unknown option: -${ch}`);
    }
  }
  return i;
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

    if (arg.startsWith("--")) {
      handleLongOption(arg, values);
    } else if (arg.startsWith("-") && arg.length > 1) {
      const nextIdx = handleShortFlags(arg, i, args, values);
      i = nextIdx;
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
  proteus <command> [file] [options]
  cat file.md | proteus <command> [options]

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
  // If no path is given, try reading from stdin (piped input).
  if (!path) {
    return readStdin();
  }

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

/** Read all of stdin as a UTF-8 string. */
async function readStdin(): Promise<string> {
  // 1. Deno native stdin API (avoids Node compat dependency)
  if (globalThis.Deno?.stdin?.readable) {
    try {
      const reader = Deno.stdin.readable.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      let totalLength = 0;
      for (const c of chunks) totalLength += c.byteLength;
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return new TextDecoder().decode(merged);
    } catch {
      die("no file specified and stdin is not readable — run with --help for usage");
    }
  }

  // 2. Node-compatible process.stdin (works in Bun and Node)
  // Bun.stdin.text() doesn't keep the event loop alive on Windows,
  // so we use the Node API which handles piped stdin correctly everywhere.
  try {
    const chunks: Buffer[] = [];
    const stdin = process.stdin;
    return await new Promise<string>((resolve, reject) => {
      stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stdin.on("error", reject);
    });
  } catch {
    die("no file specified and stdin is not readable — run with --help for usage");
  }
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
  let format: FrontMatterFormat | undefined;
  if (values.format) {
    if (VALID_FORMATS.includes(values.format)) {
      format = values.format as FrontMatterFormat;
    } else {
      die(`invalid format: "${values.format}"`);
    }
  }

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

try {
  await main();
} catch (err) {
  die(String(err));
}
