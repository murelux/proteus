import type { FrontMatterFormat, ParserAdapter } from "./types.js";
import { ParseError } from "./types.js";
import type { WasmParsers } from "./wasm-loader.js";

/**
 * Create a `ParserAdapter` for the given format backed by the WASM parsers.
 */
export function createParserAdapter(format: FrontMatterFormat, wasm: WasmParsers): ParserAdapter {
  const fn = FORMAT_TO_FN[format];

  return {
    parse(input: string): unknown {
      try {
        return fn(wasm, input);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const { line, column } = extractErrorPosition(message);
        throw new ParseError(
          `Failed to parse ${format.toUpperCase()}: ${message}`,
          format,
          line,
          column,
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

type ParseFn = (wasm: WasmParsers, input: string) => unknown;

const FORMAT_TO_FN: Record<FrontMatterFormat, ParseFn> = {
  yaml: (w, i) => w.parse_yaml(i),
  json: (w, i) => w.parse_json(i),
  toml: (w, i) => w.parse_toml(i),
};

/**
 * Extract line and column numbers from error messages.
 * Supports various formats:
 * - "at line 5, column 10"
 * - "line 5 column 10"
 * - "5:10"
 */
function extractErrorPosition(message: string): { line?: number; column?: number } {
  // Cap message length to prevent ReDoS on unusually long error strings.
  const msg = message.length > 500 ? message.slice(0, 500) : message;

  // Pattern: "at line X, column Y" or "line X column Y"
  const lineColMatch = msg.match(/line\s+(\d+)[,\s]+column\s+(\d+)/i);
  if (lineColMatch) {
    return {
      line: Number.parseInt(lineColMatch[1], 10),
      column: Number.parseInt(lineColMatch[2], 10),
    };
  }

  // Pattern: "X:Y" (common in many parsers)
  // Use word boundary + negative lookbehind for '.' to avoid matching
  // version numbers (e.g. "1.2:3") or timestamps.
  const colonMatch = msg.match(/(?<![.\d])(\d+):(\d+)(?!\d*\.)/);
  if (colonMatch) {
    return {
      line: Number.parseInt(colonMatch[1], 10),
      column: Number.parseInt(colonMatch[2], 10),
    };
  }

  return {};
}
