/**
 * Copy MapLibre's web worker (and the shared chunk it imports) into
 * public/maplibre/ so `setWorkerUrl` can point at a real, same-origin URL.
 *
 * Why this exists: maplibre-gl 6 ships as ES modules only, and its worker
 * imports a sibling file (`maplibre-gl-shared.mjs`) by relative path. Next.js
 * — in both its Turbopack and its --webpack mode — turns the usual
 * `new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)` trick
 * into a single hashed asset WITHOUT emitting that sibling next to it. The
 * worker then throws on its first import and the map mounts but never requests
 * a tile: a blank background, no error in the page. Serving both files verbatim
 * from public/ is the upstream-documented fix for this bundler.
 *
 * See: https://maplibre.org/maplibre-gl-js/docs/ → Installation → Turbopack tab.
 *
 * The copy runs at build time from node_modules, so it always matches the
 * installed version — nothing to keep in sync by hand.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.join(
  path.dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")),
  "dist",
);
const dest = path.join(process.cwd(), "public", "maplibre");

mkdirSync(dest, { recursive: true });
// Both files, not just the worker: the worker imports the shared chunk by
// relative path, so they have to land in the same directory.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
}
