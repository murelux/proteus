# Development Guide (Monorepo)

## Prerequisites

| Tool | Version | Purpose |
|:-----|:--------|:--------|
| [Bun](https://bun.sh) | ≥ 1.0 | Package manager, monorepo orchestrator |
| [Deno](https://deno.com) | ≥ 2.0 | Runtime for Deno-specific core tests |
| [Rust](https://rustup.rs) | stable | WASM parser source |
| [wasm-pack](https://rustwasm.github.io/wasm-pack/) | ≥ 0.14 | Rust → WASM compilation |

## Structure

- `packages/proteus`: Core library (the main `@quill/proteus` package logic)
- `packages/vite-plugin-proteus`: Vite plugin
- `crates/parser-wasm`: Rust source code

## Setup

```bash
git clone https://github.com/murelux/proteus.git
cd proteus
bun install
bun run build:wasm   # Compile Rust → packages/proteus/pkg/
```

## Global Scripts (Root)

| Command | Description |
|:--------|:------------|
| `bun test` | Run all tests across all packages |
| `bun run build:wasm` | Rebuild the WASM core |
| `bun run lint` | Lint all packages using Biome |
| `bun run format` | Format all files |

## Package: `proteus` (Core)

Located in `packages/proteus`.

### Testing
- `bun test`: Runs Vitest suite (including Cloudflare Worker mocks).
- `bun run test:deno`: Runs Deno test suite.
- `bun run test:worker`: Runs integration tests using Miniflare.

### WASM Optimization
The WASM build uses aggressive optimization settings in `crates/parser-wasm/Cargo.toml`:
- `opt-level = "z"`
- `lto = true`
- `codegen-units = 1`
- `wasm-opt = ["-Oz", "--strip-debug"]`

Current Binary Size: **~155 KB**.

## Package: `vite-plugin-proteus`

Located in `packages/vite-plugin-proteus`.

Allows importing Markdown as data:
```ts
import { data, content } from './post.md';
```

---

## License

[Apache-2.0](LICENSE)
