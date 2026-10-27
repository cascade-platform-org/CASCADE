"""
E1e — Kim & Yoon 2021: Specific-Rule (A) vs structural (B) translation.
Declared in TRANSLATION.md before this run.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e1e.py
"""
from __future__ import annotations

import csv
import random
import statistics
from pathlib import Path

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.kim import to_level, translate_kim
from framkit.oracles import kim_simulate
from framkit.translate import default_config, resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
SCEN = {"S1": (1.2, 1.2, 1.2), "S2": (1.2, 1.2, 1.4), "S3": (1.3, 1.3, 1.5)}
G1_POS, G1_NEG = ["F7", "F8", "F9", "F10", "F11", "F12", "F13"], ["F2", "F6"]
G2_POS, G2_NEG = ["F4", "F5", "F7", "F8", "F9", "F10", "F11", "F12"], ["F2", "F3", "F6", "F13"]
INFLUENTIAL = {"F7", "F11"}


def variants(model, rows):
    for n in (4, 7):
        yield f"A_rules_N{n}", n, translate_kim(model, rows, n, "rules")
        yield f"B_structural_N{n}", n, translate_kim(model, rows, n, "structural")
    yield "S0_v0_N4", 4, translate(model, default_config(4))
    yield "v2_generic_N4", 4, translate(model, resonance_config(mode="nested"))


def events(n: int, scen: str, worse: int) -> dict[str, int]:
    return {f: max(1, to_level(1.96 * s, n) - worse) for f, s in zip(("F3", "F4", "F5"), SCEN[scen])}


def levels(t, start: dict[str, int]) -> dict[str, int]:
    return function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))


def deficit(lv: dict[str, int], n: int) -> float:
    return sum((n - v) / (n - 1) for f, v in lv.items())


def score() -> list[dict[str, object]]:
    model, rows = readers.read_kim()
    scored = [r["function"] for r in rows if r["rule"]]
    out = []
    for name, n, t in variants(model, rows):
        n_rules = sum(len(t.project.nodes[t.fn_node[f]].rules or []) for f in scored)
        for worse in (0, 1):
            lv = {s: levels(t, events(n, s, worse)) for s in SCEN}
            worst = {f: min(lv[s][f] for s in SCEN) for f in scored}
            g1 = sum(worst[f] < n for f in G1_POS) + sum(worst[f] == n for f in G1_NEG)
            g2 = sum(worst[f] == 1 for f in G2_POS) + sum(worst[f] > 1 for f in G2_NEG)
            d = [deficit(lv[s], n) for s in SCEN]
            base = lv["S2"]
            vit = {}
            for f in scored:
                ko = dict(events(n, "S2", worse))
                ko[f] = 1
                vit[f] = deficit(levels(t, ko), n) - deficit(base, n)
            ranked = sorted(vit, key=lambda f: (-vit[f], int(f[1:])))
            out.append({
                "translation": name, "events": "95pct" if not worse else "95pct+1",
                "rules": n_rules,
                "event_levels": " ".join(f"{s}:{''.join(str(v) for v in events(n, s, worse).values())}" for s in SCEN),
                "G1_pattern": f"{g1}/9", "G2_resonance": f"{g2}/12",
                "G3_top2": " ".join(ranked[:2]), "G3_top2_hits": len(set(ranked[:2]) & INFLUENTIAL),
                "G3_rank_F11": ranked.index("F11") + 1,
                "G4_order": "ok" if d[0] <= d[1] <= d[2] and d[0] < d[2] else ("flat" if d[0] == d[2] else "no"),
                "levels_worst": " ".join(f"{f}:{worst[f]}" for f in scored),
            })
    return out


def oracle_sensitivity(trials: int = 1500) -> list[dict[str, object]]:
    """Fig. 8 re-run with the oracle: % change of S2 mean duration, IEV_p +-10 %."""
    _, rows = readers.read_kim()
    sigma = {r["function"]: float(r["iev"]) for r in rows}
    sigma.update(F3=1.2, F4=1.2, F5=1.4)

    def mean_duration(sg: dict[str, float]) -> float:
        rng = random.Random(7)   # common random numbers across perturbations
        return statistics.mean(kim_simulate(rows, sg, rng)["duration"] for _ in range(trials))

    base = mean_duration(sigma)
    out = []
    for r in rows:
        if not r["rule"]:
            continue
        f = r["function"]
        up = mean_duration({**sigma, f: sigma[f] * 1.1})
        down = mean_duration({**sigma, f: sigma[f] * 0.9})
        out.append({"function": f, "plus10_pct": round(100 * (up - base) / base, 1),
                    "minus10_pct": round(100 * (down - base) / base, 1),
                    "spread": round(100 * (down - up) / base, 1)})
    return sorted(out, key=lambda r: -r["spread"])


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("e1e_kim.csv", score), ("e1e_kim_oracle_sensitivity.csv", oracle_sensitivity)):
        rows = fn()
        write(name, rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
