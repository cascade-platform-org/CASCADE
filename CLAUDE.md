# CLAUDE.md — CASCADE Propagation Platform

Guidelines for AI-assisted development on this project.
Read this file at the start of every session and refer back to it before making any non-trivial decision.

---

## 1. Open-Source and License Compliance

Every package, library, service, and tool used in this project — frontend, backend, database, auth provider, tile server, or CI tool — **must be free and open-source**. No paid tiers, no proprietary SaaS dependencies, no copyright-encumbered code.

Before introducing any new dependency:

- Check its license (MIT, Apache 2.0, GPL, LGPL, MPL are generally fine; check copyleft implications for GPL).
- Confirm it has no mandatory paid component for the use case at hand.
- Prefer widely-adopted libraries with active maintenance.

If unsure, ask before adding.

---

## 2. Check Before Writing

Before writing any new code or schema, search the project for existing implementations:

- Read `docs/requirements.md` to understand what is already specified.
- Read `docs/local-first-guide.md` for the canonical JSON schema (nodes, edges, canvases, config).
- Read `docs/architecture.md` for system structure and module boundaries.
- Search existing stores (`app/store/`), lib files (`app/lib/`), schemas (`backend/schemas/`), and core logic (`backend/core/`) for relevant types, utilities, or patterns.
- Check `backend/engine/` only to understand the interface — never modify or replicate its logic elsewhere.

Duplicating logic or inventing new field names that already exist in the schema is always a mistake.

---

## 3. Explain and Motivate Every Choice

The project owner has basic programming knowledge. For every non-trivial piece of code produced:

- **Explain what it does** in plain language before or after the code block.
- **Motivate the choice**: why this approach over alternatives, what trade-off was made.
- **Flag complexity**: if something is harder than it looks, say so and explain why.
- **Use analogies** when helpful — compare unfamiliar concepts to real-world things.
- Do not assume prior knowledge of React hooks, Zustand internals, Pydantic validators, async/await, or graph algorithms.

Example of the expected style:

> "This is a Zustand store slice — think of it as a shared box that any component can read from or write to, without having to pass data through every component in between. We use `immer` so we can write mutations that look like direct assignments but are actually safe and immutable under the hood."

---

## 4. Keep Documentation in Sync

When a feature is added or changed, update the relevant `.md` files in the same session:

| Change type              | Files to update                                               |
| ------------------------ | ------------------------------------------------------------- |
| New field on node/edge   | `docs/local-first-guide.md` (JSON example + table)          |
| New API endpoint         | `docs/api-reference.md`                                     |
| Architecture change      | `docs/architecture.md`                                      |
| New feature or behaviour | `docs/requirements.md` (mark as implemented or update spec) |
| Deployment change        | `docs/deployment.md`                                        |

Do not leave docs stale. A doc that contradicts the code is worse than no doc.

---

## 5. SOLID Principles and Standard Best Practices

Apply these consistently:

- **Single Responsibility**: each file, class, or function does one thing. A component that fetches data, transforms it, and renders it is three things — split it.
- **Open/Closed**: extend behaviour through composition and configuration rather than modifying core logic. The propagation engine interface should never need to change when a new category type is added — the engine handles it via the config.
- **Liskov Substitution**: subtypes (e.g. a specific node type) must be usable wherever the base type is expected.
- **Interface Segregation**: don't force a caller to depend on methods it doesn't use. Keep Pydantic schemas focused; don't put unrelated fields in the same model.
- **Dependency Inversion**: high-level modules (simulation service) depend on abstractions (engine interface), not on the concrete engine implementation.

Additional practices:

- Write tests alongside new logic, not after.
- Keep functions small and pure where possible — easier to test and reason about.
- Use TypeScript strictly: no `any`, no suppressed type errors.
- Validate at system boundaries (user input, API responses) using Zod (frontend) and Pydantic (backend). Trust internal types after validation.

---

## 6. Schema-First Development — Single Source of Truth

Types are defined **once** and derived everywhere else. The sequence for any schema change:

1. Update the **Pydantic model** in `backend/schemas/` (Python source of truth).
2. Run `python backend/scripts/export_json_schema.py` — this writes JSON Schema files to `shared/schemas/`.
3. Apply the equivalent change to the **Zod schema** in `app/lib/schemas/` (TypeScript source of truth). TypeScript types (`z.infer<>`) update automatically.
4. The `app/lib/types/*.ts` files are thin re-export wrappers — never define types there directly.

**Never write a TypeScript interface that duplicates a Pydantic model.** If you need a new type, define it in the Zod schema file first.

This ensures the client and server always agree on the data shape. The JSON example in `docs/local-first-guide.md` is the human-readable contract; Pydantic + Zod are its machine-readable enforcement.

---

## 7. The Engine Boundary Is Inviolable

The propagation algorithm lives exclusively in `backend/engine/` and is private IP. This means:

- **Never** implement propagation logic in `backend/core/`, `backend/services/`, or anywhere on the frontend.
- **Never** expose engine internals through API responses beyond what `PropagationResult` defines.
- **Never** replicate or approximate the engine algorithm client-side "for performance" or "for offline use".
- `backend/core/` contains only open, auditable logic: graph utilities, rule parsing, analysis tools. If something feels like it should go there but relates to propagation, it belongs in `engine/`.
- Rule **parsing and validation** (checking syntax, detecting unsatisfied references) is permitted on the frontend — `rule-parser.ts` and `dependency-utils.ts` serve this purpose. Rule **evaluation** (computing which nodes change functionality) belongs exclusively in the engine.

When in doubt: if removing the code would make the proprietary algorithm less complete, it belongs in `engine/`.

---

## 8. Functionality Scale Is Always 1-N from Config

The number of functionality levels (N) and their labels and colours come from the config file. They are **never hardcoded**.

- Do not write `if (functionality === "critical")` — compare against config level values.
- Do not assume N = 3.
- Do not hardcode colours like `"#ef4444"` for critical — read from `config.functionality_scale`.
- `time_warning` is an orthogonal status, not a slot in the 1-N scale. Handle it separately.

The formula for delivered/demand ratio → functionality level is:

```
base = ceil(ratio × N)                        // clamped 1..N
proposed = base + (N − dependency_level)      // clamped 1..N
```

Apply only if it worsens the current level. Use this formula everywhere ratio-based degradation appears.

Vulnerability level formula (hazards/disservices):

```
imposed = N − vulnerability_level             // clamped to 1
```

Apply only if it worsens current functionality.

---

## 9. Requirements Are the Source of Truth

Before implementing any feature, read `docs/requirements.md`. If the feature is not described there, ask before building it. If the implementation deviates from the spec, update the spec with the rationale — don't silently diverge.

Open questions are listed in `docs/requirements.md §16`. Do not implement solutions to deferred decisions without explicit direction.

---

## 10. Time Unit Is Always Hours

`functionality_time`, `backup_duration`, and `expected_repair_time` are all in **hours** (integer). Never mix units. If a UI displays minutes or days, convert at the display layer only — store and transmit hours.

---

## 11. Propagation Scope Must Be Respected

Every operation that reads or modifies node/edge state must be aware of scope:

- **Local scope**: operates only on nodes and edges within the active canvas. Inter-canvas edges are ignored entirely.
- **Global scope**: operates across all canvases; inter-canvas edges participate.

Scope is set in `ui-store`. Components and hooks must read it — do not assume global scope by default.

---

## Project-Specific Reminders

- The project JSON schema version is `"2.0"`. When reading files, check the version field and handle or reject older formats gracefully.
- `node_categories` is a list — a node can serve multiple categories. Never assume a single category per node.
- `category_type` (`SourceToDemands` | `Requisite` | …) lives in the **config**, not on the node. Always look it up from the config when you need it.
- **Edges carry no `category` or `category_blocks`**. The engine infers which categories flow through an edge from the intersection of the source node's supply and the target node's demands.
- Monotone propagation: functionality can only **worsen** during a propagation run. Never write code that improves a node's functionality as part of propagation.
- The `direct_damage` flag distinguishes physical breakage (hazard) from functional degradation (disservice). Recovery mechanics for `direct_damage` nodes are handled in the timeline module and are intentionally deferred — do not implement ad-hoc recovery logic elsewhere.
- Hazard frequency is expressed as `frequency_per_10y` (occurrences per 10 years). Never use `probability` — the two are different quantities and `frequency_per_10y` is more actionable for scenario planning.
- The API endpoint for propagation is `POST /api/propagate` (not `/api/simulate`). The file `backend/api/propagation_routes.py` owns it.
- RBAC roles are `viewer | analyst | manager | admin`. The permission for running propagation is `can_propagate` (not `can_simulate`).
- Package versions: **never hardcode versions from memory**. Use `npm install <pkg>` or `npx create-next-app` to resolve the current stable versions. Commit `package-lock.json` to pin them.
