/**
 * The last hop of CLAUDE.md §6's single source of truth.
 *
 * The chain is Pydantic → JSON Schema → Zod. CI already guards the first hop:
 * `export_json_schema.py` is re-run and `git diff --exit-code` fails if someone
 * changed `schemas/*.py` without regenerating `shared/schemas/`. The second hop
 * was a human remembering — a field added to a Pydantic model and forgotten in
 * the matching Zod schema produced no error anywhere. The frontend simply
 * dropped the field, silently, because an unknown key is not a Zod failure.
 *
 * This compares the two structurally: same property names, same required-ness.
 * It deliberately does NOT compare types. Zod is the TypeScript source of truth
 * (CLAUDE.md §6) and is allowed to be stricter — `z.number().int().min(1)` for a
 * JSON Schema `integer` with `minimum: 1`, branded ids, refinements. What it is
 * not allowed to be is *missing a field*, which is the failure this catches.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";

import * as network from "@/lib/schemas/network";
import * as config from "@/lib/schemas/config";
import * as auth from "@/lib/schemas/auth";
import * as api from "@/lib/schemas/api";
import * as propagation from "@/lib/schemas/propagation";
import * as audit from "@/lib/schemas/audit";

const SCHEMA_DIR = "shared/schemas";

/** Every exported Zod schema, by export name, across the schema modules. */
const zodExports: Record<string, unknown> = {};
for (const mod of [network, config, auth, api, propagation, audit]) {
  for (const [name, value] of Object.entries(mod as Record<string, unknown>)) {
    zodExports[name] ??= value;
  }
}

/** Pydantic model name → Zod export name, where the two simply differ. */
const ALIASES: Record<string, string> = {
  // Pydantic pluralises; Zod does not.
  GeoCoords: "GeoCoordSchema",
};

/**
 * Models with no Zod mirror, and why. Each entry is a claim that the frontend
 * has no business validating this shape — not a backlog item. A new name
 * appearing here should be argued for, which is the point of making the list
 * explicit rather than skipping silently.
 */
const NO_MIRROR: Record<string, string> = {
  Entitlement:
    "Server-side quota accounting (ADR-0008). The client never reads it: " +
    "GET /api/auth/me returns wildcard-expanded `permissions`, and the caps " +
    "are enforced by the backend, which is the only place they can be.",
  ConfigMeta:
    "Mirrored, but inline: ModelConfigurationSchema declares `meta` as an " +
    "anonymous z.object rather than a named export, so there is nothing for " +
    "this test to look up by name.",
  AuthUser:
    "The backend's decoded-claims object, injected into route handlers — it " +
    "is never a response body (GET /api/auth/me returns MeResponse, which IS " +
    "mirrored). The frontend had a Zod copy of it with no consumers, carrying " +
    "everything but `entitlement`; this test is what found it.",
  SaveProjectRequest:
    "An outbound request body the client constructs, never a response it " +
    "parses. Zod validates at the boundary where untrusted data ARRIVES.",
};

/** Property names Zod carries that the JSON Schema legitimately will not. */
const EXTRA_ALLOWED: Record<string, Set<string>> = {};

type JsonSchemaDef = {
  properties?: Record<string, unknown>;
  required?: string[];
};

function loadDefs(): Map<string, { file: string; def: JsonSchemaDef }> {
  const out = new Map<string, { file: string; def: JsonSchemaDef }>();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json"))) {
    const defs = JSON.parse(readFileSync(`${SCHEMA_DIR}/${file}`, "utf8")).$defs ?? {};
    for (const [name, def] of Object.entries(defs as Record<string, JsonSchemaDef>)) {
      // The same model is inlined into several bundles; one comparison is enough.
      if (!out.has(name)) out.set(name, { file, def });
    }
  }
  return out;
}

/** The Zod object behind an export, unwrapping the modifiers that hide `.shape`. */
function objectShape(schema: unknown): Record<string, z.ZodType> | null {
  let cur = schema;
  for (let i = 0; i < 10 && cur; i++) {
    if (cur instanceof z.ZodObject) return cur.shape as Record<string, z.ZodType>;
    const inner = (cur as { unwrap?: () => unknown }).unwrap;
    if (typeof inner !== "function") return null;
    cur = inner.call(cur);
  }
  return null;
}

const defs = loadDefs();

describe("Pydantic models are mirrored in Zod", () => {
  it("every model either has a Zod schema or a documented reason not to", () => {
    const unexplained = [...defs.keys()].filter(
      (name) =>
        !NO_MIRROR[name] && !zodExports[ALIASES[name] ?? `${name}Schema`],
    );
    expect(unexplained, "add a Zod schema, or an entry to NO_MIRROR saying why not").toEqual([]);
  });

  // One case per model, so a failure names the model rather than dumping all of them.
  for (const [name, { file, def }] of defs) {
    if (NO_MIRROR[name] || !def.properties) continue;
    const zodName = ALIASES[name] ?? `${name}Schema`;
    const schema = zodExports[zodName];
    if (!schema) continue; // reported by the test above

    it(`${name} (${file})`, () => {
      const shape = objectShape(schema);
      expect(shape, `${zodName} is not a z.object — this test cannot compare it`).not.toBeNull();
      if (!shape) return;

      const jsonProps = Object.keys(def.properties ?? {});
      const zodProps = Object.keys(shape);
      const allowed = EXTRA_ALLOWED[name] ?? new Set<string>();

      expect(
        jsonProps.filter((p) => !zodProps.includes(p)),
        `${zodName} is missing fields the Pydantic model has — re-run ` +
          "export_json_schema.py, then mirror them (CLAUDE.md §6)",
      ).toEqual([]);

      expect(
        zodProps.filter((p) => !jsonProps.includes(p) && !allowed.has(p)),
        `${zodName} has fields the Pydantic model does not — either the ` +
          "backend needs them too, or add them to EXTRA_ALLOWED with a reason",
      ).toEqual([]);

      // Required-ness, the other half of the shape. A field the backend
      // guarantees but Zod marks optional makes every consumer handle an
      // `undefined` that cannot happen; the reverse rejects valid payloads.
      const jsonRequired = new Set(def.required ?? []);
      const disagree = jsonProps
        .filter((p) => zodProps.includes(p))
        .filter((p) => jsonRequired.has(p) === shape[p].safeParse(undefined).success);
      expect(
        disagree,
        `required in one and optional in the other (${zodName})`,
      ).toEqual([]);
    });
  }
});
