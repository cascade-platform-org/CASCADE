# Propagation Engine — isolated package

This directory holds the propagation algorithm. It is **published openly**: it
ships with the papers under the repository's AGPL-3.0-or-later licence. Some
modules may become proprietary later, as the engine is refined through company
collaboration (ADR-0009); the isolation rules below exist so that such a split
is a one-step operation touching a single seam, not a refactor.

**Keep the boundary:**

- Do not copy code from this directory into `CASCADE-backend/core/`,
  `CASCADE-backend/services/`, or any frontend file.
- Do not reproduce the algorithm's logic outside this package — client-side
  "for performance" or "for offline use" included.
- `CASCADE-backend/core/` holds open, auditable logic: graph utilities, rule
  parsing, analysis tools. The algorithm proper lives only here.

**Public interface:** `POST /api/propagate` accepts a `PropagationRequest` and
returns a `PropagationResult`. Both are defined in
`CASCADE-backend/schemas/results.py` and published as JSON Schema in
`CASCADE-app/shared/schemas/results.schema.json`.

**Imports:** only `CASCADE-backend/services/propagation_service.py` may import
from this package. The rule is mechanically enforced by `import-linter`
(`CASCADE-backend/pyproject.toml` → `[tool.importlinter]`); the dev-only
benchmark/validation harnesses listed there are the sole carve-outs.
