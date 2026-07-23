#!/usr/bin/env python3
"""Every number the main paper's \\dtba placeholders need, from final_benchmark.csv.

Bootstrap CIs (10^4 resamples) on paired per-situation FMS differences for the
null/reach margins. Run: python3 paper_numbers.py
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
