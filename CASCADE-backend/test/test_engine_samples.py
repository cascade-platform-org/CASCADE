"""End-to-end engine tests over the shipped sample bundles in CASCADE-app/samples/.

One fixed graph topology (see scripts/build_engine_samples.py); each bundle is a
different Scenario on it that isolates one engine mechanism. The expected
outcomes below are authored by hand to capture *intended* behaviour — the engine
must reproduce them. A regression in any one mechanism fails exactly one
scenario, pointing straight at the cause.

Regenerate the bundles with:  python scripts/build_engine_samples.py

Each expectation is `node_id -> (functionality, functionality_time, responsibility_share)`.
Only NODES are asserted (edge Functionality is the derived worst_of(intrinsic,
source) and is checked implicitly via the node cascade). A node not listed must
NOT change — the test fails on any spurious or missing node degradation.
"""
import json
from pathlib import Path

import pytest

from engine.propagation import run
from schemas.results import PropagationRequest

SAMPLES = Path(__file__).resolve().parents[2] / "CASCADE-app" / "samples"

# functionality, functionality_time, responsibility_share
Expect = dict[str, tuple[int, int | None, dict[str, float] | None]]

EXPECTED: dict[str, Expect] = {
    # Power scarcity: power_src supplies 40 against dc_a's demand 80 → dc_a served
    # at ratio 0.5 → level 2. dc_a is the digital source, so the drop cascades to
    # every digital consumer fed directly by it. ops is spared because its other
    # supplier (dc_b) is healthy and the default intracategorical operator is
    # best_of (one healthy supplier suffices). office is untouched: water is
    # plentiful here.
    "flow-power-scarcity": {
        "dc_a": (2, None, None),
        "hospital": (2, None, {"dc_a": 1.0}),     # worst_of(water=4, digital=2)
        "control": (2, None, {"dc_a": 1.0}),
    },
    # Tight water (supply 30): hospital (priority 8) is fully served; office
    # (priority 2) is starved to critical (level 1). office's dependency_level 2
    # is a guard that softens the drop by N − dep = 4 − 2 = 2 levels → 1 + 2 = 3.
    "dependency-guard": {
        "office": (3, None, None),
    },
    # The hospital's digital feed link is failed (level 1), which would drag the
    # hospital to critical — but its backup reserve defers the drop: the hospital
    # holds at 4 and starts a 24-hour countdown (functionality_time) instead.
    "backup-defer": {
        "hospital": (4, 24, None),
    },
    # Same power scarcity as above, plus a specific rule on control:
    #   "if dc_a is poor and water_src is operational then control is critical"
    # The boolean condition holds (dc_a = 2 = poor, water_src = 4 = operational),
    # so control is forced to critical (1) — worse than the 2 it would inherit
    # from dc_a. Blame is split evenly across the two elements the condition names.
    "rule-specific": {
        "dc_a": (2, None, None),
        "hospital": (2, None, {"dc_a": 1.0}),
        "control": (1, None, {"dc_a": 0.5, "water_src": 0.5}),
    },
    # Same power scarcity, plus an intracategorical rule on ops:
    #   "worst_of(dc_a, dc_b) propagates to ops"
    # This replaces the default best_of for ops's digital suppliers, so ops now
    # follows its WORST supplier (dc_a = 2) instead of riding dc_b = 4.
    "rule-intracategorical": {
        "dc_a": (2, None, None),
        "hospital": (2, None, {"dc_a": 1.0}),
        "control": (2, None, {"dc_a": 1.0}),
        "ops": (2, None, {"dc_a": 1.0}),
    },
    # Same power scarcity, plus an intercategorical rule on hospital:
    #   "average_of(water, digital) propagates to hospital"
    # The hospital composes its categories by average instead of worst_of:
    # average_of(water = 4, digital = 2) = floor(3.0) = 3, instead of worst_of = 2.
    "rule-intercategorical": {
        "dc_a": (2, None, None),
        "hospital": (3, None, {"dc_a": 1.0}),
        "control": (2, None, {"dc_a": 1.0}),
    },
}


def _load(name: str) -> PropagationRequest:
    bundle = json.loads((SAMPLES / f"{name}.json").read_text())
    return PropagationRequest(project=bundle["project"], config=bundle["config"], scope="global")


def _node_ids(request: PropagationRequest) -> set[str]:
    return set(request.project.nodes)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_sample_matches_expected_outcome(name: str):
    request = _load(name)
    node_ids = _node_ids(request)
    res = run(request)

    # No mechanism in these bundles produces a parse warning or fails to settle.
    assert res.warnings == [], f"{name}: unexpected warnings {res.warnings}"

    expected = EXPECTED[name]
    node_updates = {u.id: u for u in res.updates if u.id in node_ids}

    # Exactly the expected set of nodes changed — no spurious or missing drops.
    assert set(node_updates) == set(expected), (
        f"{name}: changed nodes {sorted(node_updates)} != expected {sorted(expected)}"
    )

    for nid, (func, ft, resp) in expected.items():
        update = node_updates[nid]
        assert update.functionality == func, f"{name}:{nid} functionality"
        assert update.functionality_time == ft, f"{name}:{nid} functionality_time"
        assert (update.responsibility_share or None) == resp, f"{name}:{nid} responsibility_share"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_sample_is_monotone(name: str):
    """Every emitted Functionality is no better than the element's input level
    (the engine is pessimistic-monotone — it can only worsen)."""
    request = _load(name)
    nodes = request.project.nodes
    edges = {e.id: e for e in request.project.edges.values()}
    res = run(request)
    for u in res.updates:
        before = nodes[u.id].functionality if u.id in nodes else edges[u.id].functionality
        assert u.functionality <= before, f"{name}:{u.id} improved {before} -> {u.functionality}"
