import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for Cloudflare Worker integration tests.
 *
 * These tests use Miniflare to run the wrangler-bundled worker inside the
 * real workerd runtime. They are separated from the unit tests because they
 * require a build step and have a longer setup timeout.
 */
export default defineConfig({
  test: {
    include: ["tests/worker-integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
