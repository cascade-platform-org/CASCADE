"""
services/propagation_service.py — Orchestrates a Propagation run.

This is the only file that imports from engine/ (ADR-0009: keeps a future
extraction of the engine into a private submodule/service a one-step change
touching only this file). It handles:
- scope filtering (delegated to core/graph.py)
- calling the engine, OR — for a canvas whose graph_type is "epanet" — a
  live WNTR/EPANET solve instead (services/epanet_solve_service.py, which is
  deliberately engine-import-free; see its module docstring). This file does
  the ratio-to-level quantization for that path too (`engine.flow._ratio_to_level`,
  the same rule the normal flow heuristic uses), so the two paths' functionality
  levels stay a fair comparison without epanet_solve_service.py needing its
  own engine import.
- returning the PropagationResult to the API layer

No engine logic lives here. No engine internals are exposed to callers.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool

from core.graph import filter_project_by_scope, with_failed_elements
from core.importers.inp import InpParseError, load_inp
from core.importers.inp.map import compute_junction_demands
from engine import propagation as _engine
from engine.flow import _ratio_to_level
from schemas.network import Project
from schemas.results import (
    BatchPropagationRequest,
    ElementUpdate,
    PropagationRequest,
    PropagationResult,
)
from services.epanet_solve_service import (
    solve_epanet_snapshot,
    translate_project_to_broken_links,
)

logger = logging.getLogger(__name__)

_EPANET_GRAPH_TYPE = "epanet"

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


async def propagate_batch(request: BatchPropagationRequest) -> list[PropagationResult]:
    """Propagate one Project against many coalitions, in order.

    Deliberately sequential over the existing `propagate()`, not a fan-out. Two
    reasons: the engine already owns a bounded worker pool (`_MAX_WORKERS`), and
    letting one request occupy all of it would starve every other user for the
    length of a model-based Analysis run. This endpoint exists to stop re-sending
    and re-parsing an unchanged Project hundreds of times, which is transport
    cost — not to add concurrency the engine did not have.

    Every coalition therefore goes through the identical path a single
    Propagation takes, including the EPANET-mode branch and the timeout, so a
    batched result cannot differ from the same Scenario run on its own.
    """
    results: list[PropagationResult] = []
    for coalition in request.coalitions:
        results.append(
            await propagate(
                PropagationRequest(
                    project=with_failed_elements(request.project, coalition),
                    config=request.config,
                    scope=request.scope,
                    active_canvas_id=request.active_canvas_id,
                )
            )
        )
    return results


async def propagate(request: PropagationRequest) -> PropagationResult:
    """Filter the project by scope and call the engine asynchronously."""
    # Scope filtering is open, auditable logic in core/graph.py
    scoped = filter_project_by_scope(
        request.project,
        request.scope,
        request.active_canvas_id,
    )

    # A canvas whose graph_type is "epanet" bypasses the engine entirely — see
    # module docstring and _run_epanet below. Only meaningful for local scope
    # (a single canvas); global scope with an "epanet" canvas mixed into it
    # falls through to the normal engine, same as any other unrecognized
    # graph_type would (global Propagation composes multiple graph_types'
    # heuristics by design — there is no live-EPANET equivalent for that).
    # This branch never touches the engine's worker-slot pool below — it's a
    # different, unrelated resource (a WNTR solve, not engine.propagation.run)
    # and gets its own thread-pool offload via run_in_threadpool instead.
    # The scope check is load-bearing: global scope keeps EVERY canvas, so
    # canvases[0] is whichever happens to be listed first — without it, a
    # project whose first canvas is "epanet" would have its whole global
    # Propagation silently reduced to an EPANET solve of that one canvas.
    if (
        request.scope == "local"
        and scoped.canvases
        and scoped.canvases[0].graph.graph_type == _EPANET_GRAPH_TYPE
    ):
        return await run_in_threadpool(_run_epanet, scoped, request)

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


def _run_epanet(scoped: Project, request: PropagationRequest) -> PropagationResult:
    """Live WNTR/EPANET solve for a canvas whose graph_type is "epanet",
    instead of engine.propagation.run. Runs synchronously (offloaded to a
    thread by the caller, `propagate`, via run_in_threadpool) — this is
    CPU-bound work exactly like the engine call above, just via a different
    solver.

    Raises ValueError for any client-correctable problem (no
    source_inp_content embedded on the canvas, or content that fails to
    parse) — the API layer already maps ValueError to a 422 with the message
    shown verbatim (api/propagation_routes.py), the same convention
    core/graph.py's filter_project_by_scope uses for a missing/invalid
    active_canvas_id.
    """
    canvas = scoped.canvases[0]
    if not canvas.source_inp_content:
        raise ValueError(
            f"Canvas '{canvas.id}' has graph_type='{_EPANET_GRAPH_TYPE}' but no embedded "
            ".inp source — re-import this canvas from its .inp file to enable EPANET-mode "
            "propagation (the original file's content is stored on the canvas at import time)."
        )
    try:
        wn = load_inp(canvas.source_inp_content)
    except InpParseError as exc:
        raise ValueError(
            f"The .inp source embedded on canvas '{canvas.id}' failed to parse: {exc}"
        ) from exc

    demand_mode = canvas.source_inp_demand_mode or "peak"
    demands = compute_junction_demands(wn, demand_mode)

    max_level = max(level.level for level in request.config.functionality_scale)
    n_levels = len(request.config.functionality_scale)
    broken_link_ids, skipped = translate_project_to_broken_links(scoped, wn, max_level)

    ratios = solve_epanet_snapshot(wn, demands, broken_link_ids)
    # Same quantization rule the normal flow heuristic uses (engine.flow._ratio_to_level)
    # — see module docstring for why this file, not epanet_solve_service.py, does it.
    levels = {jid: _ratio_to_level(ratio, n_levels) for jid, ratio in ratios.items()}

    inp_id_to_node_id = {
        (node.properties or {}).get("inp_id"): nid
        for nid, node in scoped.nodes.items()
        if (node.properties or {}).get("inp_id")
    }
    updates = [
        ElementUpdate(id=inp_id_to_node_id[jid], functionality=level)
        for jid, level in levels.items()
        if jid in inp_id_to_node_id
    ]

    warnings = [f"Not reflected in this EPANET solve: {label}" for label in skipped]
    if not levels:
        warnings.append(
            "The EPANET solve did not converge or produced no result for this "
            "intervention — no functionality updates were computed."
        )

    logger.info(
        "EPANET-mode propagation complete canvas=%s updates=%d skipped=%d",
        canvas.id,
        len(updates),
        len(skipped),
    )
    return PropagationResult(
        scope=request.scope,
        updates=updates,
        computed_at=datetime.now(timezone.utc),
        iterations=1,
        warnings=warnings,
    )
