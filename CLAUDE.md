# CLAUDE.md — CASCADE Propagation Platform

Guidelines for AI-assisted development on this project.
Read this file at the start of every session and refer back to it before making any non-trivial decision.

---

## 0. Before You Start

Read **`CONTEXT.md`** (domain glossary) and any ADRs in **`docs/adr/`** that touch the area you're working in. Use CONTEXT.md vocabulary in all output — do not use synonyms the glossary marks as "Avoid". See `docs/agents/domain.md` for the full guidance on how to consume these files.

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

- Read `docs/project/requirements.md` to understand what is already specified.
- Read `docs/project/local-first-guide.md` for the canonical JSON schema (nodes, edges, canvases, config).
- Read `docs/project/architecture.md` for system structure and module boundaries.
- Search existing stores (`CASCADE-app/store/`), lib files (`CASCADE-app/lib/`), schemas (`CASCADE-backend/schemas/`), and core logic (`CASCADE-backend/core/`) for relevant types, utilities, or patterns.
- Check `CASCADE-backend/engine/` only to understand the interface — never modify or replicate its logic elsewhere.

Duplicating logic or inventing new field names that already exist in the schema is always a mistake.

---

## 3. Explain and Motivate Every Choice

The project owner has basic programming knowledge. For every non-trivial piece of code produced:

- **Explain what it does** in plain language before or after the code block.
- **Motivate the choice**: why this approach over alternatives, what trade-off was made.
- **Flag complexity**: if something is harder than it looks, say so and explain why.
- **Use analogies** when helpful — compare unfamiliar concepts to real-world things.
- Do not assume prior knowledge of React hooks, Zustand internals, Pydantic validators, async/await, or graph algorithms.

---

## 4. Keep Documentation in Sync

When a feature is added or changed, update the relevant `.md` files in the same session:

| Change type              | Files to update                                               |
| ------------------------ | ------------------------------------------------------------- |
| New field on node/edge   | `docs/project/local-first-guide.md` (JSON example + table)          |
| New API endpoint         | `docs/project/api-reference.md`                                     |
| Architecture change      | `docs/project/architecture.md`                                      |
| New feature or behaviour | `docs/project/requirements.md` (mark as implemented or update spec) |
| Deployment change        | `docs/project/deployment.md`                                        |
| New domain term or decision | `CONTEXT.md` and/or a new ADR in `docs/adr/`                    |

Do not leave docs stale. A doc that contradicts the code is worse than no doc.

---

## 5. SOLID Principles and Standard Best Practices

Apply these consistently:

- **Single Responsibility**: each file, class, or function does one thing.
- **Open/Closed**: extend behaviour through composition and configuration rather than modifying core logic.
- **Liskov Substitution**: subtypes must be usable wherever the base type is expected.
- **Interface Segregation**: keep Pydantic schemas focused; don't put unrelated fields in the same model.
- **Dependency Inversion**: high-level modules depend on abstractions, not on concrete implementations.

Additional practices:

- Write tests alongside new logic, not after.
- Keep functions small and pure where possible.
- Use TypeScript strictly: no `any`, no suppressed type errors.
- Validate at system boundaries (user input, API responses) using Zod (frontend) and Pydantic (backend). Trust internal types after validation.
- Package versions: **never hardcode versions from memory**. Use `npm install <pkg>` to resolve current stable versions. Commit `package-lock.json` to pin them.

---

## 6. Schema-First Development — Single Source of Truth

Types are defined **once** and derived everywhere else. The sequence for any schema change:

1. Update the **Pydantic model** in `CASCADE-backend/schemas/` (Python source of truth).
2. Run `python CASCADE-backend/scripts/export_json_schema.py` — writes JSON Schema files to `CASCADE-app/shared/schemas/`.
3. Apply the equivalent change to the **Zod schema** in `CASCADE-app/lib/schemas/` (TypeScript source of truth). TypeScript types (`z.infer<>`) update automatically.
4. The `CASCADE-app/lib/types/*.ts` files are thin re-export wrappers — never define types there directly.

**Never write a TypeScript interface that duplicates a Pydantic model.**

---

## 7. The Engine Boundary Is Inviolable

The propagation algorithm lives exclusively in `CASCADE-backend/engine/` and is private IP. This means:

- **Never** implement propagation logic in `CASCADE-backend/core/`, `CASCADE-backend/services/`, or anywhere on the frontend.
- **Never** expose engine internals through API responses beyond what `PropagationResult` defines.
- **Never** replicate or approximate the engine algorithm client-side "for performance" or "for offline use".
- `CASCADE-backend/core/` contains only open, auditable logic: graph utilities, rule parsing, analysis tools.
- Rule **parsing and validation** is permitted on the frontend. Rule **evaluation** belongs exclusively in the engine. (No frontend rule parser exists yet — the only parser is `CASCADE-backend/core/rule_parser.py`.)

When in doubt: if removing the code would make the proprietary algorithm less complete, it belongs in `engine/`.

---

## 8. Cross-Boundary Consistency

Whenever you change code that is **exported and consumed elsewhere** — a store action, a schema field, a utility function, a hook's return shape — immediately check every import site and update it in the same session. Do not leave callers relying on a signature that no longer exists.

Concretely:
- If a Pydantic model field changes, run `export_json_schema.py` and update the matching Zod schema before closing the task.
- If a Zustand store action is renamed or removed, grep for all call sites and update them before closing the task.
- If a shared utility's return type changes, check every consumer of that utility.
- TypeScript compilation (`npx tsc --noEmit`) is the minimum bar; pass it before considering any cross-boundary change done.

---

## 9. Requirements Are the Source of Truth

Before implementing any feature, read `docs/project/requirements.md`. If the feature is not described there, ask before building it. If the implementation deviates from the spec, update the spec with the rationale — don't silently diverge.

Open questions are listed in `docs/project/requirements.md §16`. Do not implement solutions to deferred decisions without explicit direction.
