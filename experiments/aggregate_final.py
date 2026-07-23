#!/usr/bin/env python3
"""Aggregate experiments/final_benchmark.csv into the paper's headline tables.

Pools across all 8 networks. Reports, overall / per-family / per-network:
  - mean FMS (module) vs the null and reachability baselines,
  - binary critical-detection confusion (precision/recall/F1) for the module
    and for the reachability baseline (summed TP/FP/FN/TN across situations).

FMS is meaned over situations (matching the per-network AGGREGATE the harness
prints); binary metrics sum the confusion counts, so they are junction-weighted.
"""
from __future__ import annotations

import csv
import statistics
import sys
from collections import defaultdict
from pathlib import Path

CSV = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("final_benchmark.csv")
FAMILIES = ["cluster", "targeted", "tank", "source"]
NET_ORDER = ["Net1", "Net2", "Net3", "Cassacco", "Tarcento", "Zampis", "Modena", "CTown"]


def _short(net: str) -> str:
    base = net.split("/")[-1].replace(".inp", "")
    return base.replace("_totale", "").replace("Cassacco", "Cassacco")


def _prf(tp: float, fp: float, fn: float, tn: float) -> tuple[float, float, float, float]:
    prec = tp / (tp + fp) if (tp + fp) else float("nan")
    rec = tp / (tp + fn) if (tp + fn) else float("nan")
    f1 = 2 * prec * rec / (prec + rec) if prec and rec and (prec + rec) else float("nan")
    acc = (tp + tn) / (tp + fp + fn + tn) if (tp + fp + fn + tn) else float("nan")
    return prec, rec, f1, acc


class Acc:
    """Accumulates FMS lists and confusion sums for one bucket."""

    def __init__(self) -> None:
        self.fms: list[float] = []
        self.null: list[float] = []
        self.reach: list[float] = []
        self.c = [0, 0, 0, 0]      # module tp,fp,fn,tn
        self.rc = [0, 0, 0, 0]     # reach  tp,fp,fn,tn

    def add(self, row: dict) -> None:
        self.fms.append(float(row["fms"]))
        self.null.append(float(row["fms_null"]))
        self.reach.append(float(row["fms_reach"]))
        for i, k in enumerate(("tp", "fp", "fn", "tn")):
            self.c[i] += int(row[k])
        for i, k in enumerate(("reach_tp", "reach_fp", "reach_fn", "reach_tn")):
            self.rc[i] += int(row[k])

    def line(self, label: str) -> str:
        n = len(self.fms)
        fms = statistics.mean(self.fms) if n else float("nan")
        nul = statistics.mean(self.null) if n else float("nan")
        rea = statistics.mean(self.reach) if n else float("nan")
        p, r, f1, acc = _prf(*self.c)
        rp, rr, rf1, _ = _prf(*self.rc)
        return (
            f"{label:11s} n={n:4d} | FMS {fms:.3f} (null {nul:.3f} reach {rea:.3f}) | "
            f"module P={p:.3f} R={r:.3f} F1={f1:.3f} | reach P={rp:.3f} R={rr:.3f} F1={rf1:.3f}"
        )


def main() -> None:
    overall = Acc()
    by_family: dict[str, Acc] = defaultdict(Acc)
    by_net: dict[str, Acc] = defaultdict(Acc)
    by_net_family: dict[tuple[str, str], Acc] = defaultdict(Acc)

    with CSV.open() as fh:
        for row in csv.DictReader(fh):
            net = _short(row["network"])
            fam = row["kind"]
            overall.add(row)
            by_family[fam].add(row)
            by_net[net].add(row)
            by_net_family[(net, fam)].add(row)

    print("=" * 100)
    print("OVERALL (pooled across all 8 networks)")
    print("=" * 100)
    print(overall.line("ALL"))
    print()
    print("BY FAMILY")
    for fam in FAMILIES:
        if by_family[fam].fms:
            print(by_family[fam].line(fam))
    print()
    print("BY NETWORK")
    for net in NET_ORDER:
        if by_net[net].fms:
            print(by_net[net].line(net))
    print()
    print("BY NETWORK x FAMILY (FMS mean / module precision)")
    hdr = "network".ljust(11) + "".join(f"{f:>22s}" for f in FAMILIES)
    print(hdr)
    for net in NET_ORDER:
        cells = []
        for fam in FAMILIES:
            a = by_net_family[(net, fam)]
            if a.fms:
                p, *_ = _prf(*a.c)
                cells.append(f"{statistics.mean(a.fms):.3f}/P{p:.2f}".rjust(22))
            else:
                cells.append("-".rjust(22))
        print(net.ljust(11) + "".join(cells))


if __name__ == "__main__":
    main()
