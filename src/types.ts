/**
 * @module
 *
 * Shared type definitions, interfaces, and error classes used across
 * `@quill/proteus`. Import from this module when you need to annotate
 * function signatures or catch specific error subtypes.
 */

/** Supported front matter formats. */
export type FrontMatterFormat = "yaml" | "json" | "toml";

/** A pair of opening/closing delimiters. */
export interface DelimiterPair {
  open: string;
  close: string;
}

/** Built-in delimiters. */
export const DEFAULT_DELIMITERS: readonly DelimiterPair[] = [
  { open: "---", close: "---" },
  { open: "---", close: "..." },
  { open: "+++", close: "+++" },
] as const;

/** Options for excerpt extraction. */
export interface ExcerptOptions {
  /** Separator string to look for. @default "<!-- more -->" */
  separator?: string;
}

/**
 * Result returned by the main `parseFrontMatter` function.
 *
 * This is a **discriminated union** — narrow on `isEmpty` or `error`
 * before accessing typed `data` to avoid runtime errors.
 *
 * @example
 * ```ts
 * const result = await parseFrontMatter<PostMeta>(source);
 * if (!result.isEmpty && !result.error) {
 *   console.log(result.data.title); // ✅ safely typed as PostMeta
 * }
 * ```
 */
export type ParseResult<T = Record<string, unknown>> =
  | ParseResultSuccess<T>
  | ParseResultEmpty
  | ParseResultError;

/** Successful parse — `data` is fully typed as `T`. */
export interface ParseResultSuccess<T = Record<string, unknown>> {
  /** Parsed front matter data. */
  data: T;
  /** Markdown content after the front matter block. */
  content: string;
  /** Detected (or overridden) format of the front matter. */
  format: FrontMatterFormat;
  /** Whether the front matter block was empty / absent. */
  isEmpty: false;
  /** Never present on success. */
  error?: undefined;
  /** Extracted excerpt (when `excerpt` option is enabled). */
  excerpt?: string;
  /** Raw (unparsed) front matter text between delimiters. */
  rawData: string;
}

/** Empty or absent front matter — `data` is `{}`. */
export interface ParseResultEmpty {
  /** Empty object — no front matter data was found. */
  data: Record<string, never>;
  /** The full source content (no front matter to strip). */
  content: string;
  /** Default or overridden format. */
  format: FrontMatterFormat;
  /** Always `true` when front matter is empty or absent. */
  isEmpty: true;
  /** Never present on empty result. */
  error?: undefined;
  /** Extracted excerpt (when `excerpt` option is enabled). */
  excerpt?: string;
  /** Absent when isEmpty is true. */
  rawData?: undefined;
}

/** Parse error (when `strict: false`) — `data` is `{}`. */
export interface ParseResultError {
  /** Empty object — parse failed. */
  data: Record<string, never>;
  /** Markdown content after the front matter block. */
  content: string;
  /** Detected (or overridden) format. */
  format: FrontMatterFormat;
  /** Always `false` — front matter was present but parsing failed. */
  isEmpty: false;
  /** The parse error. */
  error: FrontMatterError;
  /** Extracted excerpt (when `excerpt` option is enabled). */
  excerpt?: string;
  /** Raw (unparsed) front matter text between delimiters. */
  rawData: string;
}

/** Intermediate result from the extraction step — before parsing. */
export interface ExtractionResult {
  /** Raw text between the delimiters (unparsed). */
  rawData: string;
  /** Markdown body after the closing delimiter. */
  content: string;
  /** Delimiter pair used. */
  delimiter: DelimiterPair;
}

/** Adapter interface every parser must implement. */
export interface ParserAdapter {
  /** Parse a raw front matter string into a JS object. */
  parse(input: string): unknown;
}

/** Options for `stringifyFrontMatter`. */
export interface StringifyOptions {
  /** Output format. @default "yaml" */
  format?: FrontMatterFormat;
  /** Custom delimiter pair. Defaults based on format: `---` for yaml/json, `+++` for toml. */
  delimiter?: DelimiterPair;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Base error for all proteus errors. */
export class FrontMatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontMatterError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the front matter block cannot be extracted (e.g. unclosed delimiter). */
export class ExtractionError extends FrontMatterError {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the raw data fails to parse in the detected format. */
export class ParseError extends FrontMatterError {
  public readonly format: FrontMatterFormat;
  /** Line number where the error occurred (1-based), if available. */
  public readonly line?: number;
  /** Column number where the error occurred (1-based), if available. */
  public readonly column?: number;

  constructor(message: string, format: FrontMatterFormat, line?: number, column?: number) {
    super(message);
    this.name = "ParseError";
    this.format = format;
    this.line = line;
    this.column = column;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when Valibot schema validation fails. */
export class ValidationError extends FrontMatterError {
  public readonly issues: unknown[];

  constructor(message: string, issues: unknown[]) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
