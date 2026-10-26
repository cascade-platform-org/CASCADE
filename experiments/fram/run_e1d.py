"""
E1d — held-out check on the Wenzhou 2011 collision (Li & Huang 2025, Fig. 4
digitised). Mappings and metrics declared in TRANSLATION.md before this run.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e1d.py
"""
from __future__ import annotations

import csv
import itertools
import math
from pathlib import Path

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.translate import default_config, resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4
SEMANTICS = {"S0_v0": default_config(N), "v2_candidate": resonance_config(mode="nested")}
POS = ["M5", "M8", "M11", "M16", "M17", "M19", "M20"]
NEG = ["M12", "M13"]
UNSCORED = ["M15", "M18"]
BROKEN = {("M5", "M11"), ("M7", "M8"), ("M8", "M17"), ("M10", "M16"), ("M10", "M19")}
TABLE3 = BROKEN | {("M8", "M5"), ("M8", "M20"), ("M10", "M5"), ("M11", "M15"), ("M11", "M18"),
                   ("M16", "M17"), ("M19", "M20")}
ORIGINS = {"M7": 1, "M10": 1, "M5": 3, "M8": 3, "M11": 3, "M16": 3, "M19": 3}
CRITICAL = {"M5", "M7", "M8", "M10"}


def run(t, start: dict[str, int]) -> dict[str, int]:
    return function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))


def prf(flagged: set, truth: set) -> str:
    tp = len(flagged & truth)
    p = tp / len(flagged) if flagged else 0.0
    r = tp / len(truth)
    return f"{p:.2f}/{r:.2f}"


def functions_and_couplings() -> list[dict[str, object]]:
    model = readers.read_wenzhou()
    rows = []
    for (sem, tc), (scen, lvl) in itertools.product(SEMANTICS.items(), (("A", 1), ("A2", 2))):
        t = translate(model, tc)
        lv = run(t, {"M7": lvl, "M10": lvl})
        flagged = {(c.source, c.target) for c in model.couplings if lv[c.source] < N and lv[c.target] < N}
        rows.append({
            "semantics": sem, "scenario": scen,
            "pos_degraded": f"{sum(lv[f] < N for f in POS)}/{len(POS)}",
            "neg_nominal": f"{sum(lv[f] == N for f in NEG)}/{len(NEG)}",
            "levels": " ".join(f"{f}:{lv[f]}" for f in POS + NEG + UNSCORED),
            "couplings_flagged": len(flagged),
            "P/R_table1": prf(flagged, BROKEN), "P/R_table3": prf(flagged, TABLE3),
            "degraded_total": sum(v < N for f, v in lv.items() if not f.startswith("X:")),
        })
    return rows


def shapley() -> list[dict[str, object]]:
    model = readers.read_wenzhou()
    rows = []
    players = list(ORIGINS)
    n = len(players)
    for sem, tc in SEMANTICS.items():
        t = translate(model, tc)
        v = {}
        for k in range(n + 1):
            for s in itertools.combinations(players, k):
                v[frozenset(s)] = N - run(t, {p: ORIGINS[p] for p in s})["M20"]
        phi = {}
        for p in players:
            others = [q for q in players if q != p]
            phi[p] = sum(math.factorial(len(s)) * math.factorial(n - len(s) - 1) / math.factorial(n)
                         * (v[frozenset(s) | {p}] - v[frozenset(s)])
                         for k in range(n) for s in itertools.combinations(others, k))
        top4 = sorted(phi, key=lambda p: (-phi[p], int(p[1:])))[:4]
        rows.append({"semantics": sem, "v_all": v[frozenset(players)],
                     "shapley": " ".join(f"{p}:{phi[p]:.3f}" for p in sorted(phi, key=lambda p: -phi[p])),
                     "top4": " ".join(top4), "top4_in_critical": len(set(top4) & CRITICAL)})
    return rows


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("e1d_wenzhou.csv", functions_and_couplings), ("e1d_wenzhou_shapley.csv", shapley)):
        rows = fn()
        write(name, rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
