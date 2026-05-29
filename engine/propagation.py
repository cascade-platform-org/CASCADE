"""
engine/propagation.py — Propagation engine (PRIVATE IP).

This file is a deployment stub. The real algorithm is not published.
It implements the same interface the service layer expects so the server
starts and returns a valid (identity) PropagationResult.

The public interface is:
    run(request: PropagationRequest) -> PropagationResult

Only services/propagation_service.py may import from this package.
"""
from __future__ import annotations

from datetime import datetime, timezone

from schemas.results import PropagationRequest, PropagationResult


def run(request: PropagationRequest) -> PropagationResult:
    """Run the propagation algorithm and return a result.

    This stub returns an identity result (no element updates) so the
    full request/response cycle works end-to-end while the real algorithm
    is not present.
    """
    return PropagationResult(
        scope=request.scope,
        updates=[],
        computed_at=datetime.now(tz=timezone.utc),
        iterations=0,
        warnings=["Engine stub: no propagation performed. Deploy the real engine module."],
    )
