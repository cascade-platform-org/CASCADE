"""
E2b — RQ2 reframed: does scenario-conditioned attribution (Shapley over the
observed deviations) recover the reported causes where topology does not?
Declared in TRANSLATION.md before this run.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e2b.py
"""
from __future__ import annotations

import csv
import itertools
import math
from pathlib import Path

import run_e2
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.translate import resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4


def deficit(lv: dict[str, int], outcome: list[str]) -> float:
    return float(sum(N - lv[f] for f in outcome))


def shapley(t, players: dict[str, int], outcome: list[str]) -> dict[str, float]:
    names = list(players)
    n = len(names)
    v = {}
    for k in range(n + 1):
        for s in itertools.combinations(names, k):
            lv = function_levels(t, propagate(t, {t.fn_node[p]: players[p] for p in s}))
            v[frozenset(s)] = deficit(lv, outcome)
    phi = {}
    for p in names:
        others = [q for q in names if q != p]
        phi[p] = sum(math.factorial(len(s)) * math.factorial(n - len(s) - 1) / math.factorial(n)
                     * (v[frozenset(s) | {p}] - v[frozenset(s)])
                     for k in range(n) for s in itertools.combinations(others, k))
    return phi


def vitality(t, candidates: list[str]) -> dict[str, float]:
    fns = [f for f in t.fn_node if not f.startswith("X:")]

    def op(lv):
        return sum((lv[f] - 1) / (N - 1) for f in fns) / len(fns)
    base = op(function_levels(t, propagate(t)))
    return {c: base - op(function_levels(t, propagate(t, {t.fn_node[c]: 1}))) for c in candidates}


def rankings(model, t, players, outcome, candidates):
    out = {"shapley": shapley(t, players, outcome), "vitality": vitality(t, candidates)}
    out.update(run_e2.baselines(model))
    return {m: {c: s.get(c, 0.0) for c in candidates} for m, s in out.items()}


def topk(scores, k):
    return sorted(scores, key=lambda c: (-scores[c], c))[:k]


def pair_order(scores, red, blue):
    tot = 0.0
    for r, b in itertools.product(red, blue):
        tot += 1.0 if scores[r] > scores[b] else 0.5 if scores[r] == scores[b] else 0.0
    return tot / (len(red) * len(blue))


def main() -> None:
    rows = []
    # Wenzhou
    model = readers.read_wenzhou()
    t = translate(model, resonance_config(mode="nested"))
    players = {"M7": 1, "M10": 1, "M5": 3, "M8": 3, "M11": 3, "M16": 3, "M19": 3}
    truth = {"M5", "M7", "M8", "M10"}
    for m, s in rankings(model, t, players, ["M20"], list(players)).items():
        top = topk(s, 4)
        rows.append({"case": "Wenzhou", "metric": m, "score": f"{len(set(top) & truth)}/4 in top-4",
                     "ranking": " ".join(f"{c}:{s[c]:.3g}" for c in sorted(s, key=lambda c: (-s[c], c)))})
    # Koriyama
    model = readers.read_togawa()
    t = translate(model, resonance_config(mode="nested"))
    players = {"T1": 3, "T2": 3, "T7": 3, "T8": 3, "X:Immediate environment": 3,
               "X:Function restricted during nighttime": 3, "X:Emergency call (119)": 3}
    cands = ["T1", "T2", "T7", "T8"]
    for m, s in rankings(model, t, players, ["T6", "T9"], cands).items():
        rows.append({"case": "Koriyama", "metric": m,
                     "score": f"red>blue pairs {pair_order(s, ['T1', 'T2'], ['T7', 'T8']):.2f}",
                     "ranking": " ".join(f"{c}:{s[c]:.3g}" for c in sorted(s, key=lambda c: (-s[c], c)))})
    # Tian
    model = readers.read_tian()
    t = translate(model, resonance_config(mode="nested"))
    f7 = t.fn_node["F7"]
    for fid in ("F5", "F2"):
        node = t.project.nodes[t.fn_node[fid]]
        t.project.nodes[t.fn_node[fid]] = node.model_copy(update={"rules": (node.rules or []) + [
            f"if {f7}.functionality is <4 then {t.fn_node[fid]} is not performed"]})
    players = {"F7": 3, "F2": 1, "F1": 3}
    for m, s in rankings(model, t, players, ["F2", "F5", "F8"], list(players)).items():
        top = topk(s, 1)
        rows.append({"case": "Tian", "metric": m, "score": f"top-1 {top[0]}" + (" (hit)" if top[0] == "F7" else ""),
                     "ranking": " ".join(f"{c}:{s[c]:.3g}" for c in sorted(s, key=lambda c: (-s[c], c)))})
    with open(RESULTS / "e2b_attribution.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
