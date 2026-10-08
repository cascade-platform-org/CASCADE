"""Generate the Temporal Simulation samples (release v1.1 acceptance, requirements §9.6).

Two bundles under CASCADE-app/samples/public/:

- Net1_temporal.json: EPANET Net1 through the Temporal Simulation importer (one
  tank as storage, filled by the pump and drawn by the town; a day of hourly
  periods with the file's demand pattern), plus the scenario the acceptance
  names: a pump outage at 06:00, the pump restored at 12:00, a demand surge at
  18:00, and a Metric reading the tank's level.
- IJDRR_example.json gains its Timeline: a year of months with staged
  earthquakes, a repair Event and a seasonal demand row.

Run from the backend root:  PYTHONPATH=. python scripts/build_temporal_samples.py
Re-running rewrites both files; the expected run behaviour is asserted in the
frontend sample tests, not encoded here.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from api.import_routes import _run_import
from core.importers.inp.temporal import steps_firing
from schemas.import_inp import ImportInpRequest
from schemas.temporal_simulation import FIRST_SIMULATION_ID, CalendarUnit, StoredTemporalSimulation

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "CASCADE-app" / "samples" / "public"
NET1 = ROOT / "raw-networks" / "aqueducts" / "Net1.inp"
FORMAT = "cascade.temporal-simulation/v1"


def _steps(labels: list[str], unit: CalendarUnit, fires: dict[int, list[str]]) -> list[dict[str, Any]]:
    return [step.model_dump(mode="json") for step in steps_firing(labels, unit, fires)]


def build_net1() -> None:
    result = _run_import(ImportInpRequest(filename="Net1.inp", content=NET1.read_text()), 300, temporal=True)
    bundle = result.bundle.model_dump(mode="json", exclude_none=True)
    project, config = bundle["project"], bundle["config"]
    project["meta"]["name"] = "Net1 — an aqueduct over a day"
    n = max(level["level"] for level in config["functionality_scale"])
    pumps = sorted(nid for nid, node in project["nodes"].items() if (node.get("properties") or {}).get("kind") == "pump")
    config["events"].append({
        "id": "evt-pump-restored",
        "label": "Pumps restored",
        "type": "restorative",
        "icon": "Wrench",
        "frequency_per_10y": 0,
        "temporal_simulation_only": True,
        "attribute_operations": [
            *({"element": p, "path": ["functionality"], "op": "set", "value": n} for p in pumps),
            *({"element": p, "path": ["direct_damage"], "op": "set", "value": False} for p in pumps),
        ],
    })
    simulation = project["temporal_simulations"][0]
    # Level Mode reads a tank's change against one hour of the town's demand, so
    # draining and refilling show up; against its own bound they are under 5%.
    town_hour = sum(op["value"] for op in simulation["profile"]["2023-01-01T00"])
    for node in project["nodes"].values():
        stock = (node.get("supply_capacity") or {}).get("water")
        if isinstance(stock, dict):
            stock["change_reference"] = round(town_hour, 3)
    labels = [f"2023-01-01T{h:02d}" for h in range(24)]
    simulation["timeline"] = {
        "name": "Net1 — a day with a pump outage and an evening surge",
        "steps": _steps(labels, "hour", {6: ["evt-blackout-pump-failure"], 12: ["evt-pump-restored"], 18: ["evt-demand-surge-top10"]}),
    }
    simulation["metrics"] = [{
        "name": "Tank 2 level",
        "target": {"kind": "node", "node_type": "Source", "label_contains": "2"},
        "path": ["supply_capacity", "water", "level"],
        "read": "state",
        "aggregate": "sum",
    }]
    StoredTemporalSimulation.model_validate(simulation)
    (SAMPLES / "Net1_temporal.json").write_text(json.dumps({"project": project, "config": config}, indent=2, ensure_ascii=False) + "\n")


def build_ijdrr() -> None:
    path = SAMPLES / "IJDRR_example.json"
    bundle = json.loads(path.read_text())
    project, config = bundle["project"], bundle["config"]
    source = next(nid for nid, node in project["nodes"].items() if node.get("label") == "Electric Source")
    city = next(nid for nid, node in project["nodes"].items() if node.get("label") == "City")
    quake = next(e["id"] for e in config["events"] if e["type"] == "hazard")
    n = max(level["level"] for level in config["functionality_scale"])
    config["events"] = [e for e in config["events"] if e["id"] != "evt-repair-source"] + [{
        "id": "evt-repair-source",
        "label": "Repair the Electric Source",
        "type": "restorative",
        "icon": "Wrench",
        "frequency_per_10y": 0,
        "temporal_simulation_only": True,
        "attribute_operations": [
            {"element": source, "path": ["functionality"], "op": "set", "value": n},
            {"element": source, "path": ["direct_damage"], "op": "set", "value": False},
        ],
    }]
    labels = [f"2024-{m:02d}" for m in range(1, 13)]
    city_demand = {"2024-01": 6, "2024-04": 5, "2024-06": 6.5, "2024-09": 5, "2024-12": 6}
    project.pop("temporal_simulation", None)
    project["temporal_simulations"] = [{
        "id": FIRST_SIMULATION_ID,
        "format": FORMAT,
        "timeline": {
            "name": "A year: two earthquakes and a repair",
            "steps": _steps(labels, "month", {2: [quake], 5: ["evt-repair-source"], 8: [quake]}),
        },
        "profile": {
            label: [{"element": city, "path": ["category_dependency_profiles", "electric", "demand"], "op": "set", "value": v}]
            for label, v in city_demand.items()
        },
        "metrics": [{
            "name": "Services fully operational",
            "target": {"kind": "node", "node_type": "Service"},
            "path": ["functionality"],
            "read": "state",
            "aggregate": "share_where",
            "value_filter": {"cmp": ">=", "value": n},
        }],
    }]
    StoredTemporalSimulation.model_validate(project["temporal_simulations"][0])
    path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False))  # the file has no trailing newline


if __name__ == "__main__":
    build_net1()
    build_ijdrr()
