"""
db/analysis_log.py — the Analysis Log (ADR-0007): one append-only,
operator-only row per Propagation.

Persistence boundary: config-level vocabulary (category names, graph types,
scale size) may be stored; anything naming or locating a real-world Element
or Entity may not. No node/edge ids or labels, no geo, no outcomes.

Recording is best-effort: a logging failure must never fail the Propagation
the user paid an engine evaluation for. Callers use `record_run` which
swallows and logs exceptions.
"""
from __future__ import annotations

import logging
from typing import Optional

from db import pool as db_pool
from schemas.results import PropagationRequest

logger = logging.getLogger(__name__)

# Reported in the Analysis Log so runs can be compared across engine releases.
ENGINE_VERSION = "1.0.0"


async def record_run(
    request: PropagationRequest,
    *,
    user_db_id: Optional[str],
    role_name: Optional[str],
    compute_time_ms: int,
) -> None:
    """Append one Analysis Log row for a completed Propagation (best-effort)."""
    if not db_pool.is_connected():
        return  # local-only mode — nothing to record into

    project = request.project
    config = request.config
    rule_count = sum(
        len(el.rules or [])
        for el in (*project.nodes.values(), *project.edges.values())
    )
    graph_types = sorted({c.graph.graph_type for c in project.canvases})

    try:
        async with db_pool.get_pool().acquire() as conn:
            await conn.execute(
                """
                INSERT INTO analysis_logs (
                    user_id, role_name, scope,
                    node_count, edge_count, canvas_count,
                    category_names, functionality_scale_n,
                    event_definition_count, rule_count, graph_types,
                    engine_version, compute_time_ms
                )
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                """,
                user_db_id,
                role_name,
                request.scope,
                len(project.nodes),
                len(project.edges),
                len(project.canvases),
                [c.name for c in config.categories],
                len(config.functionality_scale),
                len(config.events),
                rule_count,
                graph_types,
                ENGINE_VERSION,
                compute_time_ms,
            )
    except Exception:
        logger.exception("Analysis Log write failed (run is unaffected).")
