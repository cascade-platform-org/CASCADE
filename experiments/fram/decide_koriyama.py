"""
The Koriyama variants (TRANSLATION.md §4f, declared at abd3314): the analysts'
two recommended interventions compared on the dependency graph RQ1 checked. The
interventions were labelled K0-K3 until the paper's notation settled on I.

  I0  the event as it happened      I2  R2: evacuation behaviour held nominal (T6)
  I1  R1: public communication      I3  R1 + R2
      reviewed (T1, T2 nominal)

Togawa et al. 2023 give no capacities, call counts or deadline, so the case
runs the procedure on structure alone: the interventions, the one assumption the
FRAM leaves implicit (does the 119-call load follow evacuation?), the severity
grid and the scale.

  A  the call load is exogenous, as drawn: level 3 in every intervention
  B  the call load follows evacuation: a model edit, an edge from T6 to the
     119-call node at full dependency, so the calls sit at T6's level

  results/koriyama_interventions.csv, koriyama_grid.csv, koriyama_shapley.csv

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/decide_koriyama.py
"""
from __future__ import annotations

import csv
import itertools
import math
from pathlib import Path

from decide_zheng import N, config_at, level
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.translate import Translated, translate
from dataclasses import replace

from schemas.config import CategoryDefinition
from schemas.network import CategoryDependencyProfile, Edge, Node
from run_rq2 import barrier

RESULTS = Path(__file__).resolve().parent / "results"
CALLS = "X:Emergency call (119)"
EVENT = ["T1", "T2", "X:Immediate environment", "X:Function restricted during nighttime", CALLS]
INTERVENTIONS = {"I0": "the event as it happened", "I1": "R1: public communication reviewed",
           "I2": "R2: evacuation behaviour held nominal", "I3": "R1 + R2"}
READINGS = ("A", "B")
SCALES = (N, 7)


def build(intervention: str, n: int, reading: str = "A") -> Translated:
    t = translate(readers.read_togawa(), config_at(n))
    if intervention in ("I2", "I3"):
        barrier(t, "T6")
    if reading == "B":                                   # the calls follow evacuation
        t.project.edges["e_calls_follow_t6"] = Edge(id="e_calls_follow_t6", source=t.fn_node["T6"],
                                                    target=t.fn_node[CALLS], functionality=n)
    return t


def fn_levels(t: Translated, start: dict[str, int]) -> dict[str, int]:
    return function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))


def run(intervention: str, n: int, reading: str, sev: dict[str, int]) -> dict[str, int]:
    """Function levels under the intervention, the event at `sev` (an N = 4 level per element)."""
    t = build(intervention, n, reading)
    start = {e: level(n, sev[e]) for e in EVENT if not (reading == "B" and e == CALLS)}
    if intervention in ("I1", "I3"):
        start.pop("T1"), start.pop("T2")
    return fn_levels(t, start)


def operativity(lv: dict[str, int], n: int) -> float:
    fns = [f for f in lv if not f.startswith("X:")]
    return sum((lv[f] - 1) / (n - 1) for f in fns) / len(fns)


DECLARED = {e: 3 for e in EVENT}


def interventions_rows() -> list[dict[str, object]]:
    rows = []
    for n, reading, intervention in itertools.product(SCALES, READINGS, INTERVENTIONS):
        lv = run(intervention, n, reading, DECLARED)
        rows.append({"N": n, "reading": reading, "intervention": intervention,
                     **{f: lv[f] for f in sorted(f for f in lv if f.startswith("T"))},
                     "operativity": round(operativity(lv, n), 3)})
    return rows


def grid_rows() -> list[dict[str, object]]:
    rows = []
    for n, reading in itertools.product(SCALES, READINGS):
        free = EVENT[:-1] if reading == "B" else EVENT
        points = [dict(zip(free, p), **({} if reading == "A" else {CALLS: 3}))
                  for p in itertools.product((1, 2, 3), repeat=len(free))]
        result = {o: [run(o, n, reading, p) for p in points] for o in INTERVENTIONS}
        order = all(all(a[f] <= b[f] for f in a)
                    for i0, i1, i2, i3 in zip(*(result[o] for o in INTERVENTIONS))
                    for a, b in ((i0, i1), (i0, i2), (i1, i3), (i2, i3)))
        for o, runs in result.items():
            rows.append({"N": n, "reading": reading, "intervention": o, "points": len(points),
                         "T9_nominal": f"{sum(r['T9'] == n for r in runs)}/{len(points)}",
                         "mean_operativity": round(sum(operativity(r, n) for r in runs) / len(runs), 3),
                         "order_holds": order})
    return rows


def shapley() -> list[dict[str, object]]:
    """I0 at the declared coding, N = 4: each event element's share of the Operativity loss."""
    def v(coalition: frozenset[str]) -> float:
        t = build("I0", N)
        start = {e: 3 for e in coalition}
        return 1 - operativity(fn_levels(t, start), N)

    v_all = {frozenset(c): v(frozenset(c)) for k in range(len(EVENT) + 1) for c in itertools.combinations(EVENT, k)}
    n = len(EVENT)
    rows = [{"damage": p, "shapley_operativity_loss": round(sum(
        math.factorial(len(c)) * math.factorial(n - len(c) - 1) / math.factorial(n)
        * (v_all[frozenset(c) | {p}] - v_all[frozenset(c)])
        for k in range(n) for c in itertools.combinations([q for q in EVENT if q != p], k)), 4)} for p in EVENT]
    rows.sort(key=lambda r: -r["shapley_operativity_loss"])
    return rows + [{"damage": "(all together)", "shapley_operativity_loss": round(v_all[frozenset(EVENT)], 4)}]



# --- §4j: rescue capacity as a flow into the 119-call node, and the night, over hourly periods ---------
HOURS = [13 + h for h in range(22)][:21]            # 13:00 .. 09:00 start of period (21 periods, to 10:00)
NIGHT = lambda h: h % 24 >= 17 or h % 24 < 6        # dusk 17:00 to dawn 06:00
CALLING = lambda h: h >= 22                          # overtopping 22:00, to the end of the window
KAPPA = [round(0.1 * k, 1) for k in range(1, 13)]
R = [0, 0.25, 0.5, 0.75, 1]
UNIT = 100


def build_flow(intervention: str, n: int, kappa: float) -> Translated:
    """§4f's model (assumption A wiring) with rescue capacity supplying the 119-call node."""
    t = build(intervention, n, "A")
    nodes, edges = dict(t.project.nodes), dict(t.project.edges)
    calls = t.fn_node[CALLS]
    nodes["rescue_capacity"] = Node(id="rescue_capacity", label="Rescue capacity", functionality=n,
                                    node_type="Personnel", node_categories=["rescue"],
                                    supply_capacity={"rescue": round(kappa * UNIT)})
    edges["e_rescue_calls"] = Edge(id="e_rescue_calls", source="rescue_capacity", target=calls, functionality=n)
    nodes[calls] = nodes[calls].model_copy(update={"category_dependency_profiles": {
        "rescue": CategoryDependencyProfile(dependency_level=n, demand=UNIT)}})
    cv = t.project.canvases[0]
    canvas = cv.model_copy(update={"graph": cv.graph.model_copy(update={
        "node_ids": [*cv.graph.node_ids, "rescue_capacity"], "edge_ids": [*cv.graph.edge_ids, "e_rescue_calls"]})})
    project = t.project.model_copy(update={"nodes": nodes, "edges": edges, "canvases": [canvas, *t.project.canvases[1:]]})
    config = t.config.model_copy(update={"categories": [*t.config.categories,
                                                        CategoryDefinition(name="rescue", category_type="SourceToDemands")]})
    return replace(t, project=project, config=config)


def with_load(t: Translated, load: float) -> Translated:
    calls = t.fn_node[CALLS]
    nodes = dict(t.project.nodes)
    prof = dict(nodes[calls].category_dependency_profiles)
    prof["rescue"] = prof["rescue"].model_copy(update={"demand": round(load * UNIT)})
    nodes[calls] = nodes[calls].model_copy(update={"category_dependency_profiles": prof})
    return replace(t, project=t.project.model_copy(update={"nodes": nodes}))


def hour(t: Translated, intervention: str, n: int, assumption: str, r: float, h: int) -> dict[str, int]:
    """One period: the imposed state of hour h, propagated; under B the load follows T6 (two passes)."""
    start = {e: level(n, 3) for e in EVENT if e != CALLS}
    if intervention in ("I1", "I3"):
        start.pop("T1"), start.pop("T2")
    if not NIGHT(h):
        start.pop("X:Function restricted during nighttime")
    imposed = {t.fn_node[f]: v for f, v in start.items()}
    if not CALLING(h):
        return function_levels(t, propagate(with_load(t, 0), imposed))
    load = 1.0
    if assumption == "B" and function_levels(t, propagate(with_load(t, 0), imposed))["T6"] == n:
        load = r
    return function_levels(t, propagate(with_load(t, load), imposed))


def capacity_rows() -> list[dict[str, object]]:
    rows = []
    for n, intervention, kappa in itertools.product(SCALES, INTERVENTIONS, KAPPA):
        t = build_flow(intervention, n, kappa)
        for assumption in READINGS:
            for r in (R if assumption == "B" else [1]):
                t9 = [hour(t, intervention, n, assumption, r, h)["T9"] for h in HOURS]
                night = [v for h, v in zip(HOURS, t9) if CALLING(h) and NIGHT(h)]
                tail = [i for i, h in enumerate(HOURS) if CALLING(h) and all(v == n for v in t9[i:])]
                rows.append({"N": n, "assumption": assumption, "intervention": intervention, "kappa": kappa, "r": r,
                             "night_periods_nominal": f"{sum(v == n for v in night)}/{len(night)}",
                             "T9_nominal_from": f"{HOURS[tail[0]] % 24:02d}:00" if tail else "never",
                             "T9_by_hour": " ".join(str(v) for v in t9)})
    return rows


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"== {name}: {len(rows)} rows")
    for r in rows:
        print(r)


def main() -> None:
    write("koriyama_interventions.csv", interventions_rows())
    write("koriyama_grid.csv", grid_rows())
    write("koriyama_shapley.csv", shapley())
    write("koriyama_capacity.csv", capacity_rows())


if __name__ == "__main__":
    main()
