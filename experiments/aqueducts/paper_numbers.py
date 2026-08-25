#!/usr/bin/env python3
"""Every number the main paper's \\dtba placeholders need, from final_benchmark.csv.

Precision/recall use the paper's MACRO convention (per situation, then averaged,
vacuous cells credited 1 — Supp. Mat. S2). Bootstrap CIs (10^4 resamples) on
paired per-situation FMS differences for the null/reach margins.
Run: python3 paper_numbers.py
"""
from __future__ import annotations

import csv
import random
import statistics
from collections import defaultdict
from pathlib import Path

CSV = Path(__file__).with_name("final_benchmark.csv")
FAM = ["cluster", "targeted", "source", "tank"]
rows = list(csv.DictReader(CSV.open()))


def short(r):
    return r["network"].split("/")[-1].replace(".inp", "").replace("_totale", "")


def prf(rs, pre=""):
    """Critical-class precision/recall in the convention the PAPER reports:
    MACRO — computed inside each situation, then averaged over situations, so
    each failure is one unit of evidence regardless of network size.

    A situation whose ground truth holds no critical junction has undefined
    recall; we credit a predictor that correctly flags none with recall 1.
    Symmetrically, a predictor that flags nothing has precision 1. Both
    conventions are stated in Supp. Mat. S2 ("Metric aggregation"); 187 of the
    939 situations are vacuous this way.

    NOTE: an earlier revision pooled the confusion counts across situations
    (micro) and reported 0.682/0.950 where the paper now reports 0.729/0.944.
    `prf_micro` below keeps that reading available for comparison — the paper
    uses the macro figures this function returns.
    """
    ps, recs = [], []
    tp = fp = fn = 0
    for r in rs:
        t, f, n = int(r[pre + "tp"]), int(r[pre + "fp"]), int(r[pre + "fn"])
        tp, fp, fn = tp + t, fp + f, fn + n
        ps.append(t / (t + f) if t + f else 1.0)
        recs.append(t / (t + n) if t + n else 1.0)
    p = statistics.mean(ps) if ps else float("nan")
    rec = statistics.mean(recs) if recs else float("nan")
    return p, rec, tp, fp, fn


def prf_micro(rs, pre=""):
    """Superseded pooled-confusion reading, kept so the change is checkable."""
    tp = sum(int(r[pre + "tp"]) for r in rs)
    fp = sum(int(r[pre + "fp"]) for r in rs)
    fn = sum(int(r[pre + "fn"]) for r in rs)
    p = tp / (tp + fp) if tp + fp else float("nan")
    rec = tp / (tp + fn) if tp + fn else float("nan")
    return p, rec, tp, fp, fn


def mean(rs, k):
    return statistics.mean(float(r[k]) for r in rs)


def boot_ci(diffs, n=10000):
    rng = random.Random(0)
    m = len(diffs)
    means = sorted(statistics.mean(diffs[rng.randrange(m)] for _ in range(m)) for _ in range(n))
    return means[int(0.025 * n)], means[int(0.975 * n)]


print("=== POOLED (all 8) ===")
p, rec, tp, fp, fn = prf(rows)
print(f"pooled FMS={mean(rows,'fms'):.3f} null={mean(rows,'fms_null'):.3f} reach={mean(rows,'fms_reach'):.3f}")
print(f"module prec={p:.3f} recall={rec:.3f} |crit|={tp+fn}  reach recall={prf(rows,'reach_')[1]:.3f}")
print(f"n={len(rows)}")

dn = [float(r["fms"]) - float(r["fms_null"]) for r in rows]
dr = [float(r["fms"]) - float(r["fms_reach"]) for r in rows]
print(f"Δnull  mean={statistics.mean(dn):+.3f} CI={tuple(round(x,3) for x in boot_ci(dn))}")
print(f"Δreach mean={statistics.mean(dr):+.3f} CI={tuple(round(x,3) for x in boot_ci(dr))}")

print("\n=== BY FAMILY (FMS module/null/reach | |crit| prec recall | reach recall) ===")
byfam = defaultdict(list)
for r in rows:
    byfam[r["kind"]].append(r)
for f in FAM:
    rs = byfam[f]
    p, rec, tp, fp, fn = prf(rs)
    rr = prf(rs, "reach_")[1]
    print(f"{f:9s} FMS={mean(rs,'fms'):.3f} null={mean(rs,'fms_null'):.3f} reach={mean(rs,'fms_reach'):.3f}"
          f" | |crit|={tp+fn:6d} prec={p:.3f} recall={rec:.3f} | reachrec={rr:.3f}")

print("\n=== CTown per-family (FMS vs null) — for [C worst]/[C null] ===")
ct = [r for r in rows if short(r) == "CTown"]
byfam_ct = defaultdict(list)
for r in ct:
    byfam_ct[r["kind"]].append(r)
for f in FAM:
    rs = byfam_ct[f]
    if rs:
        print(f"  CTown {f:9s} FMS={mean(rs,'fms'):.3f} null={mean(rs,'fms_null'):.3f}")

# --- Ablations against the canonical uniform + no-priority run ------------------
# `rows` above is CANONICAL: uniform design-velocity capacity, no priority.
#  - PRIORITY arm: same capacity + cycle-aware contingency priority (recall knob)
#  - CAPACITY arm: the sweep drill, same (none) priority (does discovery help?)
# All arms cover the same 8 networks/seeds/situations, so totals are paired.
pc0, rc0, _, fpc0, _ = prf(rows)  # canonical uniform+none
PRIOR_CSV = Path(__file__).with_name("final_benchmark_priority.csv")
DRILL_CSV = Path(__file__).with_name("final_benchmark_drill.csv")
if PRIOR_CSV.exists():
    pr = list(csv.DictReader(PRIOR_CSV.open()))
    pp, rp, _, fpp, _ = prf(pr)
    print("\n=== PRIORITY as a recall knob (canonical none  vs  +contingency) ===")
    print(f"  canonical (no priority): precision={pc0:.3f} recall={rc0:.3f} FP={fpc0}")
    print(f"  + contingency priority : precision={pp:.3f} recall={rp:.3f} FP={fpp}")
    print(f"  -> recall {rc0:.2f}->{rp:.2f} (+{rp - rc0:.2f}); precision {pc0:.2f}->{pp:.2f} ({pp - pc0:+.2f}); "
          f"FP {fpc0}->{fpp} ({fpp - fpc0:+d})")
if DRILL_CSV.exists():
    dr = list(csv.DictReader(DRILL_CSV.open()))
    pd_, rd_, _, _, _ = prf(dr)
    def f1(p, r):
        return 2 * p * r / (p + r)

    print("\n=== CAPACITY ablation (uniform vs drill, both no-priority) ===")
    print(f"  uniform (canonical): P={pc0:.3f} R={rc0:.3f} F1={f1(pc0,rc0):.3f} FMS={mean(rows,'fms'):.3f}")
    print(f"  drill              : P={pd_:.3f} R={rd_:.3f} F1={f1(pd_,rd_):.3f} FMS={mean(dr,'fms'):.3f}")
