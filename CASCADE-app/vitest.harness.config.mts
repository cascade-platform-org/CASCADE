/**
 * Config for the dev-only harnesses in scripts/. Separate from vitest.config.mts
 * on purpose: these need a live propagation engine, so they must never run as
 * part of `npm test` and never gate a commit.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.harness.ts"],
    testTimeout: 60 * 60 * 1000,
  },
});
