# Proteus Matter

[![JSR](https://jsr.io/badges/@quill/proteus)](https://jsr.io/@quill/proteus)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

Markdown front matter parsing and serialization library. Uses **Rust → WebAssembly** as the YAML / JSON / TOML parsing and serialization core, with a TypeScript layer handling extraction, detection, validation, and I/O.

> Optimized for **Bun** · **Deno** · **Cloudflare Workers**

## Problems Solved

- **Multi-format blindspot** — Handle YAML, JSON, and TOML front matter simultaneously with automatic format detection
- **Type unsafety** — Parse results are `any`, requiring manual assertions; no structured representation for "no front matter" or "parse failure"
- **Separated schema validation** — Parsing and validation are separate steps, easy to forget
- **Prototype pollution** — Spreading `YAML.parse()` results directly into objects risks `__proto__` injection
- **Sync/async split** — Some scenarios (SSG builds) need synchronous APIs, others (edge computing) need async lazy loading

## Architecture

Proteus is a **monorepo** composed of several specialized packages:

- **`proteus`**: The core library handling extraction, parsing (Rust WASM), and validation.
- **`vite-plugin-proteus`**: A Vite plugin for importing Markdown files as structured data.

```
                        ┌──────────────────────────────────────────┐
                        │       Proteus Core (packages/proteus)    │
    Source string ─────►│                                          │
                        │  extractor/         Pure string ops      │
                        │        │                                 │
                        │        ▼                                 │
                        │  detector/          Delimiter detection  │
                        │        │                                 │
                        │        ▼                                 │
                        │  ┌─────────────────────────────────┐     │
                        │  │  Rust WASM (pkg/)               │     │
                        │  │  Parser Core (YAML/TOML/JSON)   │     │
                        │  └─────────────────────────────────┘     │
                        │        │                                 │
                        │        ▼                                 │
                        │  sanitizer/         Security filters     │
                        │        │                                 │
                        │        ▼                                 │
                        │  validator/         Standard Schema      │
                        │        │                                 │
                        │        ▼                                 │
                        │  ParseResult<T>         Discriminated    │
                        │                         union            │
                        └──────────────────────────────────────────┘
```

## Installation

### Core Library

```bash
# Bun
bun add @quill/proteus

# Deno
deno add jsr:@quill/proteus
```

### Vite Plugin

```bash
bun add vite-plugin-proteus -D
```

> **Note:** The core package exports TypeScript source files directly. It requires a TS-capable runtime (Bun, Deno) or a bundler (Vite, wrangler, etc.).

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

## Security

| Measure                  | Description                                                                                   |
|:-------------------------|:----------------------------------------------------------------------------------------------|
| **Prototype pollution guard** | Recursively filters `__proto__` and `prototype` keys; `constructor` is kept (attack chain blocked by `prototype` filter) |
| **Input/output size limit**   | 1 MB each for parse input and serialization output (UTF-8 bytes), enforced in both TS and Rust layers |
| **Error message sanitization** | In `strict: false` mode, error messages strip file paths and stack traces, truncated to 300 chars |
| **Security response headers** | Worker responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |

## Development

This is a Monorepo. Run commands from the root using Bun:

```bash
bun install
bun run build:wasm    # Rebuild Rust WASM core
bun test              # Run all tests (Core + Plugins)
bun run test:deno     # Run Deno-specific tests
```

For the complete guide — WASM build, linting, project structure, and per-runtime test details — see [doc/development.md](doc/development.md).

## License

[Apache-2.0](LICENSE)
