/**
 * Lazy WASM module loader.
 *
 * Supports two loading modes:
 *  1. **Bundler** (Vitest, Vite, Cloudflare Workers) — `import("../pkg/quill_matter_wasm.js")`
 *  2. **Direct** (Bun, Deno) — manually instantiate the WASM binary
 *
 * The module is loaded once and cached for subsequent calls.
 *
 * No `node:*` imports — uses only web-standard APIs (`URL`, `fetch`)
 * and runtime-specific file APIs (`Deno.readFile`, `Bun.file`).
 */

// Type declarations for runtime-specific globals
declare const Deno:
  | {
      readFile(path: string | URL): Promise<Uint8Array>;
    }
  | undefined;

declare const Bun:
  | {
      file(path: string | URL): { arrayBuffer(): Promise<ArrayBuffer> };
    }
  | undefined;

// biome-ignore lint/suspicious/noExplicitAny: WASM module shape is dynamic
let wasmModule: any | null = null;
let initPromise: Promise<WasmParsers> | null = null;

export interface WasmParsers {
  parse_yaml(input: string): unknown;
  parse_json(input: string): unknown;
  parse_toml(input: string): unknown;
  stringify_yaml(value: unknown): string;
  stringify_json(value: unknown): string;
  stringify_toml(value: unknown): string;
}

const REQUIRED_EXPORTS: (keyof WasmParsers)[] = [
  "parse_yaml",
  "parse_json",
  "parse_toml",
  "stringify_yaml",
  "stringify_json",
  "stringify_toml",
];

/** Verify that a loaded module exposes all expected functions. */
function validateWasmModule(mod: unknown): asserts mod is WasmParsers {
  for (const name of REQUIRED_EXPORTS) {
    if (typeof (mod as Record<string, unknown>)[name] !== "function") {
      throw new Error(
        `WASM module is missing expected export "${name}". ` +
          "The binary may be corrupted or built from an incompatible version.",
      );
    }
  }
}

/**
 * Initialise and return the WASM parser module (async).
 *
 * The module is loaded lazily on first call and cached thereafter.
 * Concurrent calls are deduplicated via a shared promise.
 */
export async function getWasmParsers(): Promise<WasmParsers> {
  if (wasmModule) {
    return wasmModule as WasmParsers;
  }

  if (initPromise) {
    return initPromise;
  }

  // Wrap the loading in a promise that concurrent callers can safely share.
  // On failure, each caller receives its own rejected promise while the
  // shared `initPromise` is cleared so that subsequent calls can retry.
  initPromise = loadWasm().then(
    (mod) => mod,
    (err) => {
      initPromise = null; // allow retry on next call
      throw new Error("Failed to load WASM module", { cause: err });
    },
  );

  return initPromise;
}

/**
 * Return the cached WASM module synchronously.
 *
 * @throws {Error} if `initWasm()` has not been called yet.
 */
export function getWasmParsersSync(): WasmParsers {
  if (!wasmModule) {
    throw new Error(
      "WASM not initialized — call `await initWasm()` before using synchronous APIs.",
    );
  }
  return wasmModule as WasmParsers;
}

/**
 * Eagerly pre-initialise the WASM module so the first `parseFrontMatter()`
 * call does not pay the loading cost.
 *
 * Calling this is **optional** for the async API but **required** before
 * using `parseFrontMatterSync()`.
 *
 * ```ts
 * import { initWasm } from "@quill/proteus";
 * await initWasm();
 * ```
 */
export async function initWasm(): Promise<void> {
  await getWasmParsers();
}

/**
 * Reset the cached module — useful for testing.
 * @internal
 */
export function _resetWasmCache(): void {
  wasmModule = null;
  initPromise = null;
}

/**
 * Pre-seed the WASM module cache with an already-initialised module.
 * Used by the Cloudflare Worker entry-point which statically imports
 * and manually instantiates the WASM binary.
 * @internal
 */
export function _preloadWasmModule(mod: WasmParsers): void {
  wasmModule = mod;
  initPromise = Promise.resolve(mod);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Read WASM file with runtime detection (Deno, Bun).
 * Uses web-standard `URL` objects — no `node:path` or `node:url` needed.
 */
async function readWasmFile(url: URL): Promise<ArrayBuffer> {
  // Deno
  if (typeof Deno !== "undefined") {
    const bytes = await Deno.readFile(url);
    return (bytes.buffer as ArrayBuffer).slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  }

  // Bun
  if (typeof Bun !== "undefined") {
    return Bun.file(url).arrayBuffer();
  }

  // Fallback: fetch (works in environments with file:// fetch support)
  const response = await fetch(url);
  return response.arrayBuffer();
}

/** Maximum time to wait for WASM module loading (30 seconds).
 * Prevents indefinite hangs from corrupted binaries or stalled network loads. */
const WASM_LOAD_TIMEOUT_MS = 30_000;

async function loadWasm(): Promise<WasmParsers> {
  // Wrap the entire load in a timeout to prevent indefinite hangs.
  // Clear the timer once loading completes to avoid timer leaks.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`WASM module loading timed out after ${WASM_LOAD_TIMEOUT_MS}ms`)),
      WASM_LOAD_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([loadWasmInner(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadWasmInner(): Promise<WasmParsers> {
  try {
    // Bundler-friendly import (works in Vitest, Vite, Cloudflare Workers, etc.)
    const mod = await import("../pkg/quill_matter_wasm.js");
    validateWasmModule(mod);
    wasmModule = mod;
    return mod;
  } catch (_bundlerErr) {
    // Fallback: manually load the WASM binary (Bun, Deno)
    try {
      return await loadWasmDirect();
    } catch (directErr) {
      const hint =
        "Ensure the WASM binary exists at pkg/quill_matter_wasm_bg.wasm " +
        "and was built with `bun run build:wasm`. " +
        "If running under a bundler, check that vite-plugin-wasm (or equivalent) is configured.";
      throw new Error(`Failed to load WASM module via both bundler and direct paths. ${hint}`, {
        cause: directErr,
      });
    }
  }
}

async function loadWasmDirect(): Promise<WasmParsers> {
  const bgModule = await import("../pkg/quill_matter_wasm_bg.js");

  // Resolve the .wasm path using web-standard `URL` constructor.
  // Works in Bun, Deno, and any environment with `import.meta.url`.
  let wasmUrl: URL;
  try {
    wasmUrl = new URL("../pkg/quill_matter_wasm_bg.wasm", import.meta.url);
  } catch (err) {
    throw new Error(
      "Failed to resolve WASM binary path: `import.meta.url` may not be available in this runtime.",
      { cause: err },
    );
  }

  let wasmBytes: ArrayBuffer;
  try {
    wasmBytes = await readWasmFile(wasmUrl);
  } catch (err) {
    throw new Error(
      `Failed to read WASM binary from ${wasmUrl.href}. Ensure the file exists and is accessible.`,
      { cause: err },
    );
  }

  const wasmImports = {
    "./quill_matter_wasm_bg.js": bgModule,
  };

  const { instance } = await WebAssembly.instantiate(wasmBytes, wasmImports);
  bgModule.__wbg_set_wasm(instance.exports);

  // Call the init function for externref table
  if (typeof instance.exports.__wbindgen_start === "function") {
    (instance.exports.__wbindgen_start as () => void)();
  }

  wasmModule = bgModule;
  validateWasmModule(bgModule);
  return bgModule;
}
