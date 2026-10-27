"""
E3 layer 1 — exact counterfactuals. E3a: Smith/Khakzad importance measures;
E3b: Kim & Yoon interventions against the oracle. Declared in TRANSLATION.md.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e3a.py
"""
from __future__ import annotations

import csv
import itertools
import math
import random
import statistics
from pathlib import Path

from scipy.stats import spearmanr

import run_e1e
import run_e2
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.kim import translate_kim
from framkit.model import ASPECTS
from framkit.oracles import kim_simulate
from framkit.translate import TranslationConfig, translate
from run_e1b import SMITH_EVENTS

RESULTS = Path(__file__).resolve().parent / "results"
AUTO = ("S8", "S9", "S6", "S3")


def ft_top(failed: set[str]) -> bool:
    return bool(failed & set(AUTO)) and "S2" in failed


def smith_translation(shared_sensor: bool):
    model = readers.read_smith()
    model.functions["S1"].profiles["I"] = "Any"
    if shared_sensor:
        model.add_coupling("S8", "Pressure measured", "S10", "R")
    t = translate(model, TranslationConfig(n=2, dep={a: 2 for a in ASPECTS}, fmi_mode=True,
                                           triggers=frozenset({("S10", "S3"), ("S5", "S3")})))
    return model, t


def birnbaum(top) -> dict[str, float]:
    ev = list(SMITH_EVENTS)
    out = {}
    for i in ev:
        others = [e for e in ev if e != i]
        p = {True: 0.0, False: 0.0}
        for state in itertools.product((False, True), repeat=len(others)):
            prob = math.prod(SMITH_EVENTS[e] if d else 1 - SMITH_EVENTS[e] for e, d in zip(others, state))
            failed = {e for e, d in zip(others, state) if d}
            for fi in (True, False):
                p[fi] += prob * top(failed | ({i} if fi else set()))
        out[i] = p[True] - p[False]
    return out


def e3a() -> list[dict[str, object]]:
    rows = []
    p_top = sum(math.prod(SMITH_EVENTS[e] if e in f else 1 - SMITH_EVENTS[e] for e in SMITH_EVENTS) * ft_top(f)
                for k in range(6) for f in map(set, itertools.combinations(SMITH_EVENTS, k)))
    truth_b = birnbaum(ft_top)
    truth_c = {i: truth_b[i] * SMITH_EVENTS[i] / p_top for i in truth_b}
    for variant in ("b_triggers", "c_shared_sensor"):
        model, t = smith_translation(variant.startswith("c"))

        def top(failed, t=t):
            return function_levels(t, propagate(t, {t.fn_node[e]: 1 for e in failed}))["S1"] == 1
        fns = [f for f in t.fn_node if not f.startswith("X:")]

        def op(lv):
            return sum(lv[f] - 1 for f in fns) / len(fns)
        base = op(function_levels(t, propagate(t)))
        scores = {
            "cascade_birnbaum": birnbaum(top),
            "cascade_shapley": _shapley(list(SMITH_EVENTS), lambda s: float(top(set(s)))),
            "cascade_vitality": {e: base - op(function_levels(t, propagate(t, {t.fn_node[e]: 1}))) for e in SMITH_EVENTS},
        }
        topo = run_e2.baselines(model)
        scores.update({k: {e: topo[k].get(e, 0.0) for e in SMITH_EVENTS} for k in topo})
        for truth_name, truth in (("FT Birnbaum", truth_b), ("FT criticality", truth_c)):
            for m, s in scores.items():
                ev = list(SMITH_EVENTS)
                rho = spearmanr([s[e] for e in ev], [truth[e] for e in ev])[0]
                first = max(ev, key=lambda e: (s[e], e))
                rows.append({"case": f"Smith {variant}", "truth": truth_name, "metric": m,
                             "spearman": round(float(rho), 2) if rho == rho else "nan",
                             "first": first, "S2_first": first == "S2",
                             "scores": " ".join(f"{e}:{s[e]:.3g}" for e in ev)})
        rows.append({"case": f"Smith {variant}", "truth": "(values)", "metric": "FT",
                     "spearman": "", "first": max(truth_b, key=truth_b.get), "S2_first": "",
                     "scores": " ".join(f"{e}:B={truth_b[e]:.3g}/C={truth_c[e]:.3g}" for e in truth_b)})
    return rows


def _shapley(players, v) -> dict[str, float]:
    n = len(players)
    val = {frozenset(s): v(s) for k in range(n + 1) for s in itertools.combinations(players, k)}
    return {p: sum(math.factorial(len(s)) * math.factorial(n - len(s) - 1) / math.factorial(n)
                   * (val[frozenset(s) | {p}] - val[frozenset(s)])
                   for k in range(n) for s in itertools.combinations([q for q in players if q != p], k))
            for p in players}


def kim_effects(factor: float, trials: int = 1500) -> tuple[dict[str, float], dict[str, float]]:
    model, rows = readers.read_kim()
    scored = [r["function"] for r in rows if r["rule"]]
    sigma = {r["function"]: float(r["iev"]) for r in rows}
    sigma.update(F3=1.2, F4=1.2, F5=1.4)

    def oracle(sg):
        rng = random.Random(7)
        return statistics.mean(kim_simulate(rows, sg, rng)["duration"] for _ in range(trials))

    def model_deficit(sg):
        rws = [{**r, "iev": str(sg[r["function"]])} for r in rows]
        t = translate_kim(model, rws, 7, "rules")
        ev = {f: run_e1e.to_level(1.96 * sg[f], 7) for f in ("F3", "F4", "F5")}
        return run_e1e.deficit(run_e1e.levels(t, ev), 7)
    base_o, base_m = oracle(sigma), model_deficit(sigma)
    o, m = {}, {}
    for f in scored:
        sg = {**sigma, f: sigma[f] * factor}
        o[f] = 100 * (oracle(sg) - base_o) / base_o
        m[f] = base_m - model_deficit(sg)
    return o, m


def e3b() -> list[dict[str, object]]:
    rows = []
    for factor in (0.9, 0.5):
        o, m = kim_effects(factor)
        fs = list(o)
        rho = spearmanr([o[f] for f in fs], [m[f] for f in fs])[0]
        top_o = sorted(fs, key=lambda f: -o[f])[:3]
        top_m = sorted(fs, key=lambda f: (-m[f], int(f[1:])))[:3]
        rows.append({"factor": factor, "spearman": round(float(rho), 2) if rho == rho else "nan",
                     "oracle_top3": " ".join(top_o), "model_top3": " ".join(top_m),
                     "top3_overlap": len(set(top_o) & set(top_m)),
                     "model_nonzero": sum(1 for f in fs if m[f] != 0),
                     "oracle": " ".join(f"{f}:{o[f]:.1f}" for f in sorted(fs, key=lambda f: -o[f])),
                     "model": " ".join(f"{f}:{m[f]:.2f}" for f in sorted(fs, key=lambda f: -m[f]))})
    return rows


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("e3a_smith_importance.csv", e3a), ("e3b_kim_interventions.csv", e3b)):
        rows = fn()
        write(name, rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
