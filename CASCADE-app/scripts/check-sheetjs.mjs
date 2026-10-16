// SheetJS CE is installed from the vendor's server (cdn.sheetjs.com), which
// Dependabot does not watch (ADR-0023 §5). This fails when a newer release is
// published there, so the upgrade is made like any other.
import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).dependencies.xlsx;
const installed = /xlsx-(\d+\.\d+\.\d+)\.tgz$/.exec(spec)?.[1];
if (!installed) throw new Error(`package.json pins xlsx to an unexpected source: ${spec}`);
const res = await fetch("https://cdn.sheetjs.com/xlsx-latest/package/package.json");
if (!res.ok) throw new Error(`cdn.sheetjs.com answered ${res.status}`);
const latest = (await res.json()).version;
if (latest !== installed) {
  console.error(`SheetJS CE ${latest} is out (installed ${installed}): npm install https://cdn.sheetjs.com/xlsx-${latest}/xlsx-${latest}.tgz`);
  process.exit(1);
}
console.log(`SheetJS CE ${installed} is the latest release.`);
