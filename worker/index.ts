// @ts-expect-error: no type declarations for generated _bg.js
import * as bgModule from "../pkg/quill_matter_wasm_bg.js";
// @ts-expect-error: wrangler resolves .wasm imports as WebAssembly.Module
import wasmBinary from "../pkg/quill_matter_wasm_bg.wasm";

import { parseFrontMatter } from "../src/index.js";
import { _preloadWasmModule } from "../src/wasm-loader.js";

/**
 * Eagerly initialise the WASM module using statically-imported artefacts
 * so that the first request does not pay the loading cost.
 */
const ready = (async () => {
  const instance = await WebAssembly.instantiate(wasmBinary, {
    "./quill_matter_wasm_bg.js": bgModule,
  });

  // Wire the raw WASM exports into the JS glue layer.
  bgModule.__wbg_set_wasm(instance.exports);

  // Initialise the externref table (required by wasm-bindgen output).
  if (typeof instance.exports.__wbindgen_start === "function") {
    (instance.exports.__wbindgen_start as () => void)();
  }

  // Seed the generic loader cache so `getWasmParsers()` skips dynamic loading.
  // biome-ignore lint/suspicious/noExplicitAny: wasm-bindgen generated module shape
  _preloadWasmModule(bgModule as any);
})();

export default {
  async fetch(request: Request): Promise<Response> {
    await ready;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Send a POST request with Markdown body" }, { status: 405 });
    }

    try {
      const markdown = await request.text();
      const result = await parseFrontMatter(markdown);
      return Response.json(result, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 400 });
    }
  },
};
