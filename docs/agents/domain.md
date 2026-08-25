# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the workspace root (`/CASCADE-v2/CONTEXT.md`) — domain glossary and bounded contexts for the full CASCADE system (frontend + backend).
- **`docs/adr/`** at the workspace root — read ADRs that touch the area you're about to work in.

If either of these files doesn't exist yet, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions get resolved.

## File structure

Single workspace, two separate git repositories:

```
CASCADE-v2/                  ← workspace root (NOT itself a git repo)
├── CLAUDE.md
├── CONTEXT.md               ← domain glossary for the whole system
├── docs/
│   ├── adr/                 ← architectural decision records
│   ├── agents/              ← skill configuration (this folder)
│   └── project/             ← product docs (requirements, architecture, local-first guide, api-reference, deployment, rbac-setup)
├── CASCADE-app/             ← Next.js frontend
└── CASCADE-backend/         ← FastAPI backend
```

Single monorepo (ADR-0009): one git repository rooted at `CASCADE-v2/`, published as
`cascade-platform-org/CASCADE`. `CASCADE-app/` and `CASCADE-backend/` are plain
subdirectories, not separate repos — run `git`/`gh` from the workspace root, not
from inside either subdirectory.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts and ask questions
