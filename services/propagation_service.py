"""
services/propagation_service.py — Orchestrates a Propagation run.

This is the only file that imports from engine/. It handles:
- scope filtering (delegated to core/graph.py)
- calling the engine
- returning the PropagationResult to the API layer

No engine logic lives here. No engine internals are exposed to callers.
"""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from core.graph import filter_project_by_scope
from engine import propagation as _engine
from schemas.results import PropagationRequest, PropagationResult

logger = logging.getLogger(__name__)

# Run the (potentially CPU-bound) engine in a thread pool so it doesn't
# block the async event loop.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="engine")


async def propagate(request: PropagationRequest) -> PropagationResult:
    """Filter the project by scope and call the engine asynchronously."""
    # Scope filtering is open, auditable logic in core/graph.py
    scoped = filter_project_by_scope(
        request.project,
        request.scope,
        request.active_canvas_id,
    )
    scoped_request = request.model_copy(update={"project": scoped})

    loop = asyncio.get_running_loop()
    result: PropagationResult = await loop.run_in_executor(
        _executor,
        _engine.run,
        scoped_request,
    )
    logger.info(
        "Propagation complete scope=%s iterations=%d warnings=%d",
        result.scope,
        result.iterations,
        len(result.warnings),
    )
    return result
