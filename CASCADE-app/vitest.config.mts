import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest runs the pure modules under `lib/` — the ones whose interface is a
 * plain function over project data (Event application, Situation derivation,
 * propagation payload, Scorecard maths). No DOM environment is configured on
 * purpose: a module that needs one to be tested is telling you its logic is in
 * the wrong place.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "store/**/*.test.ts"],
  },
});
