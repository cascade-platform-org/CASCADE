"""
Kim & Yoon's "F11 is the critical function", checked on our re-implementation of
their simulation (framkit.oracles.kim_simulate). It backs a footnote, not a finding.

  Fig. 8      Scenario 2, IEV_p x 0.9 and x 1.1 per function: % change in mean
              duration (paired trials, +- 1 SE) and how often a 20-trial run, the
              paper's size, puts each function in the top two.
  Tables 6-7  % of time points over theta per function in S1-S3, and its change.

Run from the repository root (about 4 min):
    CASCADE-backend/.venv/bin/python experiments/fram/check_kim.py
"""
from __future__ import annotations

import csv
import random
import statistics
from pathlib import Path

from framkit import readers
from framkit.oracles import kim_simulate

RESULTS = Path(__file__).resolve().parent / "results"
TRIALS = 3000
SCENARIOS = {1: (1.2, 1.2, 1.2), 2: (1.2, 1.2, 1.4), 3: (1.3, 1.3, 1.5)}   # Table 2: F3, F4, F5


def main() -> None:
    _, rows = readers.read_kim()
    scored = [r["function"] for r in rows if r["rule"]]
    base = {r["function"]: float(r["iev"]) for r in rows}

    def sigma(s):
        return base | dict(zip(("F3", "F4", "F5"), SCENARIOS[s]))

    def runs(sg):
        return [kim_simulate(rows, sg, random.Random(1000 + i)) for i in range(TRIALS)]   # paired by trial

    s2 = sigma(2)
    bd = [r["duration"] for r in runs(s2)]
    mean = statistics.mean(bd)
    out = {f: {"function": f} for f in scored}
    for factor in (0.9, 1.1):
        dur = {f: [r["duration"] for r in runs(s2 | {f: s2[f] * factor})] for f in scored}
        top2 = dict.fromkeys(scored, 0)
        blocks = TRIALS // 20
        for k in range(blocks):
            sl = slice(20 * k, 20 * k + 20)
            m0 = statistics.mean(bd[sl])
            for f in sorted(scored, key=lambda f: -abs(statistics.mean(dur[f][sl]) - m0))[:2]:
                top2[f] += 1
        for f in scored:
            diff = [p - q for p, q in zip(dur[f], bd)]
            out[f] |= {f"fig8_x{factor}_pct": round(100 * statistics.mean(diff) / mean, 1),
                       f"fig8_x{factor}_se": round(100 * statistics.stdev(diff) / TRIALS ** .5 / mean, 1),
                       f"fig8_x{factor}_top2_in_20_trials_pct": round(100 * top2[f] / blocks)}
    for s in SCENARIOS:
        rs = runs(sigma(s))
        steps = sum(r["duration"] for r in rs)
        for f in scored:
            out[f][f"t7_s{s}_pct"] = round(100 * sum(r["high"][f] for r in rs) / steps, 2)
    for f in scored:
        out[f]["t7_change_s1_s3"] = round(out[f]["t7_s3_pct"] - out[f]["t7_s1_pct"], 2)
    with open(RESULTS / "kim_f11_check.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[scored[0]]))
        w.writeheader()
        w.writerows(out.values())
    print(f"S2 mean duration {mean:.2f} (Table 5: 17.40)")
    for factor in (0.9, 1.1):
        rank = sorted(scored, key=lambda f: -abs(out[f][f"fig8_x{factor}_pct"]))
        print(f"x{factor}: " + " ".join(rank) + f"; F11 rank {rank.index('F11') + 1}")


if __name__ == "__main__":
    main()
