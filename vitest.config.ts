import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [wasm()],
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/deno.test.ts"],
    benchmark: {
      include: ["tests/benchmarks/**/*.bench.ts"],
    },
  },
  optimizeDeps: {
    exclude: ["quill_matter_wasm"],
  },
});
