# vite-plugin-proteus

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSE)

A Vite plugin to import Markdown files as structured ES modules, powered by [`@quill/proteus`](https://jsr.io/@quill/proteus).

## Installation

```bash
# npm / pnpm / bun
npm install -D vite-plugin-proteus

# Install the core parser from JSR
bunx jsr add @quill/proteus   # Bun
deno add jsr:@quill/proteus   # Deno
```

> **Note:** `@quill/proteus` is distributed via [JSR](https://jsr.io/@quill/proteus), not npm.
> If you are using a Node.js / Vite project, install it via a bundler-compatible path or use `npx jsr add @quill/proteus`.

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { proteusPlugin } from 'vite-plugin-proteus';

export default defineConfig({
  plugins: [
    proteusPlugin({
      // Optional: restrict to specific file patterns
      include: /\.md$/,
      // Optional: extract excerpts
      excerpt: true,
    }),
  ],
});
```

## Usage

```ts
import post from './posts/hello.md';

post.data;    // Parsed front matter — typed as unknown by default
post.content; // Markdown body (front matter stripped)
post.excerpt; // First excerpt (requires excerpt: true in plugin options)
post.format;  // "yaml" | "json" | "toml" | null
post.isEmpty; // true when no front matter block was found
post.ast;     // { headings, links, images, code_blocks } — requires @quill/proteus >= 1.1.0
post.toc;     // Table of contents derived from headings (when available)
```

### TypeScript: typed front matter

```ts
import * as v from 'valibot';
import post from './posts/hello.md';

// Pass a Valibot schema via plugin options for typed data
// (see @quill/proteus ParseOptions.schema)
```

## Exported Fields per File

| Export    | Type                          | Description                                      |
|:----------|:------------------------------|:-------------------------------------------------|
| `data`    | `unknown` (or schema type)    | Parsed front matter object, `{}` when empty      |
| `content` | `string`                      | Markdown body with front matter stripped         |
| `excerpt` | `string \| null`              | First excerpt; `null` unless `excerpt` is set    |
| `format`  | `string \| null`              | Detected format: yaml / json / toml              |
| `isEmpty` | `boolean`                     | `true` when no front matter block was found      |
| `ast`     | `MarkdownAst \| null`         | Structural AST (headings, links, images, code)   |
| `toc`     | `TocItem[] \| null`           | Table of contents (when available)               |

## License

[Apache-2.0](../../LICENSE)
