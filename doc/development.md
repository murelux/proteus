# Development Guide

## Prerequisites

| Tool | Version | Purpose |
|:-----|:--------|:--------|
| [Bun](https://bun.sh) | ≥ 1.0 | Package manager, test runner, runtime |
| [Deno](https://deno.com) | ≥ 2.0 | Secondary runtime, type-checking |
| [Rust](https://rustup.rs) | stable | WASM parser build |
| [wasm-pack](https://rustwasm.github.io/wasm-pack/) | ≥ 0.14 | Rust → WASM compilation |

## Setup

```bash
git clone https://github.com/murelux/proteus.git
cd proteus
bun install
bun run build:wasm   # Compile Rust → pkg/
```

The WASM build outputs to `pkg/` with `--target bundler`. Cargo is configured with `opt-level = "s"` + LTO for minimal binary size.

---

## Scripts

All scripts are defined in `package.json`:

| Command | Description |
|:--------|:------------|
| `bun run build:wasm` | Build Rust WASM core to `pkg/` |
| `bun run test` | Run Bun tests (Vitest) |
| `bun run test:deno` | Run Deno tests |
| `bun run test:worker` | Run Cloudflare Worker integration tests (Miniflare) |
| `bun run test:watch` | Run tests in watch mode |
| `bun run bench` | Run performance benchmarks |
| `bun run typecheck` | Deno type checking |
| `bun run lint` | Biome linter |
| `bun run format` | Biome auto-format |
| `bun run dev` | Start local wrangler dev server |
| `bun run deploy` | Deploy Worker to Cloudflare |
| `bun run clean` | Remove build artefacts |
| `bun run clean:all` | Remove build artefacts + node_modules |

---

## Testing

### Bun (Primary)

Uses [Vitest](https://vitest.dev/) with `vite-plugin-wasm`.

```bash
bun run test          # Run all 286 tests
bun run test:watch    # Watch mode
```

Config: `vitest.config.ts`

Test files in `tests/`:

| File | Coverage |
|:-----|:---------|
| `detector.test.ts` | Format detection (YAML / JSON / TOML / unknown) |
| `extractor.test.ts` | Delimiter extraction, edge cases |
| `parsers.test.ts` | WASM parser for all three formats |
| `sanitizer.test.ts` | Prototype pollution guard (`__proto__`, `prototype`) |
| `validator.test.ts` | Valibot schema validation |
| `stringify.test.ts` | Serialization (data + content → Markdown) |
| `roundtrip.test.ts` | Parse → stringify → parse roundtrip fidelity |
| `excerpt.test.ts` | Excerpt extraction |
| `integration.test.ts` | Full-stack `parseFrontMatter()` integration |
| `file.test.ts` | `readFrontMatter()` file / URL reading |
| `sync.test.ts` | Sync API (`initWasm()` + `*Sync()` functions) |
| `wasm-loader.test.ts` | WASM lazy loading, caching, error paths |
| `worker.test.ts` | Worker handler logic (CORS, routing, KV mock) |
| `cli.test.ts` | CLI `proteus parse/detect/extract/validate` |
| `supplementary.test.ts` | Edge cases, large inputs, error sanitization |

### Deno

Uses Deno's built-in test runner with `@std/assert`.

```bash
bun run test:deno
# or directly:
deno test --allow-read --allow-write tests/deno.test.ts
```

Config: `deno.json` — includes `tasks.test` with the correct permissions.

The Deno test file (`tests/deno.test.ts`) imports from source directly (Deno handles `.ts` natively) and covers the core API surface: parse, stringify, sync, extract, detect, format detection, and error handling.

> **Note:** Install Deno dependencies before first run:
> ```bash
> deno install
> ```

### Cloudflare Workers (Integration)

Uses [Miniflare](https://miniflare.dev/) to run the bundled Worker inside the real `workerd` runtime — no `wrangler dev` subprocess needed.

```bash
bun run test:worker
```

Config: `vitest.config.worker.ts`

How it works:

1. `beforeAll` runs `wrangler deploy --dry-run --outdir .wrangler/dist` to produce a bundled ESModule + WASM binary
2. The bundled artefacts are loaded into a programmatic `Miniflare` instance
3. Requests are sent via `mf.dispatchFetch()` — all in-process, no HTTP server

Coverage:

| Area | Tests |
|:-----|:------|
| POST parsing | YAML, JSON, TOML, empty body, no front matter, unsupported Content-Type |
| Routing | OPTIONS preflight, method validation, namespace resolution, slug parsing |
| Security | `X-Content-Type-Options: nosniff` on success and error responses |

> **Note:** KV-dependent GET routes (`/:namespace/:slug`) are tested via mocked KV in `worker.test.ts`. The integration tests focus on the POST parsing endpoint and routing logic that requires the actual WASM runtime.

### Benchmarks

```bash
bun run bench
```

Uses [tinybench](https://github.com/tinylibs/tinybench) via Vitest's benchmark runner. Benchmark files are in `tests/benchmarks/`.

---

## WASM Build

The Rust crate is at `crates/parser-wasm/`.

```bash
bun run build:wasm
# equivalent to:
wasm-pack build crates/parser-wasm --target bundler --out-dir ../../pkg --release
```

Output files in `pkg/`:

| File | Purpose |
|:-----|:--------|
| `quill_matter_wasm_bg.wasm` | Compiled WASM binary |
| `quill_matter_wasm_bg.js` | JS glue code (wasm-bindgen generated) |
| `quill_matter_wasm.js` | Public entry point |
| `quill_matter_wasm.d.ts` | TypeScript declarations |

Rust crate dependencies:

| Crate | Purpose |
|:------|:--------|
| `serde-saphyr` | YAML 1.2 parsing |
| `serde_json` | JSON parsing |
| `toml` | TOML parsing |
| `wasm-bindgen` | JS ↔ Rust bridge |
| `serde-wasm-bindgen` | Serde ↔ JsValue conversion |

---

## Linting & Formatting

Uses [Biome](https://biomejs.dev/) (configured in `biome.json`):

```bash
bun run lint      # Check
bun run format    # Auto-fix
```

---

## Type Checking

Deno's type checker is used for cross-runtime type validation:

```bash
bun run typecheck
# equivalent to:
deno task check
```

---

## Project Structure

```
proteus/
├── src/               TypeScript library source
│   ├── index.ts       Main entry point (re-exports + WASM registration)
│   ├── extractor.ts   Front matter extraction (no WASM)
│   ├── detector.ts    Format detection (no WASM)
│   ├── parsers.ts     WASM parser wrappers
│   ├── stringify.ts   Serialization
│   ├── validator.ts   Valibot schema validation
│   ├── sanitizer.ts   Prototype pollution guard
│   ├── reader.ts      File / URL reading
│   ├── excerpt.ts     Excerpt extraction
│   ├── wasm-loader.ts WASM lazy loading
│   ├── error-utils.ts Error types and sanitization
│   └── types.ts       Type definitions
├── worker/            Cloudflare Worker
│   ├── index.ts       Fetch handler (routing, WASM init)
│   └── utils.ts       CORS, KV helpers, validation
├── cli/               CLI entry point
│   └── index.ts       proteus parse/detect/extract/validate
├── crates/
│   └── parser-wasm/   Rust WASM crate
│       ├── Cargo.toml
│       └── src/lib.rs
├── pkg/               WASM build output (generated)
├── tests/             Test files
│   └── benchmarks/    Performance benchmarks
├── doc/               Documentation
├── vitest.config.ts          Bun test config
├── vitest.config.worker.ts   Worker integration test config
├── wrangler.json             Cloudflare Workers config
├── deno.json                 Deno config
├── biome.json                Linter / formatter config
└── tsconfig.json             TypeScript config
```
