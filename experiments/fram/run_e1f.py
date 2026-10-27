"""
E1f — second held-out case: Koriyama, Typhoon Hagibis 2019 (Togawa et al. 2023).
Declared in TRANSLATION.md before this run.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e1f.py
"""
from __future__ import annotations

import csv
from pathlib import Path

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.translate import default_config, resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4
RESONATED = ["T5", "T6", "T9"]
CONTAINED = ["T7", "T8"]
UNINVOLVED = ["T3", "T4"]
RED = {("T1", "T5"), ("T2", "T6"), ("T5", "T6"), ("T6", "T9")}
EVENT = {"T1": 3, "T2": 3, "X:Immediate environment": 3,
         "X:Function restricted during nighttime": 3, "X:Emergency call (119)": 3}


def main() -> None:
    model = readers.read_togawa()
    rows = []
    for sem, tc in (("S0_v0", default_config(N)), ("v2", resonance_config(mode="nested"))):
        for scen, ev in (("primary", EVENT), ("no_PC_deviation", {k: v for k, v in EVENT.items() if k not in ("T1", "T2")})):
            t = translate(model, tc)
            lv = function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in ev.items()}))
            flagged = {(c.source, c.target) for c in model.couplings
                       if not c.source.startswith("X:") and lv[c.source] < N and lv[c.target] < N}
            tp = len(flagged & RED)
            rows.append({
                "semantics": sem, "scenario": scen,
                "resonated_degraded": f"{sum(lv[f] < N for f in RESONATED)}/3",
                "contained_nominal": f"{sum(lv[f] == N for f in CONTAINED)}/2",
                "uninvolved_nominal": f"{sum(lv[f] == N for f in UNINVOLVED)}/2",
                "couplings_P/R": f"{tp / len(flagged) if flagged else 0:.2f}/{tp / len(RED):.2f}",
                "levels": " ".join(f"{f}:{lv[f]}" for f in sorted(model.functions) if not f.startswith("X:")),
            })
    with open(RESULTS / "e1f_koriyama.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
