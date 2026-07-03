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
import threading
from concurrent.futures import Future, ThreadPoolExecutor

from core.graph import filter_project_by_scope
from engine import propagation as _engine
from schemas.results import PropagationRequest, PropagationResult

logger = logging.getLogger(__name__)

# Run the (potentially CPU-bound) engine in a thread pool so it doesn't
# block the async event loop.
_MAX_WORKERS = 4
_executor = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="engine")

# Hard wall-clock cap per run. Benchmarks put a 300-node propagation at ~8 ms,
# so a run still going after this long is pathological (adversarial params or
# an engine bug) — fail the request instead of wedging a worker forever.
# NOTE: Python threads cannot be killed; the runaway thread keeps burning CPU
# until it returns, but the request is freed and the problem surfaces. Repeat
# offenders are throttled by the entitlement budget before exhausting the pool.
ENGINE_TIMEOUT_SECONDS = 30.0

# Count of workers currently occupied by a running engine call. A slot is held
# from submission until the worker THREAD actually finishes — crucially, a run
# that hit the timeout keeps its slot because the thread cannot be killed and is
# still burning that worker. When all slots are held, new runs are rejected with
# EngineBusyError instead of queueing behind a wedged worker and waiting out
# their own full timeout. Guarded by a lock because the release callback runs in
# the worker thread, not the event loop.
_slots_lock = threading.Lock()
_slots_in_use = 0


class EngineTimeoutError(RuntimeError):
    """The engine exceeded ENGINE_TIMEOUT_SECONDS for a single run."""


class EngineBusyError(RuntimeError):
    """All engine workers are occupied; the run was rejected without queueing."""


async def propagate(request: PropagationRequest) -> PropagationResult:
    """Filter the project by scope and call the engine asynchronously."""
    global _slots_in_use
    with _slots_lock:
        if _slots_in_use >= _MAX_WORKERS:
            raise EngineBusyError(
                "The propagation engine is at capacity. Please retry in a moment."
            )
        _slots_in_use += 1

    def _release(_: Future) -> None:
        # Fires when the worker thread finishes — whether the awaiting request
        # is still there or was already freed by the timeout. This is the only
        # place the slot is released, so a genuinely wedged thread holds its
        # slot for as long as it runs (correct: the worker is unavailable).
        global _slots_in_use
        with _slots_lock:
            _slots_in_use -= 1

    # Scope filtering is open, auditable logic in core/graph.py
    scoped = filter_project_by_scope(
        request.project,
        request.scope,
        request.active_canvas_id,
    )
    scoped_request = request.model_copy(update={"project": scoped})

    fut: Future = _executor.submit(_engine.run, scoped_request)
    fut.add_done_callback(_release)
    try:
        result: PropagationResult = await asyncio.wait_for(
            asyncio.wrap_future(fut),
            timeout=ENGINE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        logger.error(
            "Engine run exceeded %.0fs (nodes=%d scope=%s) — aborting request.",
            ENGINE_TIMEOUT_SECONDS,
            len(scoped.nodes),
            request.scope,
        )
        raise EngineTimeoutError(
            f"Propagation exceeded the {ENGINE_TIMEOUT_SECONDS:.0f}s limit."
        ) from exc
    logger.info(
        "Propagation complete scope=%s iterations=%d warnings=%d",
        result.scope,
        result.iterations,
        len(result.warnings),
    )
    return result
