"""
Ablations (TRANSLATION.md §4c, declared at 44fc0bc).

  rq1        every case under every member of the family, at the declared event
             coding and over the event-severity grid (every event element at 1, 2, 3)
  claims     the frozen claims under every N = 4 member; each claim's tier
             (rule-decided / entailed / discriminating) and the strict per-outcome verdict
  reference  the engine against the conversion's formula written from the text
             (framkit.oracles.conversion_levels), on the grid and on the .xfmv models

  results/ablation_rq1.csv, ablation_claims.csv, reference_check.csv

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_ablation.py
"""
from __future__ import annotations

import contextlib
import csv
import itertools
import random
import re
import statistics
from collections.abc import Callable, Iterator
from pathlib import Path

import run_rq1
import run_rq2
from framkit import readers
from framkit.model import ASPECTS
from framkit.oracles import conversion_levels
from framkit.translate import (TranslationConfig, cumulative_config, default_config, fmi_config,
                               resonance_config, translate)
from run_rq1 import TIAN_TRUTH, WZ_DEGRADED, WZ_NOMINAL, levels

RESULTS = Path(__file__).resolve().parent / "results"
SEED = 20261029
RANDOM_SCENARIOS = 100

FAMILY: dict[str, TranslationConfig] = {
    "S0": default_config(),
    "D1": TranslationConfig(n=4, dep={a: 3 for a in ASPECTS}),
    "K2": TranslationConfig(n=4, dep={a: 1 for a in ASPECTS}, resonance=True),
    "v2": resonance_config(),
    "v2-D2": TranslationConfig(n=4, dep={a: 2 for a in ASPECTS}, resonance=True),
    "v2-typed": TranslationConfig(n=4, dep={"I": 4, "P": 4, "R": 4, "C": 3, "T": 3}, resonance=True),
    "v2+3": cumulative_config(3),
    "v2+c": cumulative_config(4),
}
MEMBERS = [*FAMILY, "FMI"]


@contextlib.contextmanager
def no_description_rules() -> Iterator[None]:
    """The case builders without the rules read from each paper (TRANSLATION.md §2)."""
    saved = run_rq2.add_rule
    run_rq2.add_rule = lambda *_: None
    try:
        yield
    finally:
        run_rq2.add_rule = saved


def build(member: str, builder: Callable[[TranslationConfig], run_rq2.Case]) -> tuple[run_rq2.Case, int]:
    """The case under one member: FMI runs on N = 2 without description rules."""
    if member != "FMI":
        return builder(FAMILY[member]), 4
    with no_description_rules():
        return builder(fmi_config()), 2


def event_for(member: str, start: dict[str, int]) -> dict[str, int]:
    """FMI reads only failures: an event element below 1 stops its function, others run."""
    return {k: v for k, v in start.items() if v == 1} if member == "FMI" else start


def balanced(lv: dict[str, int], degraded: list[str], nominal: list[str], n: int) -> float:
    return (statistics.mean(lv[f] < n for f in degraded) + statistics.mean(lv[f] == n for f in nominal)) / 2


# --- RQ1 and the event-severity grid ------------------------------------------------------

GRID_CASES: dict[str, tuple[Callable[[TranslationConfig], run_rq2.Case], list[str], list[str]]] = {
    "Zheng": (lambda tc: run_rq2.zheng_case(None, tc),
              [f for f, j in readers.zheng_judgements().items() if j == "negative"],
              [f for f, j in readers.zheng_judgements().items() if j == "positive"]),
    "Wenzhou": (lambda tc: run_rq2.wenzhou_case([], tc=tc), WZ_DEGRADED, WZ_NOMINAL),
    "Koriyama": (lambda tc: run_rq2.koriyama_case([], tc), ["T5", "T6", "T9"], ["T7", "T8", "T3", "T4"]),
}


def grid_scores(case: str, member: str) -> tuple[float, list[float]]:
    """Balanced accuracy at the declared coding, and at every grid point (fixed order)."""
    builder, degraded, nominal = GRID_CASES[case]
    (_, t, declared), n = build(member, builder)
    keys = list(declared)
    at = balanced(levels(t, event_for(member, declared)), degraded, nominal, n)
    grid = [balanced(levels(t, event_for(member, dict(zip(keys, combo)))), degraded, nominal, n)
            for combo in itertools.product((1, 2, 3), repeat=len(keys))]
    return at, grid


def tian_score(member: str) -> float:
    (_, t, _), n = build(member, lambda tc: run_rq2.tian_case(tc=tc))
    hits = {True: [], False: []}
    for (f7, bosun), violates in TIAN_TRUTH.items():
        start = {"F7": f7, "F1": 4} | ({"F2": 1} if bosun == "absent" else {})
        lv = levels(t, event_for(member, start))
        hits[violates].append((lv["F2"] < n and lv["F5"] < n and lv["F8"] < n) == violates)
    return (statistics.mean(hits[True]) + statistics.mean(hits[False])) / 2


def rq1() -> list[dict[str, object]]:
    rows = []
    for case in GRID_CASES:
        scores = {m: grid_scores(case, m) for m in MEMBERS}
        v2_grid = scores["v2"][1]
        for m, (at, grid) in scores.items():
            rows.append({"case": case, "member": m, "declared": round(at, 3),
                         "grid_mean": round(statistics.mean(grid), 3), "grid_min": round(min(grid), 3),
                         "grid_ge_v2": f"{sum(g >= v - 1e-9 for g, v in zip(grid, v2_grid))}/{len(grid)}"})
    for m in MEMBERS:
        rows.append({"case": "Tian", "member": m, "declared": round(tian_score(m), 3),
                     "grid_mean": "-", "grid_min": "-", "grid_ge_v2": "-"})
    run_rq1.SEMANTICS.update({m: (lambda tc=tc: tc) for m, tc in FAMILY.items()})
    for m in FAMILY:
        rows.append({"case": "Kaya (top-4 of the workshop)", "member": m,
                     "declared": run_rq1.kaya(m)["recall"], "grid_mean": "-", "grid_min": "-", "grid_ge_v2": "-"})
    return rows


# --- the claims: tiers and the strict verdict ---------------------------------------------

CLAIMS = ["C1", "C2", "C4", "C5", "C6", "C8", "C9", "C10", "C12", "C14"]
SHIFT = re.compile(r"(\S+):(\d)->(\d)")


def strict(direction: str, detail: str) -> str:
    """Share of the named outcome functions that move as the claim says."""
    moves = [(int(a), int(b)) for _, a, b in SHIFT.findall(detail)]
    if not moves:
        return "-"
    ok = {"improve": lambda a, b: b > a, "stay degraded": lambda a, b: b < 4}.get(
        direction, lambda a, b: b == 4)
    return f"{sum(ok(a, b) for a, b in moves)}/{len(moves)}"


def claim_verdicts(tc: TranslationConfig) -> dict[str, dict[str, object]]:
    return {r["id"]: r for r in run_rq2.claims(tc) if r["id"] in CLAIMS}


def claims() -> list[dict[str, object]]:
    by_member = {m: claim_verdicts(tc) for m, tc in FAMILY.items()}
    with no_description_rules():
        v2_bare = claim_verdicts(FAMILY["v2"])
    rows = []
    for cid in CLAIMS:
        v2 = by_member["v2"][cid]
        if v2_bare[cid]["verdict"] != v2["verdict"]:
            tier = "rule-decided"
        elif all(by_member[m][cid]["verdict"] == v2["verdict"] for m in FAMILY):
            tier = "entailed"
        else:
            tier = "discriminating"
        direction = v2["direction"].split(" (")[0]
        row = {"id": cid, "paper": v2["paper"], "direction": v2["direction"], "tier": tier,
               "v2 without rules": v2_bare[cid]["verdict"]}
        for m in FAMILY:
            row[m] = by_member[m][cid]["verdict"]
            row[f"{m} strict"] = strict(direction, str(by_member[m][cid]["detail"]))
        rows.append(row)
    rows.append({"id": "C13", "paper": "Smith 2017", "direction": "worse", "tier": "entailed (monotonicity)",
                 "v2 without rules": "agree"} | {m: "agree" for m in FAMILY})
    return rows


# --- the reference evaluator against the engine -------------------------------------------

def reference() -> list[dict[str, object]]:
    rows = []
    with no_description_rules():
        for case, (builder, _, _) in GRID_CASES.items():
            for m, tc in FAMILY.items():
                model, t, declared = builder(tc)
                keys, diff, total = list(declared), 0, 0
                for combo in itertools.product((1, 2, 3), repeat=len(keys)):
                    start = dict(zip(keys, combo))
                    eng, ref = levels(t, start), conversion_levels(model, tc, start)
                    diff += sum(eng[f] != ref[f] for f in model.functions)
                    total += 1
                rows.append({"source": case, "member": m, "scenarios": total, "differences": diff})
    rng = random.Random(SEED)
    for path in [*readers.library_models(), readers.grabbe_path(), *readers.private_models()]:
        model = readers.read_xfmv(path)
        fids = list(model.functions)
        scenarios = [{f: rng.randint(1, 3) for f in rng.sample(fids, rng.randint(1, min(3, len(fids))))}
                     for _ in range(RANDOM_SCENARIOS)]
        for m, tc in FAMILY.items():
            t = translate(model, tc)
            diff = 0
            for s in scenarios:
                eng, ref = levels(t, s), conversion_levels(model, tc, s)
                diff += sum(eng[f] != ref[f] for f in fids)
            rows.append({"source": path.stem, "member": m, "scenarios": len(scenarios), "differences": diff})
    return rows


def main() -> None:
    for name, fn in (("reference_check.csv", reference), ("ablation_rq1.csv", rq1),
                     ("ablation_claims.csv", claims)):
        rows = fn()
        with open(RESULTS / name, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(dict.fromkeys(k for r in rows for k in r)))
            w.writeheader()
            w.writerows(rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
