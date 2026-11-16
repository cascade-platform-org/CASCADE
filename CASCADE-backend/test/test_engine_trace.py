"""The Propagation animation's round record (ADR-0027): `trace` observes the run
and never changes it, and replaying its changes reproduces the result."""
import json
from pathlib import Path

import pytest

from engine.propagation import run
from schemas.results import PropagationRequest

SAMPLES = Path(__file__).resolve().parents[2] / "CASCADE-app" / "samples" / "public"
BUNDLES = [
    "flow-power-scarcity", "dependency-guard", "backup-defer",
    "rule-specific", "rule-intracategorical", "rule-intercategorical",
    "Office_with_Heat", "IJDRR_example", "Palmanova_Complete",
]


def _request(name: str, trace: bool) -> PropagationRequest:
    bundle = json.loads((SAMPLES / f"{name}.json").read_text())
    return PropagationRequest(project=bundle["project"], config=bundle["config"], scope="global", trace=trace)


def _comparable(result) -> dict:
    return result.model_dump(exclude={"computed_at", "rounds"}, exclude_none=True)


@pytest.mark.parametrize("name", BUNDLES)
def test_trace_leaves_the_result_unchanged(name: str):
    plain = run(_request(name, trace=False))
    traced = run(_request(name, trace=True))
    assert plain.rounds is None
    assert _comparable(traced) == _comparable(plain)
    assert traced.rounds is not None and len(traced.rounds) == traced.iterations


@pytest.mark.parametrize("name", BUNDLES)
def test_replaying_the_rounds_reproduces_the_result(name: str):
    request = _request(name, trace=True)
    result = run(request)
    level = {nid: n.functionality for nid, n in request.project.nodes.items()}
    level |= {eid: e.functionality for eid, e in request.project.edges.items()}
    ft = {nid: n.functionality_time or 0 for nid, n in request.project.nodes.items()}
    for rnd in result.rounds or []:
        for change in rnd.changes:
            assert change.functionality <= level[change.id], f"{change.id} improved"
            level[change.id] = change.functionality
            if change.functionality_time is not None:
                ft[change.id] = change.functionality_time
    for update in result.updates:
        assert level[update.id] == update.functionality, update.id
        if update.functionality_time is not None:
            assert ft[update.id] == update.functionality_time, update.id
    # The converged round lowers no node: its edges may still take the levels their
    # sources reached the round before (ADR-0004's refresh), and a backup deferral
    # starts a countdown without counting as a change.
    assert result.rounds and all(c.cause in ("edge", "backup") for c in result.rounds[-1].changes)


def _causes(name: str) -> dict[str, str]:
    result = run(_request(name, trace=True))
    return {c.id: c.cause for r in result.rounds or [] for c in r.changes}


def test_causes_name_what_decided_each_change():
    assert _causes("flow-power-scarcity")["dc_a"] == "flow"
    assert _causes("flow-power-scarcity")["control"] == "logical"
    assert _causes("rule-specific")["control"] == "rule"
    assert _causes("backup-defer")["hospital"] == "backup"


def test_flows_route_what_the_round_delivered():
    result = run(_request("flow-power-scarcity", trace=True))
    first = result.rounds[0]
    assert first.flows, "a SourceToDemands category carries flow in round 1"
    # Every routed amount is positive, and the served ratios are those of the solve.
    assert all(v > 0 for per_edge in first.flows.values() for v in per_edge.values())
    assert first.served_ratio["dc_a"]
