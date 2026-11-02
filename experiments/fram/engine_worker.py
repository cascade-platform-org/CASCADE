"""
engine_worker.py — the engine behind `ts/run_timeline.ts`: one PropagationRequest
per stdin line in, one PropagationResult per stdout line out.

It calls `services.propagation_service.propagate`, the function
`POST /api/propagate` calls, and serialises null-free as that endpoint does, so
a Temporal Simulation run here sees what it sees in the app. No HTTP server,
no auth: the harness is local.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "CASCADE-backend"))

import schemas.results  # noqa: E402,F401  (defines PropagationResult, which Project references)
from schemas.results import PropagationRequest  # noqa: E402
from services.propagation_service import propagate  # noqa: E402


async def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        result = await propagate(PropagationRequest.model_validate_json(line))
        sys.stdout.write(result.model_dump_json(exclude_none=True) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
