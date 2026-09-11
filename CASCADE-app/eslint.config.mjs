// ESLint flat config (Next 16 removed `next lint`; `npm run lint` → eslint).
// eslint-config-next v16 ships native flat configs: core-web-vitals covers
// React hooks correctness + Next-specific pitfalls; typescript adds TS rules.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  // public/maplibre/** is MapLibre's worker bundle copied verbatim out of
  // node_modules by scripts/copy-maplibre-worker.mjs — vendor code, not ours.
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "shared/schemas/**",
      "next-env.d.ts",
      "public/maplibre/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // React-Compiler-migration lints. The app does not use the compiler yet,
      // and the flagged sites are mostly the sanctioned SSR patterns (state
      // initialised from localStorage in a mount effect) or "reset editable
      // copy when upstream changes". Kept VISIBLE as warnings — fix per-site
      // when adopting the React Compiler, don't silence individually.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // Deliberately-unused values are underscore-prefixed by convention.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
