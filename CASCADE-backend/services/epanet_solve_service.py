"""
services/epanet_solve_service.py — live EPANET/WNTR solve for a canvas whose
graph_type is "epanet" (see propagation_service.py's dispatch).

Deliberately has NO import from engine/ — services/propagation_service.py
stays the ONE file that does (ADR-0009: a future extraction of the engine
into a private submodule/service is a one-step operation touching only that
seam). This module returns raw served RATIOS, not Functionality levels;
propagation_service.py (which already imports engine.flow._ratio_to_level
for the normal engine path) does the ratio-to-level quantization itself, so
"what CASCADE says" and "what EPANET says" still share the exact same
rounding rule without this module needing an engine import of its own.

Solve logic mirrors scripts/validate_faithfulness.py::_solve_served_ratios —
that function stays a dev/validation harness (with its own Situation dataclass
and required/minimum-pressure sweep flags); this module is the production
counterpart, driven by a live CASCADE Project's current element state instead
of a synthetic Situation.
"""
from __future__ import annotations

import copy
import tempfile
from pathlib import Path
from typing import Any

import wntr

from core.importers.inp.sim import _check_converged
from schemas.network import Project

# Link-bearing element kinds — a degraded one maps directly to closing its
# own .inp link. Node kinds without a direct link (junction/reservoir/tank)
# map to closing every link touching them instead (see
# translate_project_to_broken_links).
_LINK_KINDS = {"pipe", "pump", "valve"}


def solve_epanet_snapshot(
    wn: wntr.network.WaterNetworkModel,
    demands: dict[str, float],
    broken_link_ids: set[str],
    required_pressure_m: float = 20.0,
    minimum_pressure_m: float = 0.0,
) -> dict[str, float]:
    """Junction inp_id -> delivered/expected ratio, from a live PDD solve of
    `wn` with every id in `broken_link_ids` closed. Quantizing this ratio into
    a Functionality level is the caller's job (propagation_service.py) — see
    module docstring for why that split keeps this file engine-import-free.

    `demands` is junction id -> m3/s for the canvas's stored demand_mode
    (Canvas.source_inp_demand_mode) — every junction's demand is fixed to
    this value before solving, exactly as the importer's own sweeps do, so
    the comparison is against the same baseline CASCADE was parameterized
    from, not the .inp file's raw time-varying pattern.

    Returns {} if the solve doesn't converge or produces no result — the
    caller (propagation_service) turns that into a warning, not a crash.
    """
    model = copy.deepcopy(wn)
    # See core/importers/inp/sim.py::_fixed_demand_model's docstring: a
    # Demand entry's pattern_name=None does NOT mean "constant" to WNTR if the
    # .inp file sets a global default pattern — clear it so "fixed" is real.
    hydraulic_options: Any = model.options.hydraulic  # WNTR's stub claims non-Optional str
    hydraulic_options.pattern = None
    for jid, demand in demands.items():
        junction: Any = model.get_node(jid)  # WNTR ships no usable stubs
        junction.demand_timeseries_list.clear()
        junction.demand_timeseries_list.append((demand, None, "epanet_mode_fixed"))

    # Every pump an operator CAN run starts operational, not whatever the
    # .inp file's scheduled t=0 status happens to be — same rationale as
    # validate_faithfulness.py's ground-truth solve: CASCADE's own baseline
    # assumes every pump is available unless explicitly broken.
    for pump_id in wn.pump_name_list:
        pump: Any = model.get_link(pump_id)  # WNTR ships no usable stubs
        pump.initial_status = "Open"
    for link_id in broken_link_ids:
        if link_id in model.link_name_list:
            link: Any = model.get_link(link_id)  # WNTR ships no usable stubs
            link.initial_status = "Closed"

    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = required_pressure_m
    model.options.hydraulic.minimum_pressure = minimum_pressure_m

    with tempfile.TemporaryDirectory(prefix="cascade-epanet-mode-") as tmpdir:
        prefix = str(Path(tmpdir) / "solve")
        try:
            results: Any = wntr.sim.EpanetSimulator(model).run_sim(file_prefix=prefix)
            _check_converged(prefix)
        except Exception:
            return {}
    delivered = results.node["demand"].iloc[0]

    ratios: dict[str, float] = {}
    for jid, expected in demands.items():
        if expected <= 0:
            continue
        got = float(delivered.get(jid, 0.0))
        ratios[jid] = max(0.0, got / expected)
    return ratios


def translate_project_to_broken_links(
    project: Project,
    wn: wntr.network.WaterNetworkModel,
    max_level: int,
) -> tuple[set[str], list[str]]:
    """Read the CURRENT (possibly hand-edited) scoped Project's element
    functionality and derive what a live EPANET solve should treat as broken.

    Rule (CompleNet-adjacent decision, 2026-07-11 — see the epanet-mode ADR):
    EPANET has no notion of a partially degraded pipe or junction, so any
    element below `max_level` is treated as FULLY broken, not scaled —
    binarizing is the only faithful translation, not an approximation of a
    graded one. Specifically:

      - An Edge or Node tagged `properties.kind` in {"pipe","pump","valve"}
        (properties.inp_id is its own .inp link id) below max_level -> that
        link id is closed directly.
      - A Node tagged `properties.kind` in {"junction","reservoir","tank"}
        (a non-link element) below max_level -> every link touching it
        (`wn.get_links_for_node`) is closed instead — the same "take the
        whole node out of service" mechanism
        scripts/validate_faithfulness.py::_tank_situations already
        established for tanks, generalized to any non-link element.
      - Any element below max_level with NO `properties.inp_id` (a
        CASCADE-only addition with no EPANET counterpart) cannot be
        represented in an EPANET solve at all — it is skipped, and a
        human-readable label is returned so the caller can surface it as an
        explicit warning rather than silently ignoring it.

    Returns (broken_link_ids, skipped_labels).
    """
    broken: set[str] = set()
    skipped: list[str] = []

    for eid, edge in project.edges.items():
        if edge.functionality >= max_level:
            continue
        props = edge.properties or {}
        inp_id = props.get("inp_id")
        kind = props.get("kind")
        if inp_id and kind in _LINK_KINDS:
            broken.add(inp_id)
        else:
            skipped.append(f"edge {eid}")

    for nid, node in project.nodes.items():
        if node.functionality >= max_level:
            continue
        props = node.properties or {}
        inp_id = props.get("inp_id")
        kind = props.get("kind")
        if inp_id and kind in _LINK_KINDS:
            broken.add(inp_id)
        elif inp_id and inp_id in wn.node_name_list:
            broken.update(wn.get_links_for_node(inp_id))
        else:
            skipped.append(f"node {node.label or nid}")

    return broken, skipped
