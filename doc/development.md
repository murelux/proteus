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
| `bun run test:worker` | Run the Cloudflare Worker integration tests for `packages/proteus` from the monorepo root |
| `bun run test:deno` | Run the Deno test suite for `packages/proteus` from the monorepo root |
| `bun run typecheck:deno` | Run Deno type-checking for `packages/proteus` from the monorepo root |
| `bun run build:wasm` | Rebuild the WASM core |
| `bun run lint` | Lint all packages using Biome |
| `bun run format` | Format all files |
| `bun run dev:worker` | Start the Cloudflare Worker from the monorepo root |
| `bun run deploy:worker` | Deploy the Cloudflare Worker from the monorepo root |

## Package: `proteus` (Core)

Located in `packages/proteus`.

### Command Policy
- Default to the repository root for day-to-day development.
- Drop into `packages/proteus` only for package-specific debugging, publishing, or when a tool requires that exact working directory.
- Keep root scripts as the canonical interface so CI and local workflows stay aligned.

### Testing
- `bun test`: Runs Vitest suite (including Cloudflare Worker mocks).
- `bun run test:deno`: Runs Deno test suite.
- `bun run typecheck:deno`: Runs Deno type-checking without changing package directories.
- `bun run test:worker`: Runs integration tests using Miniflare.

The repository root contains the workspace-level `deno.json` so Deno 2 can
resolve package-local config and `node_modules` correctly inside the monorepo.

### Dependency Security

The repository currently resolves patched versions for the advisories that were
raised in Dependabot for the dev toolchain:

- `vitest@4.1.0`
- `vite@8.0.1`
- `vite@7.3.1` via `vitest` / `vite-plugin-wasm`
- `wrangler@4.76.0`
- `rollup@4.57.1` via `tsup`

These are all pinned in the root lockfile (`bun.lock`). If GitHub still shows
older Vite / Vitest / Wrangler alerts, verify that the default branch contains
the latest lockfile and wait for Dependabot to re-index the branch state.

### Push Checklist

Before pushing:

- `bun run lint`
- `bun test`
- `bun run typecheck:deno`
- If Worker code changed, review [cloudflare-workers.md](./cloudflare-workers.md)
  and keep the documented deploy command aligned with the root scripts.

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
