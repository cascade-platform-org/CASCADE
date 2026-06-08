"""
api/propagation_routes.py

POST /api/propagate          — run the propagation engine
GET  /api/engine/algorithms  — return engine capability metadata (graph types + heuristics)
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, status

from auth.dependencies import get_current_user, require_permission
from schemas.auth import AuthUser
from schemas.engine import EngineAlgorithms, GraphTypeMeta, HeuristicMeta, HeuristicParamMeta
from schemas.results import PropagationRequest, PropagationResult
from services.propagation_service import propagate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["propagation"])

# ---------------------------------------------------------------------------
# Engine algorithm metadata
# A static snapshot of what the engine supports — used by the Config modal
# Tab 4 to render the algorithm pipeline editor.
# ---------------------------------------------------------------------------

_ENGINE_ALGORITHMS = EngineAlgorithms(
    graph_types=[
        GraphTypeMeta(
            name="water",
            label="Water network",
            description="Max-flow distribution for water supply systems.",
            default_heuristics=["source-to-demands-flow", "requisite-pessimistic"],
        ),
        GraphTypeMeta(
            name="power",
            label="Electricity network",
            description="Max-flow distribution for electrical power grids.",
            default_heuristics=["source-to-demands-flow"],
        ),
        GraphTypeMeta(
            name="ict",
            label="ICT network",
            description="Requisite dependency logic for ICT infrastructure.",
            default_heuristics=["requisite-pessimistic"],
        ),
        GraphTypeMeta(
            name="transport",
            label="Transport network",
            description="Flow-based model for road and rail transport.",
            default_heuristics=["source-to-demands-flow"],
        ),
        GraphTypeMeta(
            name="generic",
            label="Generic network",
            description="General-purpose graph — pick heuristics manually.",
            default_heuristics=[],
        ),
    ],
    heuristics=[
        HeuristicMeta(
            id="source-to-demands-flow",
            label="Source-to-Demands Flow",
            description=(
                "Max-flow allocation from source nodes to demand nodes, "
                "prioritised by node `priority` attribute. "
                "Sets node Functionality from the delivered/demand ratio "
                "adjusted by `dependency_level`."
            ),
            applicable_graph_types=[],   # unrestricted
            default_enabled=True,
            params=[
                HeuristicParamMeta(
                    name="convergence_tolerance",
                    label="Convergence tolerance",
                    description="Stop iterating when no Functionality changes by more than this value.",
                    type="number",
                    default=1e-6,
                    minimum=0.0,
                    maximum=1.0,
                ),
                HeuristicParamMeta(
                    name="max_iterations",
                    label="Max iterations",
                    description="Hard cap on the number of alternating capacity/rule steps.",
                    type="integer",
                    default=100,
                    minimum=1,
                    maximum=10000,
                ),
            ],
        ),
        HeuristicMeta(
            id="requisite-pessimistic",
            label="Requisite (pessimistic)",
            description=(
                "Threshold-based dependency: a node's Functionality is degraded "
                "when any required upstream falls below the threshold. "
                "Intra-category: best-of redundancy. Inter-category: worst-of."
            ),
            applicable_graph_types=[],
            default_enabled=True,
            params=[
                HeuristicParamMeta(
                    name="threshold_level",
                    label="Threshold level",
                    description="Upstream Functionality must be >= this level to satisfy the dependency.",
                    type="integer",
                    default=2,
                    minimum=1,
                ),
            ],
        ),
        HeuristicMeta(
            id="rule-evaluator",
            label="Rule evaluator",
            description=(
                "Evaluates Specific, Intracategorical, and Intercategorical rules "
                "attached to nodes and edges. Run after category heuristics."
            ),
            applicable_graph_types=[],
            default_enabled=True,
            params=[],
        ),
    ],
)


@router.get(
    "/engine/algorithms",
    response_model=EngineAlgorithms,
    summary="Engine algorithm metadata",
    description=(
        "Returns a read-only snapshot of the graph types and heuristic algorithms "
        "the engine supports. Used by the Config modal to populate the algorithm "
        "pipeline editor. Requires viewer role."
    ),
)
async def get_engine_algorithms(
    user: AuthUser = Depends(get_current_user),
) -> EngineAlgorithms:
    return _ENGINE_ALGORITHMS


@router.post(
    "/propagate",
    response_model=PropagationResult,
    response_model_exclude_none=True,
    summary="Run propagation",
    description=(
        "Accepts a PropagationRequest (project + config + scope) and returns "
        "a PropagationResult. Requires can_propagate permission."
    ),
)
async def run_propagation(
    body: PropagationRequest,
    user: AuthUser = Depends(require_permission("can_propagate")),
) -> PropagationResult:
    t0 = time.perf_counter()
    try:
        result = await propagate(body)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Propagation failed for user %s: %s", user.email, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Propagation engine error. See server logs.",
        ) from exc

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "Propagate user=%s scope=%s updates=%d warnings=%d elapsed_ms=%d",
        user.email,
        result.scope,
        len(result.updates),
        len(result.warnings),
        elapsed_ms,
    )
    return result
