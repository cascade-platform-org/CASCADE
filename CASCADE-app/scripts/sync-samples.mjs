#!/usr/bin/env node
// scripts/sync-samples.mjs — copies samples/public/ into public/samples/, the
// directory Next.js serves at the site root. samples/public/ is the source of
// truth (authored, git-tracked); public/samples/ is a generated build artifact
// (gitignored) so the served files can never drift from the authored ones —
// see samples/README.md.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const src = path.join(root, "samples/public");
const dest = path.join(root, "public/samples");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

console.log(`Synced ${src} -> ${dest}`);
