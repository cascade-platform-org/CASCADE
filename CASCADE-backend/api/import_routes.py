"""
api/import_routes.py — EPANET .inp → CASCADE ProjectBundle importer.

POST /api/import/inp — parse, (optionally) skeletonize to a node budget, run a
hydraulic sweep for edge orientation, and map to the CASCADE schema. Pure
transformation: nothing is persisted, the engine is never invoked, and the
caller loads the returned bundle client-side exactly like a local file. Auth =
any authenticated caller (`get_current_user`); no permission gate because the
endpoint grants nothing the client couldn't compute from the same file locally.

The heavy lifting (WNTR parse + sweep) is CPU-bound synchronous code — it runs
in a worker thread so the event loop stays responsive.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from auth.dependencies import get_current_user
from core.importers.inp import (
    GeoTransformError,
    InpParseError,
    SkeletonError,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
    load_inp,
    skeletonize_to_target,
)
from schemas.auth import AuthUser
from schemas.import_inp import ImportInpRequest, ImportInpResponse

router = APIRouter(prefix="/api/import", tags=["import"])

# Fallback budget when the request omits target_nodes and the caller's role is
# unbounded (admin / local mode): even unlimited users get a usable canvas.
_DEFAULT_TARGET_NODES = 300


def _run_import(body: ImportInpRequest, target_nodes: int) -> ImportInpResponse:
    warnings: list[str] = []

    wn = load_inp(body.content)
    original_nodes = wn.num_nodes

    # Demand for the chosen mode, on the ORIGINAL network — needed before
    # skeletonization (the sweep and emitted demands must agree; see below).
    original_demands = compute_junction_demands(wn, body.demand_mode)

    # Skeletonize FIRST: it is the step that can fail (SkeletonError on an
    # unreachable node budget), and the hydraulic sweeps are the expensive
    # part — never spend them on a request that is about to 422.
    reduced = None
    merged_map: dict[str, list[str]] = {}
    threshold: float | None = None
    if wn.num_nodes > target_nodes:
        reduced, merged_map, threshold = skeletonize_to_target(wn, target_nodes)

    # No auto-derived shedding priority — the importer ships none (best precision;
    # see ImportInpRequest). `priority` stays an expert-set per-node primitive.
    priorities: dict[str, int] = {}

    if reduced is not None:
        wn = reduced
        warnings.append(
            f"Skeletonized {original_nodes} → {wn.num_nodes} nodes "
            f"(pipe-diameter threshold {threshold:.3f} m); demand redistributed."
        )

    # Pipe/valve capacity AND flow direction from a demand-multiplier sweep on
    # THIS (already skeletonized) network — a link's capacity is the HIGHEST
    # velocity it reaches as demand is pushed toward stress, not its velocity
    # at rest (which understates what it could actually deliver); its
    # direction is read off the sweep's own signed flow rather than guessed
    # from topology. Must run on the same topology/diameters build_bundle
    # emits edges for (skeleton merges can change both) and at the SAME
    # demand build_bundle emits, so "capacity vs demand" is an apples-to-
    # apples comparison (see link_flow_profiles' docstring).
    # Skeletonization only removes/merges junctions and redistributes demand
    # onto retained ones — when nothing was skeletonized, `wn` is the exact
    # object `original_demands` was already computed from; recomputing would
    # just redo the same per-junction/pattern scan for no new information.
    demands = original_demands if reduced is None else compute_junction_demands(wn, body.demand_mode)
    flow_profiles = link_flow_profiles(wn, demands, warnings=warnings)

    name = body.filename.rsplit(".", 1)[0] or "Imported network"
    bundle = build_bundle(
        wn,
        name=name,
        # ImportInpRequest IS-A ImportOptions — the knobs are declared once.
        options=body,
        priorities=priorities,
        flow_profiles=flow_profiles,
        merged_map=merged_map,
        warnings=warnings,
    )
    return ImportInpResponse(
        bundle=bundle,
        warnings=warnings,
        original_nodes=original_nodes,
        imported_nodes=len(bundle.project.nodes),
        skeleton_threshold_m=threshold,
    )


@router.post(
    "/inp",
    response_model=ImportInpResponse,
    # Same null-free contract as Server Sync Load (requirements §13.4): the
    # frontend Zod schema rejects explicit nulls on `.optional()` fields.
    response_model_exclude_none=True,
    summary="Convert an EPANET .inp water network to a CASCADE project",
)
async def import_inp(
    body: ImportInpRequest,
    user: AuthUser = Depends(get_current_user),
) -> ImportInpResponse:
    # Node budget: explicit request wins; else the caller's entitlement; else
    # a sensible default for unbounded roles.
    target_nodes = body.target_nodes
    if target_nodes is None:
        ent = user.entitlement
        target_nodes = (
            ent.max_nodes if ent and ent.max_nodes is not None else _DEFAULT_TARGET_NODES
        )

    try:
        return await run_in_threadpool(_run_import, body, target_nodes)
    except (InpParseError, GeoTransformError, SkeletonError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
