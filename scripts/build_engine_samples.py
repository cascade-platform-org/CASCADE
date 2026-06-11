"""Generate the engine sample bundles under CASCADE-app/samples/.

One fixed graph topology, several scenario bundles on top of it. Each bundle is
a full, schema-valid Project + ModelConfiguration that doubles as (a) a loadable
demo in the app and (b) an end-to-end engine test fixture (see
test/test_engine_samples.py). Keeping the topology constant and varying only the
Scenario (input Functionality, demands, profiles, rules, degraded links) makes
every bundle small and hand-verifiable, and makes a regression in any one
mechanism show up as a single failing scenario.

Run from the backend root:  python scripts/build_engine_samples.py

The expected outcomes are NOT encoded here — they live as explicit assertions in
test/test_engine_samples.py, so they can be reviewed against intended behaviour
independently of the data that produces them.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from schemas.network import Project
from schemas.config import ModelConfiguration
from schemas.results import PropagationResult  # resolves Project's forward ref

Project.model_rebuild()

SAMPLES_DIR = Path(__file__).resolve().parents[2] / "CASCADE-app" / "samples"

# N = 4. 1 = critical (worst), 4 = operational (best).
CONFIG: dict[str, Any] = {
    "version": "1",
    "meta": {"name": "Engine Samples Config"},
    "functionality_scale": [
        {"level": 1, "label": "critical", "color": "#dc2626"},
        {"level": 2, "label": "poor", "color": "#f59e0b"},
        {"level": 3, "label": "degraded", "color": "#eab308"},
        {"level": 4, "label": "operational", "color": "#16a34a"},
    ],
    "categories": [
        {"name": "water", "category_type": "SourceToDemands", "color": "#0ea5e9"},
        {"name": "power", "category_type": "SourceToDemands", "color": "#f97316"},
        {"name": "digital", "category_type": "Requisite", "color": "#8b5cf6"},
    ],
    "events": [],
    "graph_types": [
        {"name": "water", "heuristics": []},
        {"name": "power", "heuristics": []},
        {"name": "digital", "heuristics": []},
        {"name": "global", "heuristics": [], "local_graph_types": ["water", "power", "digital"]},
    ],
    "node_defaults": {},
}


def base_nodes() -> dict[str, dict[str, Any]]:
    """The shared topology, all elements healthy (Functionality 4).

    water_src ─┬─▶ hospital ◀── dc_a ──▶ ops ◀── dc_b
               └─▶ office          ├────▶ control
    power_src ───▶ dc_a

    dc_a is the cross-category bridge: it CONSUMES power (a flow category) and is
    a SOURCE of digital (a Requisite category), so a power shortage at dc_a
    cascades into every digital consumer. dc_b is a redundant digital source.
    """
    return {
        "water_src": {
            "id": "water_src", "label": "Water Source", "functionality": 4,
            "node_categories": ["water"], "supply_capacity": {"water": 200},
        },
        "power_src": {
            "id": "power_src", "label": "Power Plant", "functionality": 4,
            "node_categories": ["power"], "supply_capacity": {"power": 200},
        },
        "dc_a": {
            "id": "dc_a", "label": "Datacenter A", "functionality": 4,
            "node_categories": ["power", "digital"],
            "category_dependency_profiles": {
                "power": {"dependency_level": 4, "demand": 50},
            },
        },
        "dc_b": {
            "id": "dc_b", "label": "Datacenter B", "functionality": 4,
            "node_categories": ["digital"],
        },
        "hospital": {
            "id": "hospital", "label": "Hospital", "functionality": 4,
            "node_categories": ["water", "digital"],
            "category_dependency_profiles": {
                "water": {"dependency_level": 4, "demand": 30, "priority": 8},
                "digital": {"dependency_level": 4},
            },
        },
        "office": {
            "id": "office", "label": "Office Park", "functionality": 4,
            "node_categories": ["water"],
            "category_dependency_profiles": {
                "water": {"dependency_level": 4, "demand": 40, "priority": 2},
            },
        },
        "ops": {
            "id": "ops", "label": "Ops Center", "functionality": 4,
            "node_categories": ["digital"],
        },
        "control": {
            "id": "control", "label": "Control Room", "functionality": 4,
            "node_categories": ["digital"],
        },
    }


def base_edges() -> dict[str, dict[str, Any]]:
    def e(eid: str, src: str, tgt: str) -> dict[str, Any]:
        return {"id": eid, "source": src, "target": tgt, "functionality": 4}

    edges = [
        e("e_w_hosp", "water_src", "hospital"),
        e("e_w_off", "water_src", "office"),
        e("e_p_dc", "power_src", "dc_a"),
        e("e_da_hosp", "dc_a", "hospital"),
        e("e_da_ops", "dc_a", "ops"),
        e("e_db_ops", "dc_b", "ops"),
        e("e_da_ctrl", "dc_a", "control"),
    ]
    return {x["id"]: x for x in edges}


def assemble(nodes: dict, edges: dict) -> dict[str, Any]:
    """Wrap a node/edge registry into a one-canvas global Project bundle."""
    project = {
        "version": "2.0",
        "meta": {"name": "Engine Sample"},
        "global_graph_type": "global",
        "nodes": nodes,
        "edges": edges,
        "canvases": [{
            "id": "main", "label": "City", "color": "#3b82f6",
            "graph": {
                "graph_type": "global",
                "node_ids": list(nodes), "edge_ids": list(edges),
            },
        }],
        "update_history": [],
        "scorecard": [],
    }
    return {"project": project, "config": CONFIG}


# --- scenario mutators ------------------------------------------------------
# Each takes the healthy base and applies a single Scenario. The expected
# outcomes are asserted in test/test_engine_samples.py, not here.


def power_scarcity(nodes: dict, edges: dict) -> None:
    """power_src supplies 40 against dc_a's demand of 80 → dc_a served at 0.5."""
    nodes["power_src"]["supply_capacity"] = {"power": 40}
    nodes["dc_a"]["category_dependency_profiles"]["power"]["demand"] = 80


def scenario_flow_power_scarcity() -> dict[str, Any]:
    nodes, edges = base_nodes(), base_edges()
    power_scarcity(nodes, edges)
    return assemble(nodes, edges)


def scenario_dependency_guard() -> dict[str, Any]:
    nodes, edges = base_nodes(), base_edges()
    # Tight water: hospital (priority 8) is fully served; office (priority 2) is
    # starved to critical, but its dependency_level 2 softens the drop.
    nodes["water_src"]["supply_capacity"] = {"water": 30}
    nodes["office"]["category_dependency_profiles"]["water"]["dependency_level"] = 2
    return assemble(nodes, edges)


def scenario_backup_defer() -> dict[str, Any]:
    nodes, edges = base_nodes(), base_edges()
    # The hospital's digital feed link is failed, but the hospital holds a backup
    # reserve: it stays operational and starts a countdown instead of dropping.
    edges["e_da_hosp"]["functionality"] = 1
    nodes["hospital"]["category_dependency_profiles"]["digital"].update(
        {"backup": True, "backup_duration": 24}
    )
    return assemble(nodes, edges)


def scenario_specific_rule() -> dict[str, Any]:
    nodes, edges = base_nodes(), base_edges()
    power_scarcity(nodes, edges)  # dc_a → 2 (poor)
    # A specific rule forces control critical under a boolean condition; blame is
    # split evenly across the two elements named in the condition.
    nodes["control"]["rules"] = [
        "if dc_a is poor and water_src is operational then control is critical"
    ]
    return assemble(nodes, edges)


def scenario_intracategorical_rule() -> dict[str, Any]:
    nodes, edges = base_nodes(), base_edges()
    power_scarcity(nodes, edges)  # dc_a → 2, dc_b stays 4
    # ops has two redundant digital suppliers (dc_a, dc_b). Default best_of keeps
    # it at 4; worst_of makes it follow its worst supplier instead.
    nodes["ops"]["rules"] = ["worst_of(dc_a, dc_b) propagates to ops"]
    return assemble(nodes, edges)


def scenario_intercategorical_rule() -> dict[str, Any]:
    nodes, edges = base_nodes(), base_edges()
    power_scarcity(nodes, edges)  # digital (via dc_a) → 2, water stays 4
    # The hospital runs on the AVERAGE of its categories rather than collapsing to
    # the worst: average_of(water=4, digital=2) = 3 instead of worst_of = 2.
    nodes["hospital"]["rules"] = ["average_of(water, digital) propagates to hospital"]
    return assemble(nodes, edges)


SCENARIOS = {
    "flow-power-scarcity": scenario_flow_power_scarcity,
    "dependency-guard": scenario_dependency_guard,
    "backup-defer": scenario_backup_defer,
    "rule-specific": scenario_specific_rule,
    "rule-intracategorical": scenario_intracategorical_rule,
    "rule-intercategorical": scenario_intercategorical_rule,
}


def main() -> None:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    for name, build in SCENARIOS.items():
        bundle = build()
        # Validate against the schema before writing — a bundle that can't load is
        # never emitted.
        Project.model_validate(bundle["project"])
        ModelConfiguration.model_validate(bundle["config"])
        path = SAMPLES_DIR / f"{name}.json"
        path.write_text(json.dumps(bundle, indent=2) + "\n")
        print(f"wrote {path.relative_to(SAMPLES_DIR.parents[1])}")


if __name__ == "__main__":
    main()
