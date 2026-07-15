"""Tests for the "epanet" graph_type propagation path (services/epanet_solve_service.py,
services/propagation_service.py::_run_epanet).

Same small synthetic network as test_inp_import.py (duplicated rather than
imported across test modules — this repo's test/ has no __init__.py package):

      R1 ──pump P1──▶ J1 ──pipe A──▶ J2 (demand)
                       │
      T1 ──pipe B──────┘        J2 ──valve V1──▶ J3 (demand)
"""
from __future__ import annotations

import pytest

from core.importers.inp import ImportOptions, build_bundle, compute_junction_demands, load_inp
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
