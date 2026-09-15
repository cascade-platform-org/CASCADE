/**
 * build-user-manual.mjs — regenerate the in-app manual from the markdown.
 *
 *   npm run docs:manual
 *
 * Reads `docs/project/user-manual.md`, parses it (manual-parse.mjs) and writes
 * `lib/generated/user-manual.ts`. The output is COMMITTED: the Docker image
 * copies only `CASCADE-app/`, so `docs/` does not exist at image build time and
 * the app has to ship the parsed form. `lib/manual/user-manual.test.ts` reparses
 * the markdown and compares, so a committed file that has gone stale fails the
 * suite rather than shipping.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManual } from "./manual-parse.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../../docs/project/user-manual.md");
const OUT = resolve(here, "../lib/generated/user-manual.ts");

const doc = parseManual(readFileSync(SOURCE, "utf8"));

const file = `// GENERATED FILE — do not edit.
// Source: docs/project/user-manual.md · Regenerate: npm run docs:manual
// The parity test in lib/manual/user-manual.test.ts fails when this is stale.

import type { ManualDoc } from "@/lib/manual/types";

export const USER_MANUAL: ManualDoc = ${JSON.stringify(doc, null, 2)};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, file);
console.log(`wrote ${OUT} — ${doc.sections.length} sections`);
