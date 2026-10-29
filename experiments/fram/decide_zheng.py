"""
The Zheng decision model (TRANSLATION.md §4d, declared at 882d4a1): the
analysts' own recommendations compared under firefighters and time, on the
converted model RQ1 checked.

  O0  the plan                     O2  O1 + mobilise other organisations' firefighters (Fig. 9)
  O1  two-way updates (F5 fixed)   O3  F5 cancelled + the same mobilisation (second round)

Firefighters are F17's Resource (Table 1), a SourceToDemands flow in units of
F17's need (100): the brigade supplies 100, the other earthquake-affected areas
draw 100·d first, and under O2/O3 mutual-aid crews supply 100·d from minute a on,
gated by the mobilising function F23. Swept: d, a, telecom severity s. Deadline
from the source: Tank 63 fails 2,000–7,000 s after exposure (33–117 min).

Nothing changes in time except the mutual aid's arrival, so a scenario has two
states (before and after a); the reference point's full timeline and the
projects for the app use 5-minute periods.

  results/decision_map.csv, decision_timeline.csv, decision_shapley.csv
  CASCADE-app/samples/public/fram/zheng_decision_O*.json

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/decide_zheng.py
"""
from __future__ import annotations

import csv
import itertools
import json
import math
from dataclasses import replace
from pathlib import Path

from framkit import readers
from framkit.engine import propagate
from framkit.translate import Translated, resonance_config, translate
from core.importers.xfmv.map import layout
from schemas.config import CategoryDefinition, EventDefinition, ModelConfiguration
from schemas.network import Canvas, CategoryDependencyProfile, Edge, Graph, Node, Position, Project
from schemas.temporal_simulation import Timeline

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
APP = readers.REPO / "CASCADE-app" / "samples" / "public" / "fram"   # Zheng is CC BY
N = 4
NEED = 100
RADIO, NET = "X:Radio/Telephone", "X:Internet/Telephone"
OPTIONS = {"O0": "the plan", "O1": "two-way updates", "O2": "Fig. 9 remedy: two-way updates + mutual aid",
           "O3": "second round: F5 cancelled + mutual aid"}
D_GRID = [k / 10 for k in range(8)]
A_GRID = list(range(10, 121, 10))
S_GRID = (3, 2)
PERIODS = list(range(0, 121, 5))
TTF_MIN, TTF_MAX = 2000 / 60, 7000 / 60
REF = {"d": 0.4, "a": 30, "s": 3}


def build(option: str) -> Translated:
    model = readers.read_zheng()
    if option == "O3":                                 # F5 cancelled: F7 takes F4's output (as C9)
        model.couplings = [c for c in model.couplings if not (c.source == "F5" and c.target == "F7")]
        model.add_coupling("F4", "Successful connection with fire department", "F7", "I")
    if option in ("O2", "O3"):                         # locate and mobilise other organisations' firefighters
        model.add_function("F23", "Locate and mobilise firefighters from other organisations")
        model.add_coupling("F2", "Immediate action guidelines", "F23", "I")
        model.add_coupling(RADIO, "Radio/Telephone", "F23", "R")
    t = translate(model, resonance_config())
    t = replace(t, project=layout(model, t))           # the importer's layout, readable in the app
    f = t.fn_node
    nodes, edges = dict(t.project.nodes), dict(t.project.edges)
    nodes[f["F20"]] = nodes[f["F20"]].model_copy(update={"rules": list(nodes[f["F20"]].rules or []) + [
        f"if {f['F12']}.functionality is <4 and {f['F17']}.functionality is <4 then {f['F20']} is severe"]})

    def node(nid, label, **kw):
        nodes[nid] = Node(id=nid, label=label, functionality=N, node_categories=["crews"], **kw)

    def edge(eid, s, d):
        edges[eid] = Edge(id=eid, source=s, target=d, functionality=N)

    def demand(nid, priority):
        prof = dict(nodes[nid].category_dependency_profiles or {})
        prof["crews"] = CategoryDependencyProfile(dependency_level=N, demand=0 if nid == "other_areas" else NEED,
                                                  priority=priority)
        nodes[nid] = nodes[nid].model_copy(update={"category_dependency_profiles": prof})

    node("brigade", "Fire brigade", node_type="Personnel", supply_capacity={"crews": NEED})
    node("other_areas", "Other earthquake-affected areas", node_type="Service")
    demand("other_areas", priority=8)                  # served first (Zheng §4.2.1)
    edge("cr_other", "brigade", "other_areas")
    edge("cr_f17", "brigade", f["F17"])
    demand(f["F17"], priority=5)
    rules = [r.replace("worst_of(", "worst_of(crews, ", 1) for r in nodes[f["F17"]].rules or []]
    nodes[f["F17"]] = nodes[f["F17"]].model_copy(update={"rules": rules})   # the shortfall, undamped
    if option in ("O2", "O3"):
        node("mutual_aid", "Mutual-aid firefighters (other organisations)", node_type="Personnel",
             supply_capacity={"crews": 0})
        edge("ma_gate", f["F23"], "mutual_aid")       # no mobilisation, no mutual aid
        edge("cr_mutual", "mutual_aid", f["F17"])
    fram = t.project.canvases[0]
    added = [n for n in ("brigade", "other_areas", "mutual_aid") if n in nodes]
    crews = Canvas(id="cv_crews", label="Firefighters", graph=Graph(
        graph_type=fram.graph.graph_type, node_ids=added,
        edge_ids=[e for e in ("cr_other", "cr_f17", "cr_mutual", "ma_gate") if e in edges]))
    for k, nid in enumerate(added):                    # beside F17
        at = nodes[f["F17"]].position or Position(x=0, y=0)
        nodes[nid] = nodes[nid].model_copy(update={"position": Position(x=at.x - 320, y=at.y + 140 * (k - 1))})
    project = t.project.model_copy(update={"nodes": nodes, "edges": edges, "canvases": [fram, crews]})
    on_canvas = {i for c in project.canvases for i in c.graph.node_ids + c.graph.edge_ids}
    missing = (set(nodes) | set(edges)) - on_canvas
    if missing:    # the app propagates only what a canvas holds
        raise ValueError(f"elements on no canvas: {sorted(missing)}")
    config = t.config.model_copy(update={"categories": list(t.config.categories) + [
        CategoryDefinition(name="crews", category_type="SourceToDemands")]})
    return replace(t, project=project, config=config)


def ops(t: Translated, option: str, d: float, s: int, arrived: bool) -> list[tuple[str, list[str], float]]:
    """The imposed state: the event, the firefighters drawn away, the mutual aid if arrived."""
    out = [(t.fn_node[RADIO], ["functionality"], s), (t.fn_node[NET], ["functionality"], s),
           ("other_areas", ["category_dependency_profiles", "crews", "demand"], round(NEED * d))]
    if option == "O0":
        out.append((t.fn_node["F5"], ["functionality"], 3))
    if arrived and option in ("O2", "O3"):
        out.append(("mutual_aid", ["supply_capacity", "crews"], round(NEED * d)))
    return out


def apply(t: Translated, operations) -> Translated:
    data = t.project.model_dump(mode="json")
    for element, path, value in operations:
        target = data["nodes"].get(element) or data["edges"][element]
        for key in path[:-1]:
            if target.get(key) is None:
                target[key] = {}
            target = target[key]
        target[path[-1]] = value
    return replace(t, project=Project.model_validate(data))


def state(t: Translated, option: str, d: float, s: int, arrived: bool) -> dict[str, int]:
    return propagate(apply(t, ops(t, option, d, s, arrived)))


def operativity(t: Translated, lv: dict[str, int]) -> float:
    fns = [fid for fid in t.fn_node if not fid.startswith("X:")]
    return sum((lv[t.fn_node[x]] - 1) / (N - 1) for x in fns) / len(fns)


def verdict(t_f20: float | None) -> str:
    if t_f20 is None or t_f20 > TTF_MAX:
        return "not met"
    return "met for the whole band" if t_f20 <= TTF_MIN else "met for part of the band"


def decision_map() -> list[dict[str, object]]:
    rows = []
    for option in OPTIONS:
        t = build(option)
        f20 = t.fn_node["F20"]
        for s, d in itertools.product(S_GRID, D_GRID):
            before = state(t, option, d, s, arrived=False)
            after = state(t, option, d, s, arrived=True) if option in ("O2", "O3") else before
            for a in (A_GRID if option in ("O2", "O3") else [None]):
                t_f20 = 0 if before[f20] == N else (a if after[f20] == N else None)
                rows.append({"option": option, "s": s, "d": d, "a": a if a is not None else "-",
                             "F20_before": before[f20], "F20_after": after[f20],
                             "t_F20_min": t_f20 if t_f20 is not None else "never", "deadline": verdict(t_f20)})
    return rows


def timeline() -> list[dict[str, object]]:
    rows = []
    for option in OPTIONS:
        t = build(option)
        states = {arr: state(t, option, REF["d"], REF["s"], arr) for arr in (False, True)}
        for m in PERIODS:
            lv = states[m >= REF["a"]]
            rows.append({"option": option, "minute": m, "operativity": round(operativity(t, lv), 3),
                         **{x: lv[t.fn_node[x]] for x in ("F12", "F17", "F20")},
                         "F23": lv[t.fn_node["F23"]] if "F23" in t.fn_node else "-"})
    return rows


def shapley() -> list[dict[str, object]]:
    """The plan (O0) at the reference point, t = 0: each damage's share of the Operativity loss."""
    t = build("O0")
    damages = {"telecom damaged": [(t.fn_node[RADIO], ["functionality"], REF["s"]),
                                   (t.fn_node[NET], ["functionality"], REF["s"])],
               "F5 one-way communication": [(t.fn_node["F5"], ["functionality"], 3)],
               "firefighters drawn away": [("other_areas", ["category_dependency_profiles", "crews", "demand"],
                                            round(NEED * REF["d"]))]}
    names = list(damages)
    v = {frozenset(c): 1 - operativity(t, propagate(apply(t, [o for p in c for o in damages[p]])))
         for k in range(len(names) + 1) for c in itertools.combinations(names, k)}
    n = len(names)
    rows = [{"damage": p, "shapley_operativity_loss": round(sum(
        math.factorial(len(c)) * math.factorial(n - len(c) - 1) / math.factorial(n)
        * (v[frozenset(c) | {p}] - v[frozenset(c)])
        for k in range(n) for c in itertools.combinations([q for q in names if q != p], k)), 4)} for p in names]
    rows.sort(key=lambda r: -r["shapley_operativity_loss"])
    return rows + [{"damage": "(all together)", "shapley_operativity_loss": round(v[frozenset(names)], 4)}]


def bundle(option: str) -> dict:
    """The option at the reference point, with its Temporal Simulation in 5-minute periods."""
    t = build(option)
    first = ops(t, option, REF["d"], REF["s"], arrived=False)
    events = [EventDefinition(id="evt-earthquake", label="Earthquake: telecom damaged, firefighters drawn away"
                              + (", F5 one-way" if option == "O0" else ""), type="hazard",
                              attribute_operations=[{"element": e, "path": p, "op": "set", "value": v}
                                                    for e, p, v in first])]
    if option in ("O2", "O3"):
        events.append(EventDefinition(
            id="evt-mutual-aid", label="Mutual-aid firefighters arrive", type="disservice", temporal_simulation_only=True,
            attribute_operations=[{"element": "mutual_aid", "path": ["supply_capacity", "crews"], "op": "set",
                                   "value": round(NEED * REF["d"])}]))
    config = t.config.model_copy(update={"events": events})
    ModelConfiguration.model_validate(config.model_dump())
    steps = [{"label": f"t+{m:03d} min", "unit": "none", "repeat": 1,
              "phases": [{"events": ([{"event": "evt-earthquake", "every": 1}] if m == 0 else [])
                          + ([{"event": "evt-mutual-aid", "every": 1}] if m == REF["a"] and option in ("O2", "O3")
                             else []), "propagate": True}]} for m in PERIODS]
    timeline_ = {"name": f"Natech response, 0-120 min, {OPTIONS[option]}", "steps": steps}
    Timeline.model_validate(timeline_)
    meta = t.project.meta.model_copy(update={
        "name": f"Zheng 2024 Natech: decision model, {option} ({OPTIONS[option]})",
        "description": "FRAM of Zheng et al. 2024 (CC BY 4.0, PSEP 188:514) converted under v2, with firefighters "
                       f"as a flow. Reference point: {round(REF['d'] * 100)} % of the brigade drawn away, "
                       f"mutual aid at {REF['a']} min, telecom at level {REF['s']}."})
    project = t.project.model_copy(update={"meta": meta}).model_dump(mode="json", exclude_none=True)
    project["temporal_simulations"] = [{"id": "simulation-natech", "format": "cascade.temporal-simulation/v1",
                                        "timeline": timeline_, "profile": {}, "metrics": [], "scope": "global"}]
    return {"project": project, "config": config.model_dump(mode="json", exclude_none=True)}


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("decision_map.csv", decision_map), ("decision_timeline.csv", timeline),
                     ("decision_shapley.csv", shapley)):
        rows = fn()
        write(name, rows)
        print(f"== {name}: {len(rows)} rows")
    APP.mkdir(parents=True, exist_ok=True)
    for option in OPTIONS:
        (APP / f"zheng_decision_{option}.json").write_text(json.dumps(bundle(option), indent=1))


if __name__ == "__main__":
    main()
