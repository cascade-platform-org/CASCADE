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

The sweeps run as the app runs them: each option is a project with one
Temporal Simulation (5-minute periods, 0-120 min) whose Parameters are the
three unknowns, drawn_away_pct (d), arrival_min (a) and telecom_level (s). The
earthquake Event reads d and s; the mutual aid's arrival is a profile operation
per period reading a and the Series period_end_min. Each grid point is one run
of the app's step operator (`ts/run_timeline.ts`, `engine_worker.py`). Shapley
is not a sweep: it stays a set of single propagations.

Scale sensitivity (TRANSLATION.md §4e): the same model at N = 7 with v2
rescaled (two levels absorbed, every imposed level L -> 2L - 1).

  results/decision_map.csv, decision_timeline.csv, decision_shapley.csv,
  decision_scale.csv, decision_scale_ref.csv
  CASCADE-app/samples/public/fram/zheng_decision_O*.json

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/decide_zheng.py
"""
from __future__ import annotations

import csv
import itertools
import json
import math
import subprocess
import tempfile
from dataclasses import replace
from pathlib import Path

from framkit import readers
from framkit.engine import propagate
from framkit.translate import Translated, TranslationConfig, resonance_config, translate
from core.importers.xfmv.map import layout
from core.importers.xfmv.model import ASPECTS
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
SIM = "simulation-natech"
TS_RUNNER = HERE / "ts" / "run_timeline.ts"


def level(n: int, l4: int) -> int:
    """A level of the 4-level reading on an n-level scale (n = 4 or 7: L -> 2L - 1)."""
    return 1 + (l4 - 1) * (n - 1) // (N - 1)


def config_at(n: int) -> TranslationConfig:
    """v2 on an n-level scale, damping the same third of the range one level does at N = 4."""
    if n == N:
        return resonance_config()
    return TranslationConfig(n=n, dep={a: n - (n - 1) // (N - 1) for a in ASPECTS}, resonance=True)


def top(t: Translated) -> int:
    return max(t.labels)


def build(option: str, n: int = N) -> Translated:
    model = readers.read_zheng()
    if option == "O3":                                 # F5 cancelled: F7 takes F4's output (as C9)
        model.couplings = [c for c in model.couplings if not (c.source == "F5" and c.target == "F7")]
        model.add_coupling("F4", "Successful connection with fire department", "F7", "I")
    if option in ("O2", "O3"):                         # locate and mobilise other organisations' firefighters
        # our placement: the remedy's function joins the mobilization task
        model.add_function("F23", "Locate and mobilise firefighters from other organisations").group = "Mobilization"
        model.add_coupling("F2", "Immediate action guidelines", "F23", "I")
        model.add_coupling(RADIO, "Radio/Telephone", "F23", "R")
    t = translate(model, config_at(n))
    t = replace(t, project=layout(model, t))           # the importer's layout, readable in the app
    f = t.fn_node
    nodes, edges = dict(t.project.nodes), dict(t.project.edges)
    nodes[f["F20"]] = nodes[f["F20"]].model_copy(update={"rules": list(nodes[f["F20"]].rules or []) + [
        f"if {f['F12']}.functionality is <{n} and {f['F17']}.functionality is <{n} "
        f"then {f['F20']} is {t.labels[level(n, 2)]}"]})

    def node(nid, label, **kw):
        nodes[nid] = Node(id=nid, label=label, functionality=n, node_categories=["crews"], **kw)

    def edge(eid, s, d):
        edges[eid] = Edge(id=eid, source=s, target=d, functionality=n)

    def demand(nid, priority):
        prof = dict(nodes[nid].category_dependency_profiles or {})
        prof["crews"] = CategoryDependencyProfile(dependency_level=n, demand=0 if nid == "other_areas" else NEED,
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
    fram = list(t.project.canvases)                    # the paper's task types, and Background
    added = [n for n in ("brigade", "other_areas", "mutual_aid") if n in nodes]
    crews = Canvas(id="cv_crews", label="Firefighters", graph=Graph(
        graph_type=fram[0].graph.graph_type, node_ids=added,
        edge_ids=[e for e in ("cr_other", "cr_f17", "cr_mutual", "ma_gate") if e in edges]))
    for k, nid in enumerate(added):                    # beside F17
        at = nodes[f["F17"]].position or Position(x=0, y=0)
        nodes[nid] = nodes[nid].model_copy(update={"position": Position(x=at.x - 320, y=at.y + 140 * (k - 1))})
    project = t.project.model_copy(update={"nodes": nodes, "edges": edges, "canvases": [*fram, crews]})
    on_canvas = {i for c in project.canvases for i in c.graph.node_ids + c.graph.edge_ids}
    missing = (set(nodes) | set(edges)) - on_canvas
    if missing:    # the app propagates only what a canvas holds
        raise ValueError(f"elements on no canvas: {sorted(missing)}")
    config = t.config.model_copy(update={"categories": list(t.config.categories) + [
        CategoryDefinition(name="crews", category_type="SourceToDemands")]})
    return replace(t, project=project, config=config)


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


def operativity(t: Translated, lv: dict[str, int]) -> float:
    fns = [fid for fid in t.fn_node if not fid.startswith("X:")]
    return sum((lv[t.fn_node[x]] - 1) / (top(t) - 1) for x in fns) / len(fns)


def verdict(t_f20: float | None) -> str:
    if t_f20 is None or t_f20 > TTF_MAX:
        return "not met"
    return "met for the whole band" if t_f20 <= TTF_MIN else "met for part of the band"


def label(m: int) -> str:
    return f"t+{m:03d} min"


def simulation_bundle(option: str, n: int = N) -> dict:
    """The option as a project with its Temporal Simulation; d, a, s are its Parameters."""
    t = build(option, n)
    step = (n - 1) // (N - 1)                         # telecom level L -> 1 + (L - 1)·step
    quake = [{"element": t.fn_node[x], "path": ["functionality"], "op": "set", "value": step,
              "parameter": "telecom_level"} for x in (RADIO, NET)]
    if step != 1:
        quake += [{"element": t.fn_node[x], "path": ["functionality"], "op": "add", "value": 1 - step}
                  for x in (RADIO, NET)]
    quake.append({"element": "other_areas", "path": ["category_dependency_profiles", "crews", "demand"],
                  "op": "set", "value": NEED / 100, "parameter": "drawn_away_pct"})
    if option == "O0":
        quake.append({"element": t.fn_node["F5"], "path": ["functionality"], "op": "set", "value": level(n, 3)})
    defaults = {"drawn_away_pct": round(REF["d"] * 100), "arrival_min": REF["a"], "telecom_level": REF["s"]}
    events = [EventDefinition(id="evt-earthquake", type="hazard", parameter_defaults=defaults,
                              label="Earthquake: telecom damaged, firefighters drawn away"
                              + (", F5 one-way" if option == "O0" else ""), attribute_operations=quake)]
    config = t.config.model_copy(update={"events": events})
    ModelConfiguration.model_validate(config.model_dump())
    # Mutual aid from minute a on: 1 when the period ends after a, else 0, times d (all values stay >= 0).
    arrival = [{"element": "mutual_aid", "path": ["supply_capacity", "crews"], "op": op, "value": v, **extra}
               for op, v, extra in (("set", 1, {"series": "period_end_min"}),
                                    ("at_least", 1, {"parameter": "arrival_min"}),
                                    ("add", -1, {"parameter": "arrival_min"}),
                                    ("at_most", 1, {}),
                                    ("mul", NEED / 100, {"parameter": "drawn_away_pct"}))]
    steps = [{"label": label(m), "unit": "none", "repeat": 1,
              "phases": [{"events": [{"event": "evt-earthquake", "every": 1}] if m == 0 else [], "propagate": True}]}
             for m in PERIODS]
    timeline_ = {"name": f"Natech response, 0-120 min, {OPTIONS[option]}", "steps": steps}
    Timeline.model_validate(timeline_)
    meta = t.project.meta.model_copy(update={
        "name": f"Zheng 2024 Natech: decision model, {option} ({OPTIONS[option]})",
        "description": "FRAM of Zheng et al. 2024 (CC BY 4.0, PSEP 188:514) converted under v2, with firefighters "
                       "as a flow. Parameters: drawn_away_pct (share of the brigade drawn away), arrival_min "
                       "(mutual-aid arrival), telecom_level (telecom damage, on the 4-level reading)."})
    project = t.project.model_copy(update={"meta": meta}).model_dump(mode="json", exclude_none=True)
    project["series"] = [{"name": "period_end_min", "unit": "min", "description": "The minute each period ends.",
                          "rows": {"*": {label(m): m + 5 for m in PERIODS}}}]
    project["temporal_simulations"] = [{
        "id": SIM, "format": "cascade.temporal-simulation/v1", "timeline": timeline_,
        "profile": {label(m): arrival for m in PERIODS} if option in ("O2", "O3") else {},
        "metrics": metrics(t, n), "scope": "global",
        "parameters": [{"name": k, "value": v} for k, v in defaults.items()]}]
    return {"project": project, "config": config.model_dump(mode="json", exclude_none=True)}


def metrics(t: Translated, n: int) -> list[dict]:
    """What Compare shows per run: F20, F17 and F12's levels, and whether F20 is nominal
    (its mean over the run is the share of periods F20 is restored)."""
    def of(fid: str) -> dict:
        return {"label_contains": t.project.nodes[t.fn_node[fid]].label}
    def lowest(name: str, fid: str) -> dict:
        return {"name": name, "target": of(fid), "path": ["functionality"], "read": "state", "aggregate": "min"}

    return [lowest("F20 attack on the fire (level)", "F20"),
            {"name": "F20 nominal (1 = yes)", "target": of("F20"), "path": ["functionality"], "read": "state",
             "aggregate": "share_where", "value_filter": {"cmp": ">=", "value": n}},
            lowest("F17 fire team (level)", "F17"), lowest("F12 guidelines (level)", "F12")]


def run_points(option: str, n: int, points: list[dict[str, float]]) -> list[list[dict[str, int]]]:
    """One Temporal Simulation run per point (d, a, s): each run's node levels per period."""
    runs = [{"bundle": "b", "simulation": SIM, "parameters": {
        "drawn_away_pct": round(p["d"] * 100), "arrival_min": p.get("a", REF["a"]), "telecom_level": p["s"]}}
        for p in points]
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "in.json", Path(tmp) / "out.json"
        src.write_text(json.dumps({"bundles": {"b": simulation_bundle(option, n)}, "runs": runs}))
        subprocess.run(["npx", "--yes", "tsx", str(TS_RUNNER), str(src), str(dst)],
                       cwd=readers.REPO / "CASCADE-app", check=True)
        out = json.loads(dst.read_text())
    for r in out:
        if r["warnings"]:
            raise RuntimeError(f"{option}: {r['warnings'][:3]}")
    return [[p["functionality"] for p in r["periods"]] for r in out]


def t_nominal(periods: list[dict[str, int]], nid: str, n: int) -> int | None:
    """The first minute from which `nid` stays nominal to the end of the window, or None."""
    first = None
    for m, lv in zip(PERIODS, periods):
        if lv[nid] == n:
            first = m if first is None else first
        else:
            first = None
    return first


def grid(option: str) -> list[dict[str, float]]:
    aids = A_GRID if option in ("O2", "O3") else [REF["a"]]
    return [{"s": s, "d": d, "a": a} for s, d, a in itertools.product(S_GRID, D_GRID, aids)]


def decision_map() -> list[dict[str, object]]:
    rows = []
    for option in OPTIONS:
        f20 = build(option).fn_node["F20"]
        points = grid(option)
        for p, periods in zip(points, run_points(option, N, points)):
            t_f20 = t_nominal(periods, f20, N)
            rows.append({"option": option, "s": p["s"], "d": p["d"],
                         "a": p["a"] if option in ("O2", "O3") else "-",
                         "F20_before": periods[0][f20], "F20_after": periods[-1][f20],
                         "t_F20_min": t_f20 if t_f20 is not None else "never", "deadline": verdict(t_f20)})
    return rows


def timeline(n: int = N) -> list[dict[str, object]]:
    rows = []
    for option in OPTIONS:
        t = build(option, n)
        periods = run_points(option, n, [REF])[0]
        for m, lv in zip(PERIODS, periods):
            fn = {x: lv[nid] for x, nid in t.fn_node.items()}
            rows.append({"option": option, "minute": m, "operativity": round(operativity(t, lv), 3),
                         **{x: fn[x] for x in ("F12", "F17", "F20")},
                         "F23": fn["F23"] if "F23" in fn else "-"})
    return rows


def shapley(n: int = N) -> list[dict[str, object]]:
    """The plan (O0) at the reference point, t = 0: each damage's share of the Operativity loss."""
    t = build("O0", n)
    damages = {"telecom damaged": [(t.fn_node[RADIO], ["functionality"], level(n, REF["s"])),
                                   (t.fn_node[NET], ["functionality"], level(n, REF["s"]))],
               "F5 one-way communication": [(t.fn_node["F5"], ["functionality"], level(n, 3))],
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


def scale() -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """§4e: F20 per (N, option, s, d) before and after the mutual aid; the reference point at N = 7."""
    rows = []
    for n, option in itertools.product((N, 7), OPTIONS):
        f20 = build(option, n).fn_node["F20"]
        points = [{"s": s, "d": d, "a": REF["a"]} for s, d in itertools.product(S_GRID, D_GRID)]
        for p, periods in zip(points, run_points(option, n, points)):
            before, after = periods[0][f20], periods[-1][f20]
            rows.append({"N": n, "option": option, "s_at_N4": p["s"], "d": p["d"], "F20_before": before,
                         "F20_after": after, "F20_before_normalised": round((before - 1) / (n - 1), 3),
                         "F20_after_normalised": round((after - 1) / (n - 1), 3)})
    ref = [{"N": n, "what": f"operativity {r['option']} minute {r['minute']}", "value": r["operativity"]}
           for n in (N, 7) for r in timeline(n) if r["minute"] in (0, REF["a"])]
    ref += [{"N": n, "what": f"shapley {r['damage']}", "value": r["shapley_operativity_loss"]}
            for n in (N, 7) for r in shapley(n)]
    return rows, ref


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
    rows, ref = scale()
    write("decision_scale.csv", rows)
    write("decision_scale_ref.csv", ref)
    print(f"== decision_scale.csv: {len(rows)} rows")
    APP.mkdir(parents=True, exist_ok=True)
    for option in OPTIONS:
        (APP / f"zheng_decision_{option}.json").write_text(json.dumps(simulation_bundle(option), indent=1))


if __name__ == "__main__":
    main()
