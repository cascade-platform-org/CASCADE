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
from schemas.network import Edge
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


if __name__ == "__main__":
    main()
