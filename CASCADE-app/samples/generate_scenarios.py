#!/usr/bin/env python3
"""
Generate all scenario JSON files for the CASCADE Palmanova case study.

Produces:
  scenario_earthquake_impact.json           – direct seismic effects
  scenario_earthquake_propagated.json       – after full propagation
  scenario_flood_impact.json                – direct flood effects
  scenario_flood_propagated.json            – after full propagation (= pre-repair baseline)
  scenario_digital_attack_impact.json       – direct cyber effects
  scenario_digital_attack_propagated.json   – after full propagation
  scenario_flood_postrepair_propagated.json – flood with joint_est_water reinforced
  scenario_jalmicco_bridge_eq_propagated.json – earthquake with Jalmicco bridge saved
  scenario_water_flow_control_propagated.json – digital attack + flow priority control
"""
from __future__ import annotations

import copy, json, sys
from pathlib import Path

import requests

BASE_JSON = Path(__file__).parent / "Updated_Palmanova_New.json"
OUT_DIR = Path(__file__).parent
API_URL = "http://localhost:8000"

# ---------------------------------------------------------------------------
# Node / edge IDs (from Updated_Palmanova_New.json)
# ---------------------------------------------------------------------------

JOINT_EST_WATER = "node_1764756534931_2"
JALMICCO_TRANSPORT = "node_1764756451988"
HOSPITAL = "node_1764760763435"
CIVIL_PROTECTION = "node_1772615442881"
PALMANOVA_CITY = "node_1764760888903"

# Flood-vulnerable edges whose vulnerability is removed post-repair
FLOOD_EDGES_POSTREPAIR = [
    "edge_node_1764756534931_2__node_1764758863910_1_5",  # Joint est water → San Marco water
    "edge_node_1764758863910_1__node_1764756534931_2_4",  # San Marco water → Joint est water
    "edge_node_1764758863910_1__node_1764756777009_2_3",  # San Marco water → Industrial water
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_base() -> dict:
    with open(BASE_JSON) as f:
        return json.load(f)


def save(data: dict, name: str) -> Path:
    out = OUT_DIR / f"{name}.json"
    with open(out, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  saved → {out.name}")
    return out


def max_func_level(cfg: dict) -> int:
    return max(s["level"] for s in cfg["functionality_scale"])


def apply_event(data: dict, event_id: str) -> dict:
    """Return a deep copy with direct hazard effects applied (no propagation)."""
    d = copy.deepcopy(data)
    proj, cfg = d["project"], d["config"]
    N = max_func_level(cfg)

    def vuln_to_func(v: int) -> int:
        return max(1, N - v)

    for node in proj["nodes"].values():
        v = node.get("vulnerability_levels", {}).get(event_id, 0)
        if v > 0:
            node["functionality"] = vuln_to_func(v)
            if v >= 2:
                node["direct_damage"] = True

    for edge in proj["edges"].values():
        v = edge.get("vulnerability_levels", {}).get(event_id, 0)
        if v > 0:
            edge["functionality"] = vuln_to_func(v)

    return d


def propagate(data: dict) -> dict:
    """Call the backend engine with global scope and apply all updates."""
    d = copy.deepcopy(data)
    proj, cfg = d["project"], d["config"]

    payload = {"project": proj, "config": cfg, "scope": "global"}
    resp = requests.post(f"{API_URL}/api/propagate", json=payload, timeout=60)
    resp.raise_for_status()
    result = resp.json()

    for upd in result.get("updates", []):
        uid = upd["id"]
        target = proj["nodes"].get(uid) or proj["edges"].get(uid)
        if not target:
            continue
        target["functionality"] = upd["functionality"]
        if upd.get("functionality_time") is not None:
            target["functionality_time"] = upd["functionality_time"]
        if upd.get("direct_damage") is not None:
            target["direct_damage"] = upd["direct_damage"]

    print(f"    propagated ({len(result.get('updates', []))} updates, "
          f"{result.get('iterations', 0)} iterations)")
    return d


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Loading base JSON: {BASE_JSON.name}")
    base = load_base()

    # ------------------------------------------------------------------
    # Scenario A – Strong Earthquake
    # ------------------------------------------------------------------
    print("\nScenario A: Strong Earthquake")
    eq_impact = apply_event(base, "strong_earthquake")
    eq_impact["project"]["meta"]["name"] = "Scenario_A_Impact"
    save(eq_impact, "scenario_earthquake_impact")

    eq_prop = propagate(eq_impact)
    eq_prop["project"]["meta"]["name"] = "Scenario_A_Propagated"
    save(eq_prop, "scenario_earthquake_propagated")

    # ------------------------------------------------------------------
    # Scenario B – Flood
    # ------------------------------------------------------------------
    print("\nScenario B: Flood")
    flood_impact = apply_event(base, "flood")
    flood_impact["project"]["meta"]["name"] = "Scenario_B_Impact"
    save(flood_impact, "scenario_flood_impact")

    flood_prop = propagate(flood_impact)
    flood_prop["project"]["meta"]["name"] = "Scenario_B_Propagated"
    save(flood_prop, "scenario_flood_propagated")

    # ------------------------------------------------------------------
    # Scenario C – Digital Attack
    # ------------------------------------------------------------------
    print("\nScenario C: Digital Attack")
    da_impact = apply_event(base, "digital_attack")
    da_impact["project"]["meta"]["name"] = "Scenario_C_Impact"
    save(da_impact, "scenario_digital_attack_impact")

    da_prop = propagate(da_impact)
    da_prop["project"]["meta"]["name"] = "Scenario_C_Propagated"
    save(da_prop, "scenario_digital_attack_propagated")

    # ------------------------------------------------------------------
    # Strategic Update 1 – Post-repair aqueduct (Flood)
    # Remove Joint est water flood vulnerability and reinforce affected edges
    # so that the redundant Palmanova path becomes effective.
    # ------------------------------------------------------------------
    print("\nStrategic Update 1: Post-repair aqueduct (flood scenario)")
    base_repaired = copy.deepcopy(base)

    # Remove Joint est water direct flood vulnerability
    base_repaired["project"]["nodes"][JOINT_EST_WATER] \
        .get("vulnerability_levels", {}).pop("flood", None)

    # Remove flood vulnerability from the three affected pipe edges
    for eid in FLOOD_EDGES_POSTREPAIR:
        edge = base_repaired["project"]["edges"].get(eid)
        if edge:
            edge.get("vulnerability_levels", {}).pop("flood", None)

    flood_postrepair_impact = apply_event(base_repaired, "flood")
    flood_postrepair_impact["project"]["meta"]["name"] = "Strategic_PostRepair_Impact"
    save(flood_postrepair_impact, "scenario_flood_postrepair_impact")

    flood_postrepair_prop = propagate(flood_postrepair_impact)
    flood_postrepair_prop["project"]["meta"]["name"] = "Strategic_PostRepair_Propagated"
    save(flood_postrepair_prop, "scenario_flood_postrepair_propagated")

    # ------------------------------------------------------------------
    # Strategic Update 2 – Save Jalmicco bridge (Earthquake)
    # Remove the seismic vulnerability of Jalmicco transport and add a
    # specific guard rule that keeps it operational when reinforced.
    # ------------------------------------------------------------------
    print("\nStrategic Update 2: Save Jalmicco bridge (earthquake scenario)")
    base_jalmicco = copy.deepcopy(base)
    jt = base_jalmicco["project"]["nodes"][JALMICCO_TRANSPORT]

    jt.get("vulnerability_levels", {}).pop("strong_earthquake", None)

    eq_bridge_impact = apply_event(base_jalmicco, "strong_earthquake")
    eq_bridge_impact["project"]["meta"]["name"] = "Strategic_JalmiccoB_Impact"
    save(eq_bridge_impact, "scenario_jalmicco_bridge_eq_impact")

    eq_bridge_prop = propagate(eq_bridge_impact)
    eq_bridge_prop["project"]["meta"]["name"] = "Strategic_JalmiccoB_Propagated"
    save(eq_bridge_prop, "scenario_jalmicco_bridge_eq_propagated")

    # ------------------------------------------------------------------
    # Strategic Update 3 – Water flow control (Digital Attack)
    # Set differentiated flow priorities (Hospital=10, CivProt=9, Palmanova=8)
    # so the engine allocates available water to critical services first when
    # Fauglis water Source is at operational_warning.
    # ------------------------------------------------------------------
    print("\nStrategic Update 3: Water flow control (digital attack scenario)")
    base_flowctrl = copy.deepcopy(base)
    nodes = base_flowctrl["project"]["nodes"]

    nodes[HOSPITAL]["category_dependency_profiles"]["water"]["priority"] = 10
    nodes[CIVIL_PROTECTION].setdefault("category_dependency_profiles", {}) \
        .setdefault("water", {})["priority"] = 9
    nodes[PALMANOVA_CITY]["category_dependency_profiles"]["water"]["priority"] = 8

    da_flowctrl_impact = apply_event(base_flowctrl, "digital_attack")
    da_flowctrl_impact["project"]["meta"]["name"] = "Strategic_WaterFlowCtrl_Impact"
    save(da_flowctrl_impact, "scenario_water_flow_control_impact")

    da_flowctrl_prop = propagate(da_flowctrl_impact)
    da_flowctrl_prop["project"]["meta"]["name"] = "Strategic_WaterFlowCtrl_Propagated"
    save(da_flowctrl_prop, "scenario_water_flow_control_propagated")

    print("\n✓ All scenario JSONs generated.")


if __name__ == "__main__":
    main()
