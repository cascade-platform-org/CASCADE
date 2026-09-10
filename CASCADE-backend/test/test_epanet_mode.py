"""Tests for the "epanet" graph_type propagation path (services/epanet_solve_service.py,
services/propagation_service.py::_run_epanet).

Same small synthetic network as test_inp_import.py (duplicated rather than
imported across test modules — this repo's test/ has no __init__.py package):

      R1 ──pump P1──▶ J1 ──pipe A──▶ J2 (demand)
                       │
      T1 ──pipe B──────┘        J2 ──valve V1──▶ J3 (demand)
"""
from __future__ import annotations

import asyncio

import pytest

from core.importers.inp import ImportOptions, build_bundle, compute_junction_demands, load_inp
from engine.flow import _ratio_to_level
from schemas.results import PropagationRequest
from services import propagation_service
from services.epanet_solve_service import solve_epanet_snapshot, translate_project_to_broken_links

_MAX_LEVEL = 3  # matches ImportOptions default n_levels

SYNTHETIC_INP = """
[TITLE]
Synthetic import test net

[JUNCTIONS]
;ID   Elev   Demand  Pattern
 J1   100    0
 J2   95     10      pat1
 J3   90     5

[RESERVOIRS]
;ID   Head
 R1   200

[TANKS]
;ID  Elevation InitLevel MinLevel MaxLevel Diameter MinVol VolCurve
 T1  150       5         0        10       10       0

[PIPES]
;ID  Node1 Node2 Length Diameter Roughness MinorLoss Status
 A   J1    J2    1000   300      100       0         Open
 B   T1    J1    500    200      100       0         Open

[PUMPS]
;ID  Node1 Node2 Parameters
 P1  R1    J1    HEAD curve1

[VALVES]
;ID  Node1 Node2 Diameter Type Setting MinorLoss
 V1  J2    J3    150      PRV  50      0

[PATTERNS]
 pat1  1.0  2.0  0.5

[CURVES]
 curve1  30  80

[COORDINATES]
 J1  100  100
 J2  200  100
 J3  300  100
 R1  0    100
 T1  100  200

[OPTIONS]
 Units  LPS

[END]
"""


@pytest.fixture()
def wn_and_bundle():
    wn = load_inp(SYNTHETIC_INP)
    bundle = build_bundle(wn, name="synthetic", options=ImportOptions(n_levels=_MAX_LEVEL))
    return wn, bundle


# --- translate_project_to_broken_links --------------------------------------

def test_degraded_pipe_maps_to_its_own_link_id(wn_and_bundle):
    wn, bundle = wn_and_bundle
    project = bundle.project
    # Pipe A is imported as an edge with properties.kind == "pipe", properties.inp_id == "A"
    edge_id = next(
        eid for eid, e in project.edges.items()
        if (e.properties or {}).get("inp_id") == "A"
    )
    project.edges[edge_id].functionality = 1  # degrade it below max

    broken, skipped = translate_project_to_broken_links(project, wn, _MAX_LEVEL)
    assert "A" in broken
    assert skipped == []


def test_degraded_junction_closes_every_touching_link(wn_and_bundle):
    wn, bundle = wn_and_bundle
    project = bundle.project
    project.nodes["J1"].functionality = 1  # J1 touches pump P1, pipe A, pipe B

    broken, skipped = translate_project_to_broken_links(project, wn, _MAX_LEVEL)
    touching = set(wn.get_links_for_node("J1"))
    assert touching <= broken
    assert skipped == []


def test_degraded_element_without_inp_id_is_skipped_not_silently_ignored(wn_and_bundle):
    wn, bundle = wn_and_bundle
    project = bundle.project
    # A CASCADE-only addition: no properties.inp_id at all.
    from schemas.network import Node
    project.nodes["cascade_only"] = Node(id="cascade_only", functionality=1, properties={})

    broken, skipped = translate_project_to_broken_links(project, wn, _MAX_LEVEL)
    assert any("cascade_only" in label for label in skipped)


def test_healthy_elements_produce_no_broken_links(wn_and_bundle):
    wn, bundle = wn_and_bundle
    project = bundle.project
    broken, skipped = translate_project_to_broken_links(project, wn, _MAX_LEVEL)
    assert broken == set()
    assert skipped == []


# --- solve_epanet_snapshot ---------------------------------------------------

def test_solve_epanet_snapshot_no_break_fully_serves_demand():
    wn = load_inp(SYNTHETIC_INP)
    demands = compute_junction_demands(wn, "peak")
    ratios = solve_epanet_snapshot(wn, demands, broken_link_ids=set())
    # J2 and J3 carry demand in the synthetic fixture; both should be ~fully served.
    assert ratios["J2"] == pytest.approx(1.0, abs=0.05)
    assert ratios["J3"] == pytest.approx(1.0, abs=0.05)


def test_solve_epanet_snapshot_closing_only_source_path_cuts_service():
    wn = load_inp(SYNTHETIC_INP)
    demands = compute_junction_demands(wn, "peak")
    # Close both links feeding J1 (pump P1 and pipe B) -- the only paths into
    # the rest of the network from either source.
    ratios = solve_epanet_snapshot(wn, demands, broken_link_ids={"P1", "B"})
    assert ratios.get("J2", 0.0) < 0.5
    assert ratios.get("J3", 0.0) < 0.5


# --- ADR-0013 fair-comparison invariant --------------------------------------
#
# The whole point of EPANET mode is comparing "what CASCADE says" against "what
# EPANET says" for the same intervention. That is only a fair comparison if both
# paths turn a served ratio into a Functionality level with the SAME rule. ADR-0013
# puts that rule in ONE place — `engine.flow._ratio_to_level`, applied by
# propagation_service.py — precisely so epanet_solve_service.py can stay
# engine-import-free (ADR-0009) while still agreeing with the flow heuristic.
#
# Until these tests existed the invariant was a comment. A second, "obvious"
# rounding rule (round() instead of ceil(), or a 0-based floor) introduced here
# would have made every published CASCADE-vs-EPANET number measure quantization
# drift instead of hydraulics, and nothing would have failed.


def test_epanet_solve_returns_ratios_not_levels():
    """The split ADR-0013 depends on: this service quantizes nothing."""
    wn = load_inp(SYNTHETIC_INP)
    demands = compute_junction_demands(wn, "peak")
    ratios = solve_epanet_snapshot(wn, demands, broken_link_ids={"A"})

    assert ratios, "expected a converged solve to report at least one junction"
    for jid, ratio in ratios.items():
        assert isinstance(ratio, float), f"{jid} is not a ratio"
        assert 0.0 <= ratio <= 1.0 + 1e-9, f"{jid}={ratio} is outside [0, 1]"
        # An integer level would land on exactly 1.0/2.0/3.0; a ratio that
        # happens to be 1.0 is fine, but 2.0 or 3.0 is a level leaking through.
        assert ratio <= 1.0 + 1e-9


@pytest.mark.parametrize(
    "ratios",
    [
        {"J2": 0.0, "J3": 1.0},              # the ends
        {"J2": 0.01, "J3": 0.99},            # just inside them
        {"J2": 1 / 3, "J3": 2 / 3},          # exactly on the level boundaries
        {"J2": 0.3333, "J3": 0.6667},        # just past them
    ],
)
def test_epanet_levels_use_the_engines_own_quantization(monkeypatch, ratios):
    """Every EPANET-mode level equals what the flow heuristic would have produced.

    The case that bites is `ratios3`: at a served ratio of 0.6667 with N=3,
    `ceil(0.6667 * 3) = ceil(2.0001) = 3` while `round(2.0001) = 2`. Swap the
    engine's rule for the obvious-looking `round` and only that one fails —
    which is exactly why the set spans both sides of each level boundary rather
    than sampling the middle of each band.
    """
    wn = load_inp(SYNTHETIC_INP)
    bundle = build_bundle(wn, name="synthetic", options=ImportOptions(n_levels=_MAX_LEVEL))
    project, config = bundle.project, bundle.config

    canvas = project.canvases[0]
    canvas.graph.graph_type = "epanet"
    canvas.source_inp_content = SYNTHETIC_INP

    monkeypatch.setattr(propagation_service, "solve_epanet_snapshot", lambda *a, **k: ratios)

    request = PropagationRequest(project=project, config=config, scope="local",
                                 active_canvas_id=canvas.id)
    result = asyncio.run(propagation_service.propagate(request))

    n_levels = len(config.functionality_scale)
    by_inp_id = {
        (node.properties or {}).get("inp_id"): nid
        for nid, node in project.nodes.items()
        if (node.properties or {}).get("inp_id")
    }
    levels = {u.id: u.functionality for u in result.updates}

    assert levels, "expected the EPANET path to report updates"
    for jid, ratio in ratios.items():
        assert levels[by_inp_id[jid]] == _ratio_to_level(ratio, n_levels)
