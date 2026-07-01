# Propagation Engine — Private IP

This directory contains the proprietary propagation algorithm and is **not published** in any public repository.

**Do not:**
- Copy code from this directory into `backend/core/`, `backend/services/`, or any frontend file.
- Add this directory to a public git remote.
- Reproduce the algorithm logic in any open-source file.

**Public interface:** `POST /api/propagate` accepts a `PropagationRequest` and returns a `PropagationResult`. Both types are defined in `backend/schemas/results.py` and published as JSON Schema in `shared/schemas/results.schema.json`.

**Imports:** Only `backend/services/propagation_service.py` may import from this package.
