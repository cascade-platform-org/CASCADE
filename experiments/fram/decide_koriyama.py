"""
The Koriyama decision model (TRANSLATION.md §4f, declared at abd3314): the
analysts' two recommendations compared on the converted model RQ1 checked.

  K0  the event as it happened      K2  R2: evacuation behaviour held nominal (T6)
  K1  R1: public communication      K3  R1 + R2
      reviewed (T1, T2 nominal)

Togawa et al. 2023 give no capacities, call counts or deadline, so the case
runs the procedure on structure alone: the options, the one assumption the
FRAM leaves implicit (does the 119-call load follow evacuation?), the severity
grid and the scale.

  A  the call load is exogenous, as drawn: level 3 in every option
  B  the call load follows evacuation: it sits at the level T6 reaches

  results/koriyama_options.csv, koriyama_grid.csv, koriyama_shapley.csv

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
from run_rq2 import barrier

RESULTS = Path(__file__).resolve().parent / "results"
CALLS = "X:Emergency call (119)"
EVENT = ["T1", "T2", "X:Immediate environment", "X:Function restricted during nighttime", CALLS]
OPTIONS = {"K0": "the event as it happened", "K1": "R1: public communication reviewed",
           "K2": "R2: evacuation behaviour held nominal", "K3": "R1 + R2"}
READINGS = ("A", "B")
SCALES = (N, 7)


def build(option: str, n: int) -> Translated:
    t = translate(readers.read_togawa(), config_at(n))
    if option in ("K2", "K3"):
        barrier(t, "T6")
    return t


def fn_levels(t: Translated, start: dict[str, int]) -> dict[str, int]:
    return function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))


def run(option: str, n: int, reading: str, sev: dict[str, int]) -> dict[str, int]:
    """Function levels under the option, the event at `sev` (an N = 4 level per element)."""
    t = build(option, n)
    start = {e: level(n, sev[e]) for e in EVENT}
    if option in ("K1", "K3"):
        start.pop("T1"), start.pop("T2")
    if reading == "B":                                   # the calls follow T6
        start.pop(CALLS)
        t6 = fn_levels(t, start)["T6"]
        if t6 < n:
            start[CALLS] = t6
    return {f: v for f, v in fn_levels(t, start).items()}


def operativity(lv: dict[str, int], n: int) -> float:
    fns = [f for f in lv if not f.startswith("X:")]
    return sum((lv[f] - 1) / (n - 1) for f in fns) / len(fns)


DECLARED = {e: 3 for e in EVENT}


def options_rows() -> list[dict[str, object]]:
    rows = []
    for n, reading, option in itertools.product(SCALES, READINGS, OPTIONS):
        lv = run(option, n, reading, DECLARED)
        rows.append({"N": n, "reading": reading, "option": option,
                     **{f: lv[f] for f in sorted(f for f in lv if f.startswith("T"))},
                     "operativity": round(operativity(lv, n), 3)})
    return rows


def grid_rows() -> list[dict[str, object]]:
    rows = []
    for n, reading in itertools.product(SCALES, READINGS):
        free = EVENT[:-1] if reading == "B" else EVENT
        points = [dict(zip(free, p), **({} if reading == "A" else {CALLS: 3}))
                  for p in itertools.product((1, 2, 3), repeat=len(free))]
        result = {o: [run(o, n, reading, p) for p in points] for o in OPTIONS}
        order = all(all(a[f] <= b[f] for f in a)
                    for k0, k1, k2, k3 in zip(*(result[o] for o in OPTIONS))
                    for a, b in ((k0, k1), (k0, k2), (k1, k3), (k2, k3)))
        for o, runs in result.items():
            rows.append({"N": n, "reading": reading, "option": o, "points": len(points),
                         "T9_nominal": f"{sum(r['T9'] == n for r in runs)}/{len(points)}",
                         "mean_operativity": round(sum(operativity(r, n) for r in runs) / len(runs), 3),
                         "order_holds": order})
    return rows


def shapley() -> list[dict[str, object]]:
    """K0 at the declared coding, N = 4: each event element's share of the Operativity loss."""
    def v(coalition: frozenset[str]) -> float:
        t = build("K0", N)
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
    write("koriyama_options.csv", options_rows())
    write("koriyama_grid.csv", grid_rows())
    write("koriyama_shapley.csv", shapley())


if __name__ == "__main__":
    main()
