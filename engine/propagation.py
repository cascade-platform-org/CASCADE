"""
engine/propagation.py — Propagation engine (PRIVATE IP).

DEVELOPMENT DUMMY — for frontend testing only.

Simulates one propagation step by picking one random node whose Functionality
is above 1 and degrading it by 1 level. This is enough to exercise the full
frontend round-trip:

    PropagationRequest → POST /api/propagate → PropagationResult
    → canvas-store.applyPropagationResult → re-render

Behaviour:
  - Collects all nodes in the request with functionality > 1.
  - Picks one at random.
  - Returns an ElementUpdate with functionality -= 1 and a responsibility_share
    pointing to the node itself (self-caused, for UI causality display).
  - If every node is already at Functionality 1 (worst), returns an empty
    update list with a warning.

Replace this file with the real engine module before shipping.

The public interface is:
    run(request: PropagationRequest) -> PropagationResult

Only services/propagation_service.py may import from this package.
"""
from __future__ import annotations

import random
from datetime import datetime, timezone

from schemas.results import ElementUpdate, PropagationRequest, PropagationResult


def run(request: PropagationRequest) -> PropagationResult:
    nodes = request.project.nodes

    # Collect candidates: nodes currently above Functionality 1.
    candidates = [
        node for node in nodes.values()
        if (node.functionality or 1) > 1
    ]

    if not candidates:
        return PropagationResult(
            scope=request.scope,
            updates=[],
            computed_at=datetime.now(tz=timezone.utc),
            iterations=1,
            warnings=["Dummy engine: all nodes are already at Functionality 1 — nothing to degrade."],
        )

    target = random.choice(candidates)
    new_functionality = (target.functionality or 1) - 1

    update = ElementUpdate(
        id=target.id,
        functionality=new_functionality,
        responsibility_share={target.id: 1.0},
    )

    return PropagationResult(
        scope=request.scope,
        updates=[update],
        computed_at=datetime.now(tz=timezone.utc),
        iterations=1,
        warnings=["Dummy engine: one random node degraded by 1 Functionality level."],
    )
