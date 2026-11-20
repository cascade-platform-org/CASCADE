"""
How much the six RQ1 cases establish (TRANSLATION.md §4l, declared at a535e8a).

Every member of the §4c family on the six cases at the declared coding, without
Specific Rules (as the paper's Fig. 2 scores them); one prediction per labelled
item. Then: exact chance baselines, credible intervals, paired comparisons with
v2, fragility to label flips, and leave-one-case-out rule selection.

  results/rq1_items.csv, rq1_norules.csv, rq1_stats.csv, rq1_paired.csv,
  rq1_fragility.csv, rq1_loco.csv; post hoc: rq1_case_signs.csv

Run from the repository root (needs the private transcriptions):
    CASCADE-backend/.venv/bin/python experiments/fram/run_stats.py
"""
from __future__ import annotations

import csv
import math
import statistics
from pathlib import Path

import numpy as np

import run_newcases as nc
import run_rq2
from framkit import readers
from framkit.model import ASPECTS
from framkit.stats import (counts, fisher, fragility, jeffreys_ba, null_p, paired_bootstrap,
                           pooled_null_p)
from framkit.translate import TranslationConfig, translate
from run_ablation import GRID_CASES, MEMBERS, build, event_for, no_description_rules
from run_rq1 import TIAN_TRUTH, levels

RESULTS = Path(__file__).resolve().parent / "results"
SEED = 20261120
CASES = ("Zheng", "Tian", "Li", "Togawa", "Adhita", "Nayak")       # the paper's names
GRID_NAME = {"Zheng": "Zheng", "Li": "Wenzhou", "Togawa": "Koriyama"}
REACH = TranslationConfig(n=4, dep={a: 4 for a in ASPECTS})        # pure reachability (null b)
MAX_FLIPS = 3

Row = tuple[str, bool, bool, bool]          # (item, affected, predicted, reachable)


def grid_items(case: str, member: str) -> list[Row]:
    builder, degraded, nominal = GRID_CASES[GRID_NAME[case]]
    with no_description_rules():
        (_, t, declared), n = build(member, builder)
        _, tr, _ = builder(REACH)
    lv = levels(t, event_for(member, declared))
    reach = levels(tr, declared)
    return [(f, f in degraded, lv[f] < n, reach[f] < 4) for f in [*degraded, *nominal]]


def tian_items(member: str) -> list[Row]:
    with no_description_rules():
        (_, t, _), n = build(member, lambda tc: run_rq2.tian_case(tc=tc))
    rows = []
    for (f7, bosun), violates in TIAN_TRUTH.items():
        start = {"F7": f7, "F1": 4} | ({"F2": 1} if bosun == "absent" else {})
        lv = levels(t, event_for(member, start))
        rows.append((f"F7={f7},bosun {bosun}", violates, lv["F2"] < n and lv["F5"] < n and lv["F8"] < n, True))
    return rows


def adhita_items(member: str) -> list[Row]:
    m1, m2 = readers.read_adhita(1), readers.read_adhita(2)
    (t1, n), (t2, _) = nc.translated(m1, member), nc.translated(m2, member)
    lv1, lv2 = levels(t1, event_for(member, nc.ADHITA_E1)), levels(t2, event_for(member, nc.ADHITA_E2))
    r1, r2 = levels(translate(m1, REACH), nc.ADHITA_E1), levels(translate(m2, REACH), nc.ADHITA_E2)
    affected = [f for f in nc.ADHITA_AFFECTED if f not in nc.ADHITA_E2]
    return ([(f"E2:{f}", True, lv2[f] < n, r2[f] < 4) for f in affected]
            + [(f"E1:{f}", False, lv1[f] < n, r1[f] < 4) for f in nc.ADHITA_UNAFFECTED])


def nayak_items(member: str) -> list[Row]:
    model = readers.read_nayak()
    t, n = nc.translated(model, member)
    lv = levels(t, event_for(member, nc.NAYAK_EVENT))
    reach = levels(translate(model, REACH), nc.NAYAK_EVENT)
    return [(f, f in nc.NAYAK_AFFECTED, lv[f] < n, reach[f] < 4)
            for f in [*nc.NAYAK_AFFECTED, *nc.NAYAK_UNAFFECTED]]


def items(case: str, member: str) -> list[Row]:
    if case in GRID_NAME:
        return grid_items(case, member)
    return {"Tian": tian_items, "Adhita": adhita_items, "Nayak": nayak_items}[case](member)


def write(name: str, rows: list[dict[str, object]]) -> None:
    with (RESULTS / name).open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(dict.fromkeys(k for r in rows for k in r)))
        w.writeheader()
        w.writerows(rows)
    print(f"== {name}")
    for r in rows:
        print(r)


def ci(x: np.ndarray) -> str:
    lo, hi = np.quantile(x, [0.025, 0.975])
    return f"[{lo:.2f}, {hi:.2f}]"


def main() -> None:
    rng = np.random.default_rng(SEED)
    data = {(c, m): items(c, m) for c in CASES for m in MEMBERS}
    for c in CASES:                                    # item order is the same for every member
        assert len({tuple(r[0] for r in data[(c, m)]) for m in MEMBERS}) == 1, c

    write("rq1_items.csv", [{"case": c, "member": m, "item": i, "affected": a, "predicted": p, "reachable": r}
                            for (c, m), rows in data.items() for i, a, p, r in rows])

    cnt = {k: counts([(a, p) for _, a, p, _ in rows]) for k, rows in data.items()}
    norules = []
    for m in MEMBERS:
        row = {"member": m}
        for c in CASES:
            row[c] = round(cnt[(c, m)].ba(), 3)
        row["mean"] = round(statistics.mean(cnt[(c, m)].ba() for c in CASES), 3)
        norules.append(row)
    write("rq1_norules.csv", norules)

    # 1-2. chance baselines and credible intervals
    stats = []
    for m in MEMBERS:
        ps_a, ps_b, pools_b, subset = [], [], [], True
        post = np.zeros(40_000)
        for c in CASES:
            k = cnt[(c, m)]
            rows = data[(c, m)]
            reach_pos = sum(a for _, a, _, r in rows if r)
            reach_neg = sum(not a for _, a, _, r in rows if r)
            if c == "Tian":
                reach_pos, reach_neg = k.pos, k.neg
            within = all(r for _, _, p, r in rows if p) or c == "Tian"
            subset &= within
            pa = null_p(k)
            pb = null_p(k, reach_pos, reach_neg) if within else float("nan")
            draws = jeffreys_ba(k, 40_000, rng)
            post += draws / len(CASES)
            ps_a.append(pa)
            ps_b.append(pb)
            pools_b.append((reach_pos, reach_neg))
            stats.append({"member": m, "case": c, "ba": round(k.ba(), 3),
                          "tp/pos": f"{k.tp}/{k.pos}", "tn/neg": f"{k.tn}/{k.neg}", "marked": k.marked,
                          "reachable pos/neg": f"{reach_pos}/{reach_neg}",
                          "p_random": round(pa, 4), "p_reachable": round(pb, 4) if within else "-",
                          "credible_95": ci(draws)})
        cases = [cnt[(c, m)] for c in CASES]
        stats.append({"member": m, "case": "six-case mean",
                      "ba": round(statistics.mean(k.ba() for k in cases), 3),
                      "p_random": f"{pooled_null_p(cases, [(k.pos, k.neg) for k in cases], 200_000, rng):.1e}",
                      "p_reachable": f"{pooled_null_p(cases, pools_b, 200_000, rng):.1e}" if subset else "-",
                      "credible_95": ci(post),
                      "fisher_random": f"{fisher(ps_a):.1e}",
                      "fisher_reachable": f"{fisher(ps_b):.1e}" if subset else "-"})
    write("rq1_stats.csv", stats)

    # 3-4. paired comparison and fragility against v2
    paired, frag = [], []
    for m in MEMBERS:
        if m == "v2":
            continue
        triples = []
        for c in CASES:
            v, o = data[(c, "v2")], data[(c, m)]
            triples.append(([a for _, a, _, _ in v], [p for _, _, p, _ in v], [p for _, _, p, _ in o]))
        diff = paired_bootstrap(triples, 10_000, rng)
        obs = statistics.mean(cnt[(c, "v2")].ba() - cnt[(c, m)].ba() for c in CASES)
        lo, hi = np.quantile(diff, [0.025, 0.975])
        paired.append({"member": m, "v2_minus_member": round(obs, 3), "ci_95": f"[{lo:.3f}, {hi:.3f}]",
                       "share_v2_higher": round(float(np.mean(diff > 1e-12)), 3),
                       "rq1_supported": bool(lo <= 0 <= hi) or obs <= 0})
        f = fragility([[(a, pa, pb) for a, pa, pb in zip(*t)] for t in triples], MAX_FLIPS)
        frag.append({"member": m, "flips_to_reach_v2": f if f is not None else f"> {MAX_FLIPS}"})
    write("rq1_paired.csv", paired)

    # POST HOC (not in §4l): the cases themselves as the unit. Per member, in how many
    # cases v2 scores higher, lower or the same, and the exact one-sided sign-test p.
    signs = []
    for m in MEMBERS:
        if m == "v2":
            continue
        d = [cnt[(c, "v2")].ba() - cnt[(c, m)].ba() for c in CASES]
        up, down = sum(x > 1e-12 for x in d), sum(x < -1e-12 for x in d)
        k = up + down
        p = sum(math.comb(k, j) for j in range(up, k + 1)) / 2 ** k if k else 1.0
        signs.append({"member": m, "v2_higher": up, "v2_lower": down, "tied": len(d) - k,
                      "sign_test_p_one_sided": round(p, 3),
                      "per_case": " ".join(f"{c}:{x:+.2f}" for c, x in zip(CASES, d))})
    write("rq1_case_signs.csv", signs)

    # 4-5. leave one case out: is v2 top, and the selection procedure
    order = MEMBERS
    loco, chosen_scores = [], []
    for held in CASES:
        rest = [c for c in CASES if c != held]
        means = {m: statistics.mean(cnt[(c, m)].ba() for c in rest) for m in order}
        best = max(means.values())
        pick = next(m for m in order if means[m] >= best - 1e-12)
        chosen_scores.append(cnt[(held, pick)].ba())
        loco.append({"held_out": held, "chosen": pick, "chosen_mean_on_rest": round(means[pick], 3),
                     "v2_mean_on_rest": round(means["v2"], 3),
                     "v2_top_on_rest": means["v2"] >= best - 1e-12,
                     "chosen_score_on_held_out": round(cnt[(held, pick)].ba(), 3),
                     "v2_score_on_held_out": round(cnt[(held, "v2")].ba(), 3)})
    loco.append({"held_out": "mean", "chosen_score_on_held_out": round(statistics.mean(chosen_scores), 3),
                 "v2_score_on_held_out": round(statistics.mean(cnt[(c, "v2")].ba() for c in CASES), 3)})
    write("rq1_loco.csv", loco)
    write("rq1_fragility.csv", frag)


if __name__ == "__main__":
    main()
