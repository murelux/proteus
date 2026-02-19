# Proteus Matter

[![JSR](https://jsr.io/badges/@quill/proteus)](https://jsr.io/@quill/proteus)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

Markdown front matter parsing and serialization library. Uses **Rust → WebAssembly** as the YAML / JSON / TOML parsing and serialization core, with a TypeScript layer handling extraction, detection, validation, and I/O.

> Optimized for **Bun** · **Deno** · **Cloudflare Workers**

## Problems Solved

- **Multi-format blindspot** — Handle YAML, JSON, and TOML front matter simultaneously with automatic format detection
- **Type unsafety** — Parse results are `any`, requiring manual assertions; no structured representation for "no front matter" or "parse failure"
- **Separated schema validation** — Parsing and validation are separate steps, easy to forget
- **Prototype pollution** — Spreading `YAML.parse()` results directly into objects risks `__proto__` injection
- **Sync/async split** — Some scenarios (SSG builds) need synchronous APIs, others (edge computing) need async lazy loading

## Architecture

```
                        ┌──────────────────────────────────────────┐
                        │          TypeScript Layer (src/)          │
    Source string ─────►│                                          │
                        │  extractFrontMatter()   Pure string ops  │
                        │        │                                 │
                        │        ▼                                 │
                        │  detectFormat()          Delimiter + char │
                        │        │                                 │
                        │        ▼                                 │
                        │  ┌─────────────────────────────────┐     │
                        │  │  Rust WASM (pkg/)               │     │
                        │  │  serde-saphyr → YAML 1.2        │     │
                        │  │  serde_json   → JSON            │     │
                        │  │  toml         → TOML            │     │
                        │  │  wasm-bindgen → JS ↔ Rust bridge│     │
                        │  └─────────────────────────────────┘     │
                        │        │                                 │
                        │        ▼                                 │
                        │  sanitizeKeys()         Filter __proto__ │
                        │        │                                 │
                        │        ▼                                 │
                        │  validate() [optional]  Valibot schema   │
                        │        │                                 │
                        │        ▼                                 │
                        │  ParseResult<T>         Discriminated    │
                        │                         union type       │
                        └──────────────────────────────────────────┘
```

**Key Design Decisions:**

- **Extraction and detection are WASM-free** — `extractFrontMatter()` and `detectFormat()` are pure string operations, importable separately (`@quill/proteus/extractor`) and usable without WASM
- **Lazy WASM loading** — Async APIs automatically load and cache the `.wasm` binary on first call; sync APIs require calling `initWasm()` upfront
- **JSON fast path** — When JSON is detected, uses `JSON.parse()` directly, skipping the WASM layer to avoid double parsing
- **Lazy Valibot loading** — `validate()` uses dynamic `import()`; valibot is never imported if the `schema` option is not set
- **Dual size limits** — Both the TS and Rust layers independently enforce a 1 MB input limit; serialization output has the same 1 MB cap

## Installation

```bash
# Bun
bunx jsr add @quill/proteus

# Deno
deno add jsr:@quill/proteus
```

> **Note:** This package exports TypeScript source files directly. It requires a TS-capable runtime (Bun, Deno) or a bundler (Vite, wrangler, etc.). Native Node.js is not supported.

## Quick Start

### Async API (Recommended)

```typescript
import { parseFrontMatter } from "@quill/proteus";

const result = await parseFrontMatter(`---
title: Hello World
tags: [typescript, rust]
---
# Content`);

if (result.error) {
  console.error(result.error.message);
} else if (!result.isEmpty) {
  result.data;    // { title: "Hello World", tags: ["typescript", "rust"] }
  result.format;  // "yaml"
  result.content; // "# Content"
}
```

### Sync API

```typescript
import { initWasm, parseFrontMatterSync } from "@quill/proteus";

await initWasm(); // Call once at startup; all subsequent sync calls need no waiting
const result = parseFrontMatterSync(source);
```

### File Reading

```typescript
import { readFrontMatter, readFrontMatterMany } from "@quill/proteus";

// Supports file paths, file:// URLs, and HTTP(S) URLs
const post = await readFrontMatter("posts/hello.md");
const all  = await readFrontMatterMany(["a.md", "b.md", new URL("https://example.com/c.md")]);
```

### Schema Validation

```typescript
import { parseFrontMatter } from "@quill/proteus";
import * as v from "valibot";

const result = await parseFrontMatter(source, {
  schema: v.object({
    title: v.string(),
    draft: v.optional(v.boolean(), false),
  }),
});
// result.data is automatically typed as { title: string; draft: boolean }
```

### Error Handling

```typescript
// Default strict: true — parse failures throw exceptions
try {
  const result = await parseFrontMatter(malformed);
} catch (err) {
  if (err instanceof ParseError) {
    console.error(`${err.format} syntax error at line ${err.line}, column ${err.column}`);
  }
}

// strict: false — parse failures are captured in result.error
const result = await parseFrontMatter(malformed, { strict: false });
if (result.error) {
  console.warn(result.error.message);
  // result.content is still available
}
```

### Serialization

```typescript
import { stringifyFrontMatter } from "@quill/proteus";

const md = await stringifyFrontMatter(
  { title: "Hello", tags: ["a", "b"] },
  "# Content",
  { format: "toml" }, // Optional, defaults to yaml
);
```

## API Reference

### Functions

| Function                                              | Description                                    |
|:------------------------------------------------------|:-----------------------------------------------|
| `parseFrontMatter(source, options?)`                  | Async parse with lazy WASM loading             |
| `parseFrontMatterSync(source, options?)`              | Sync parse, requires `initWasm()` first        |
| `stringifyFrontMatter(data, content, options?)`       | Async serialize to Markdown                    |
| `stringifyFrontMatterSync(data, content, options?)`   | Sync serialize, requires `initWasm()` first    |
| `readFrontMatter(path, options?)`                     | Read `string \| URL` (incl. HTTP) and parse    |
| `readFrontMatterMany(paths, options?)`                | Read multiple files in parallel (errors isolated per file) |
| `hasFrontMatter(source, delimiters?)`                 | Quick check, **no WASM loaded**                |
| `detectFormat(rawData, delimiter)`                    | Format detection, **no WASM loaded**           |
| `extractFrontMatter(source, delimiters?)`             | Extract raw text, **no WASM loaded**           |
| `extractExcerpt(content, options?)`                   | Extract article excerpt                        |
| `initWasm()`                                          | Preload WASM, must be called before sync APIs  |

### `ParseResult<T>`

A discriminated union type, narrowed via `isEmpty` and `error` fields:

```typescript
type ParseResult<T> = ParseResultSuccess<T> | ParseResultEmpty | ParseResultError;
```

| Variant                 | Condition             | `data` | `content`     | Extra Fields                        |
|:------------------------|:----------------------|:-------|:--------------|:------------------------------------|
| `ParseResultSuccess<T>` | `!isEmpty && !error` | `T`    | Remaining body | `format`, `rawData`, `excerpt?`     |
| `ParseResultEmpty`      | `isEmpty === true`   | `{}`   | Original text  | `format`                            |
| `ParseResultError`      | `error !== undefined`| `{}`   | Remaining body | `format`, `rawData`, `error`        |

### `ParseOptions`

| Option       | Type                         | Default                           | Description                                     |
|:-------------|:-----------------------------|:----------------------------------|:------------------------------------------------|
| `schema`     | Valibot schema               | —                                 | Enables typed + validated `data`                |
| `format`     | `"yaml" \| "json" \| "toml"` | Auto-detect                      | Force a specific format                         |
| `strict`     | `boolean`                    | `true`                            | `true`: throw on failure; `false`: write to `result.error` |
| `excerpt`    | `boolean \| { separator }`   | `false`                           | Extract excerpt (default separator: `<!-- more -->`) |
| `delimiters` | `DelimiterPair[]`            | `---/---` · `---/...` · `+++/+++` | Custom delimiter pairs                          |

### `StringifyOptions`

| Option      | Type                         | Default                                        | Description      |
|:------------|:-----------------------------|:-----------------------------------------------|:-----------------|
| `format`    | `"yaml" \| "json" \| "toml"` | `"yaml"`                                      | Output format    |
| `delimiter` | `DelimiterPair`              | Inferred by format (yaml/json → `---`, toml → `+++`) | Custom delimiter |

### Error Types

All errors extend `FrontMatterError`:

| Class              | Thrown When                  | Extra Properties                 |
|:-------------------|:----------------------------|:---------------------------------|
| `FrontMatterError` | General errors (size limit)  | —                                |
| `ExtractionError`  | Unclosed delimiters, etc.    | —                                |
| `ParseError`       | YAML/JSON/TOML syntax error  | `format`, `line?`, `column?`     |
| `ValidationError`  | Valibot schema failure       | `issues: unknown[]`              |

### Subpath Exports

The main entry point registers WASM loading and Valibot lazy-loading logic. The following subpaths **do not import WASM**, suitable for tree-shaking or lightweight detection only:

| Path                         | Export                 | Dependencies |
|:-----------------------------|:-----------------------|:-------------|
| `@quill/proteus/extractor`   | `extractFrontMatter()` | None         |
| `@quill/proteus/detector`    | `detectFormat()`       | None         |
| `@quill/proteus/validator`   | `validate()`           | valibot      |
| `@quill/proteus/sanitizer`   | `sanitizeKeys()`       | None         |
| `@quill/proteus/stringify`   | `stringifyFrontMatter()` | WASM       |

## CLI

```bash
proteus parse post.md --pretty
proteus detect post.md
proteus extract post.md
proteus validate post.md
```

| Command    | Description                                  |
|:-----------|:---------------------------------------------|
| `parse`    | Parse front matter, output JSON              |
| `extract`  | Output raw front matter text (unparsed)      |
| `detect`   | Detect and print the format                  |
| `validate` | Parse and validate (exit code 1 on failure)  |

| Flag                        | Description                               |
|:----------------------------|:------------------------------------------|
| `-f, --format <fmt>`        | Force format: yaml / json / toml          |
| `-d, --delimiter <delim>`   | Custom delimiter, e.g. `"~~~"` or `"<!--,-->"` |
| `-j, --json`                | Compact JSON output (default)             |
| `-p, --pretty`              | Pretty-printed JSON output                |
| `-h, --help`                | Help information                          |
| `--`                        | Treat remaining arguments as positionals  |

## Security

| Measure                  | Description                                                                                   |
|:-------------------------|:----------------------------------------------------------------------------------------------|
| **Prototype pollution guard** | Recursively filters `__proto__` and `prototype` keys; `constructor` is kept (attack chain blocked by `prototype` filter) |
| **Input/output size limit**   | 1 MB each for parse input and serialization output (UTF-8 bytes), enforced in both TS and Rust layers |
| **Error message sanitization** | In `strict: false` mode, error messages strip file paths and stack traces, truncated to 300 chars |
| **Security response headers** | Worker responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| **Slug validation**           | Worker GET endpoint validates slug format (alphanumeric, hyphens, underscores, dots, slashes) and blocks path traversal |

## Cloudflare Workers

See the deployment guide in your language:

- [English](doc/English/cloudflare/workers-deployment-guide.md)
- [中文](doc/中文/cloudflare/workers-部署指南.md)
- [日本語](doc/日本語/cloudflare/workers-デプロイガイド.md)

## Known Limitations

- **No native Node.js support** — The package exports `.ts` source files; requires Bun/Deno or a bundler
- **Sync API requires pre-initialization** — `parseFrontMatterSync()` requires `await initWasm()` beforehand; truly zero-config sync is not possible
- **Valibot only** — Schema validation only supports Valibot (via the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol); Zod etc. are not supported
- **YAML 1.2 only** — The Rust layer uses `serde-saphyr`, incompatible with YAML 1.1 features (e.g. octal `0777`, boolean `yes/no`)
- **No streaming** — Input is fully loaded into memory before parsing; files >1 MB are rejected

## Development

```bash
bun install
bun run build:wasm    # Requires Rust + wasm-pack
bun run test
bun run test:deno
bun run bench         # Performance benchmarks
```

**WASM build details:** `wasm-pack build` outputs to `pkg/` with `--target bundler`. Cargo is configured with `opt-level = "s"` + LTO for minimal binary size. Rust crate dependencies: `serde-saphyr` (YAML), `serde_json` (JSON), `toml` (TOML), `wasm-bindgen` + `serde-wasm-bindgen` (JS bridge).

## License

[AGPL-3.0-only](LICENSE)