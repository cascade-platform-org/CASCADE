# Monorepo for app + backend + docs; engine public now, private-submodule deferred; config-driven dev/prod

**Status:** accepted

The project was three separate git repositories (root/docs with no remote,
`CASCADE-app` and `CASCADE-backend`, each with its own GitHub remote, both
`.gitignore`d by the root). We consolidate `CASCADE-app`, `CASCADE-backend`, and
`docs` into a **single monorepo**, published to the **existing
`CASCADE-app` GitHub repository** (repurposed as the monorepo home; the separate
`CASCADE-backend` repo is retired/archived).

## The engine is public for now

Contrary to CLAUDE.md §7 ("engine is private IP, inviolable"), the near-term plan
is to **publish the full backend — engine included — alongside the paper**. The
engine becomes proprietary only *later*, after refinement through company
collaboration. So the engine lives **directly in the monorepo, public**, not in a
private repo today. (CLAUDE.md §7 should be updated to reflect this — see below.)

We nonetheless keep the §7 **boundary discipline**: the engine stays an isolated
package imported only by `propagation_service`. That makes the *future*
privatization cheap — when it becomes proprietary, extract `engine/` into a
private repo/submodule (via `git-filter-repo`) and/or a separate internal service
(ADR-0008's deferred split), touching only that one seam.

## Why a monorepo

Schema-first development (CLAUDE.md §6) makes a schema change *one logical change
spanning both sides*: edit the Pydantic model → export JSON Schema → update the
Zod schema → fix call sites (§8). A monorepo makes that an atomic commit/PR with
one CI run type-checking both sides; separate repos turn it into two coordinated
PRs that can drift — the exact schema-drift failure §6/§8 exist to prevent. For a
solo/tiny team the four deployment components also build together from one place.

## Dev vs production — same code, different config

No forked codebase. Environments differ only in configuration, reusing the
existing `config.py` seam (`ENV`, `auth_enabled`, `assert_production_safe()`):

- `docker-compose.yml` — base (four services).
- `docker-compose.override.yml` — dev: hot-reload, ports on localhost, throwaway
  Postgres, `auth_enabled=false` for fast feature work (local-first needs no auth).
- `docker-compose.prod.yml` — prod: static frontend, Caddy + TLS + domain,
  restart policies, secrets from env, auth enforced.

Because the app is local-first, most UI work runs against a dev backend with auth
off — a fast inner loop. Full login is tested against a local Zitadel container.

## Migration (history preserved)

`git subtree add --prefix=CASCADE-app <app-repo> main` and the same for
`CASCADE-backend` import both file trees *with full commit history* into the
monorepo; the root's docs history is already there. Remove the two `.gitignore`
lines; delete the nested `.git` folders (archived as tarballs first). Point the
monorepo remote at the existing `CASCADE-app` GitHub repo.

## Considered options

- *Keep app and backend as separate repos (status quo).* Rejected: breaks atomic
  schema changes and clone/CI-as-one-unit.
- *Extract the engine to a private submodule now.* Rejected: contradicts
  publishing the engine with the paper. Deferred to when it becomes proprietary.

## Follow-up

- Done — CLAUDE.md §7 reflects: engine is published with the paper and
  becomes proprietary later; the boundary discipline exists to make future
  privatization cheap, not to hide the engine today.
