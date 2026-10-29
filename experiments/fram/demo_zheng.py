"""
D — demonstration: Zheng 2024 with the earthquake's physical damage modelled.

The FRAM canvas is the v2 translation of Table 1 (TRANSLATION.md, v2). Three
physical canvases replace the background resources the paper names as damaged:
  * telecom: radio repeater and telephone exchange (category voice) and a fibre
    link (data) feed *Radio/Telephone* (best of voice) and *Internet/Telephone*
    (best of data or voice), Requisite;
  * firefighter crews, SourceToDemands: the brigade's crews serve F17 and the
    other earthquake-affected areas, which are served first;
  * fire water, SourceToDemands: pump station -> main -> hydrant ring -> F20
    (foam) and the cooling of Tank 63; firetruck tanks are a small second source.
Quantities (crews, m3/h, repair hours) are illustrative: the paper gives none.
Physical flows have dependency_level N (a shortfall is a shortfall); FRAM
couplings keep v2's one-level damping.

The Temporal Simulation is written into the bundle for the app. The harness
mirrors its semantics (each period: imposed state from the Events so far, then
one Propagation) to report the numbers.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/demo_zheng.py
"""
from __future__ import annotations

import csv
import itertools
import json
import math
from dataclasses import replace
from pathlib import Path

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.translate import Translated, resonance_config, translate
from schemas.config import CategoryDefinition, EventDefinition, ModelConfiguration
from schemas.network import Canvas, CategoryDependencyProfile, Edge, Graph, Node, Position, Project

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
DEMO = readers.REPO / "CASCADE-app" / "samples" / "public" / "fram"  # Zheng is CC BY
N = 4
RADIO, NET = "X:Radio/Telephone", "X:Internet/Telephone"
FIRE_KIT = "X:Firetruck; firefighter; PPE, SCBAS, etc."
START = "2024-05-01T"   # hour labels of the Temporal Simulation

# Events: id -> (label, operations). An operation is (element, path, value), op "set".
EVENTS: dict[str, tuple[str, list[tuple[str, list[str], float]]]] = {
    "evt-earthquake": ("Earthquake: telecom damaged, fire-water main destroyed, crews drawn away", [
        ("ph_phone", ["functionality"], 3), ("ph_radio", ["functionality"], 3),
        ("ph_fibre", ["functionality"], 1), ("pipe_main", ["capacity"], 0),
        ("ph_other_areas", ["category_dependency_profiles", "crews", "demand"], 20)]),
    "evt-one-way": ("F5 one-way communication with the fire department", [("F5", ["functionality"], 3)]),
    "evt-radio-restored": ("Radio repeater restored", [("ph_radio", ["functionality"], 4)]),
    "evt-phone-restored": ("Telephone exchange restored", [("ph_phone", ["functionality"], 4)]),
    "evt-crews-released": ("Other areas release their crews",
                           [("ph_other_areas", ["category_dependency_profiles", "crews", "demand"], 0)]),
    "evt-main-repaired": ("Fire-water main repaired", [("pipe_main", ["capacity"], 400)]),
    "evt-fibre-restored": ("Fibre link restored", [("ph_fibre", ["functionality"], 4)]),
}
SCHEDULE = {0: ["evt-earthquake", "evt-one-way"], 4: ["evt-radio-restored"],
            6: ["evt-phone-restored", "evt-crews-released"], 8: ["evt-main-repaired"],
            10: ["evt-fibre-restored"]}
HOURS = 13


def build(remedy: bool) -> tuple[Translated, dict[str, str]]:
    model = readers.read_zheng()
    if remedy:   # Fig. 9: a function that locates and mobilises other organisations' firefighters
        model.add_function("F23", "Locate and mobilise firefighters from other organisations")
        model.add_coupling("F2", "Immediate action guidelines", "F23", "I")
        model.add_coupling(RADIO, "Radio/Telephone", "F23", "R")
    t = translate(model, resonance_config())
    f = t.fn_node
    nodes, edges = dict(t.project.nodes), dict(t.project.edges)

    def node(nid, label, cats, **kw):
        nodes[nid] = Node(id=nid, label=label, functionality=N, node_categories=cats, **kw)

    def edge(eid, s, d, **kw):
        edges[eid] = Edge(id=eid, source=s, target=d, functionality=N, **kw)

    def profile(nid, cat, **kw):
        nd = nodes[nid]
        prof = dict(nd.category_dependency_profiles or {})
        prof[cat] = CategoryDependencyProfile(dependency_level=N, **kw)
        nodes[nid] = nd.model_copy(update={"category_dependency_profiles": prof})

    def add_term(nid, cat):   # a v2 nested rule replaces the composed proposal: name the flow in it
        nd = nodes[nid]
        rules = [r.replace("worst_of(", f"worst_of({cat}, ", 1) for r in nd.rules or []]
        nodes[nid] = nd.model_copy(update={"rules": rules})

    # the description rule of v2 (Zheng §4.2.1)
    nodes[f["F20"]] = nodes[f["F20"]].model_copy(update={"rules": list(nodes[f["F20"]].rules or []) + [
        f"if {f['F12']}.functionality is <4 and {f['F17']}.functionality is <4 then {f['F20']} is severe"]})
    # telecom
    node("ph_radio", "Radio repeater", ["voice"], node_type="Infrastructure")
    node("ph_phone", "Telephone exchange", ["voice"], node_type="Infrastructure")
    node("ph_fibre", "Fibre link", ["data"], node_type="Infrastructure")
    edge("tl_radio", "ph_radio", f[RADIO])
    edge("tl_phone_v", "ph_phone", f[RADIO])
    edge("tl_fibre", "ph_fibre", f[NET])
    edge("tl_phone_d", "ph_phone", f[NET])
    nodes[f[NET]] = nodes[f[NET]].model_copy(update={"rules": [f"best_of(data, voice) propagates to {f[NET]}"]})
    # firefighter crews
    node("ph_crews", "Fire brigade crews", ["crews"], node_type="Personnel", supply_capacity={"crews": 40})
    node("ph_other_areas", "Other earthquake-affected areas", ["crews"], node_type="Service")
    profile("ph_other_areas", "crews", priority=8)
    edge("cr_other", "ph_crews", "ph_other_areas")
    edge("cr_f17", "ph_crews", f["F17"])
    profile(f["F17"], "crews", demand=30, priority=5)
    add_term(f["F17"], "crews")
    if remedy:
        node("ph_mutual_aid", "Mutual-aid crews (other organisations)", ["crews"], node_type="Personnel",
             supply_capacity={"crews": 15})
        edge("ma_gate", f["F23"], "ph_mutual_aid")
        edge("cr_mutual", "ph_mutual_aid", f["F17"])
    # fire water
    node("ph_pumps", "Fire-water pump station", ["firewater"], node_type="Source", supply_capacity={"firewater": 400})
    node("ph_hydrants", "Hydrant ring, tanks 52-54", ["firewater"], node_type="Infrastructure")
    node("ph_trucks", "Firetruck water tanks", ["firewater"], node_type="Source", supply_capacity={"firewater": 80})
    node("ph_cooling", "Cooling of Tank 63", ["firewater"], node_type="Service")
    profile("ph_cooling", "firewater", demand=120, priority=8)
    edge("pipe_main", "ph_pumps", "ph_hydrants", capacity=400)
    for s in ("ph_hydrants", "ph_trucks"):
        edge(f"fw_{s}_f20", s, f["F20"])
        edge(f"fw_{s}_cool", s, "ph_cooling")
    profile(f["F20"], "firewater", demand=240, priority=9)
    add_term(f["F20"], "firewater")

    # readable labels: F-number and name; plumbing keeps its id
    ids = dict(f)
    for fid, nid in f.items():
        name = model.functions[fid].name
        nodes[nid] = nodes[nid].model_copy(update={"label": fid if fid.startswith("X:") else f"{fid} {name[:48]}"})
    for k, nid in enumerate(nodes):
        nd = nodes[nid]
        nodes[nid] = nd.model_copy(update={"position": Position(x=220 * (k % 10), y=140 * (k // 10))})
    fram_ids = list(t.project.nodes)
    canvases = [
        Canvas(id="cv_fram", label="FRAM: Zheng 2024 emergency response",
               graph=Graph(graph_type="generic", node_ids=fram_ids,
                           edge_ids=[e for e in edges if e in t.project.edges or e == "ma_gate"])),
        Canvas(id="cv_telecom", label="Telecom",
               graph=Graph(graph_type="generic", node_ids=["ph_radio", "ph_phone", "ph_fibre"],
                           edge_ids=["tl_radio", "tl_phone_v", "tl_fibre", "tl_phone_d"])),
        Canvas(id="cv_crews", label="Firefighter crews",
               graph=Graph(graph_type="generic",
                           node_ids=["ph_crews", "ph_other_areas"] + (["ph_mutual_aid"] if remedy else []),
                           edge_ids=["cr_other", "cr_f17"] + (["cr_mutual"] if remedy else []))),
        Canvas(id="cv_water", label="Fire water",
               graph=Graph(graph_type="generic", node_ids=["ph_pumps", "ph_hydrants", "ph_trucks", "ph_cooling"],
                           edge_ids=[e for e in edges if e.startswith(("pipe_", "fw_"))])),
    ]
    project = Project(version="2.0", meta=t.project.meta.model_copy(update={
        "name": "Zheng 2024 Natech — physical demonstration" + (" (remedy)" if remedy else ""),
        "description": "FRAM of Zheng et al. 2024 (CC BY 4.0, PSEP 188:514) under CASCADE translation v2, "
                       "with illustrative telecom, crew and fire-water canvases."}),
        nodes=nodes, edges=edges, canvases=canvases)
    cats = list(t.config.categories) + [
        CategoryDefinition(name="voice", category_type="Requisite"),
        CategoryDefinition(name="data", category_type="Requisite"),
        CategoryDefinition(name="crews", category_type="SourceToDemands"),
        CategoryDefinition(name="firewater", category_type="SourceToDemands")]
    config = t.config.model_copy(update={"categories": cats})
    return replace(t, project=project, config=config), ids


def element_id(ids: dict[str, str], element: str) -> str:
    return ids.get(element, element)


def apply(t: Translated, ids: dict[str, str], ops) -> Translated:
    """Set each operation's path on its Element (the imposed layer)."""
    data = t.project.model_dump(mode="json")
    for element, path, value in ops:
        eid = element_id(ids, element)
        target = data["nodes"].get(eid) or data["edges"][eid]
        for key in path[:-1]:
            if target.get(key) is None:
                target[key] = {}
            target = target[key]
        target[path[-1]] = value
    return replace(t, project=Project.model_validate(data))


def fram_operativity(t: Translated, lv: dict[str, int]) -> float:
    fns = [fid for fid in t.fn_node if not fid.startswith("X:")]
    return sum((lv[t.fn_node[x]] - 1) / (N - 1) for x in fns) / len(fns)


def run_timeline(remedy: bool) -> list[dict[str, object]]:
    t0, ids = build(remedy)
    imposed: list = []
    rows = []
    for h in range(HOURS):
        for evt in SCHEDULE.get(h, []):
            if remedy and evt == "evt-one-way":
                continue   # Fig. 9's two-way information updates
            imposed += EVENTS[evt][1]
        t = apply(t0, ids, imposed)
        lv = propagate(t)
        rows.append({"variant": "remedy" if remedy else "as planned", "hour": h,
                     "operativity": round(fram_operativity(t, lv), 3),
                     **{x: lv[t.fn_node[x]] for x in ("F12", "F17", "F20")},
                     "tank63_cooling": lv["ph_cooling"], "radio_tel": lv[t.fn_node[RADIO]],
                     "internet_tel": lv[t.fn_node[NET]]})
    return rows


def claim() -> dict[str, object]:
    """The testable claim at hour 0: physical damage in, Table 2 judgements out."""
    t0, ids = build(False)
    t = apply(t0, ids, EVENTS["evt-earthquake"][1] + EVENTS["evt-one-way"][1])
    lv = function_levels(t, propagate(t))
    truth = readers.zheng_judgements()
    neg = [k for k, j in truth.items() if j == "negative"]
    pos = [k for k, j in truth.items() if j == "positive"]
    tp, tn = sum(lv[k] < N for k in neg), sum(lv[k] == N for k in pos)
    return {"neg_recovered": f"{tp}/8", "pos_kept": f"{tn}/8", "balanced_acc": round((tp + tn) / 16, 3),
            "F12_F17_F20": f"{lv['F12']} {lv['F17']} {lv['F20']}", "F2_F14_F15": f"{lv['F2']} {lv['F14']} {lv['F15']}",
            "wrong": " ".join(sorted([k for k in neg if lv[k] == N] + [k for k in pos if lv[k] < N],
                                     key=lambda x: int(x[1:])))}


PLAYERS = {"telephone exchange": [EVENTS["evt-earthquake"][1][0]],
           "radio repeater": [EVENTS["evt-earthquake"][1][1]],
           "fibre link": [EVENTS["evt-earthquake"][1][2]],
           "fire-water main": [EVENTS["evt-earthquake"][1][3]],
           "crews drawn away": [EVENTS["evt-earthquake"][1][4]],
           "F5 one-way communication": EVENTS["evt-one-way"][1]}


def shapley() -> list[dict[str, object]]:
    t0, ids = build(False)
    names = list(PLAYERS)
    n = len(names)
    v = {}
    for k in range(n + 1):
        for s in itertools.combinations(names, k):
            t = apply(t0, ids, [op for p in s for op in PLAYERS[p]])
            v[frozenset(s)] = 1 - fram_operativity(t, propagate(t))
    rows = []
    for p in names:
        others = [q for q in names if q != p]
        phi = sum(math.factorial(len(s)) * math.factorial(n - len(s) - 1) / math.factorial(n)
                  * (v[frozenset(s) | {p}] - v[frozenset(s)])
                  for k in range(n) for s in itertools.combinations(others, k))
        rows.append({"damage": p, "shapley_operativity_loss": round(phi, 4)})
    rows.sort(key=lambda r: -r["shapley_operativity_loss"])
    rows.append({"damage": "(all together)", "shapley_operativity_loss": round(v[frozenset(names)], 4)})
    return rows


def bundle(remedy: bool) -> dict:
    t, ids = build(remedy)
    events = [EventDefinition(id=eid, label=label, type="hazard" if eid == "evt-earthquake" else "disservice",
                              temporal_simulation_only=eid != "evt-earthquake",
                              attribute_operations=[{"element": element_id(ids, e), "path": p, "op": "set", "value": v}
                                                    for e, p, v in ops])
              for eid, (label, ops) in EVENTS.items() if not (remedy and eid == "evt-one-way")]
    config = t.config.model_copy(update={"events": events})
    ModelConfiguration.model_validate(config.model_dump())
    steps = []
    for h in range(HOURS):
        evts = [e for e in SCHEDULE.get(h, []) if not (remedy and e == "evt-one-way")]
        steps.append({"label": f"{START}{h:02d}", "unit": "hour", "repeat": 1,
                      "phases": [{"events": [{"event": e, "every": 1} for e in evts], "propagate": True}]})
    project = t.project.model_dump(mode="json", exclude_none=True)
    project["temporal_simulations"] = [{
        "id": "simulation-earthquake", "format": "cascade.temporal-simulation/v1",
        "timeline": {"name": "Earthquake: the first 12 hours", "steps": steps},
        "profile": {}, "metrics": [], "scope": "global"}]
    return {"project": project, "config": config.model_dump(mode="json", exclude_none=True)}


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    DEMO.mkdir(parents=True, exist_ok=True)
    for remedy in (False, True):
        name = "zheng_natech_remedy.json" if remedy else "zheng_natech.json"
        (DEMO / name).write_text(json.dumps(bundle(remedy), indent=1))
    c = claim()
    print("== claim at hour 0", c)
    write("d_claim.csv", [c])
    tl = run_timeline(False) + run_timeline(True)
    write("d_timeline.csv", tl)
    print("== timeline")
    for r in tl:
        print(r)
    sh = shapley()
    write("d_shapley.csv", sh)
    print("== shapley")
    for r in sh:
        print(r)


if __name__ == "__main__":
    main()
