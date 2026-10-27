"""
Sensitivity: cumulative worsening (TRANSLATION.md §4a, declared at d3312fa).
Every N = 4 run under v2 repeated with v2+3 (the third coinciding deviation costs
one more level) and v2+c (every further one does), beside v2.

  results/cumulative_rq1.csv     RQ1 scores per case and variant
  results/cumulative_claims.csv  the claims run on v2, verdict per variant

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_cumulative.py
"""
from __future__ import annotations

import csv
from contextlib import contextmanager
from pathlib import Path

import run_rq1
import run_rq2
from framkit.translate import cumulative_config, resonance_config

RESULTS = Path(__file__).resolve().parent / "results"
VARIANTS = {"v2": resonance_config, "v2+3": lambda: cumulative_config(3), "v2+c": lambda: cumulative_config(4)}
CLAIMS = {"C1", "C2", "C4", "C5", "C6", "C8", "C9", "C10", "C12", "C14"}


@contextmanager
def variant(name: str):
    """The RQ2 runners build their translation with resonance_config(): swap it."""
    saved = run_rq2.resonance_config
    run_rq2.resonance_config = VARIANTS[name]
    try:
        yield
    finally:
        run_rq2.resonance_config = saved


def main() -> None:
    run_rq1.SEMANTICS.update(VARIANTS)
    rq1 = [{"case": case, "variant": v, **fn(v)} for case, _, fn in run_rq1.CASES for v in VARIANTS]
    claims: dict[str, dict[str, str]] = {}
    for v in VARIANTS:
        with variant(v):
            for r in run_rq2.claims():
                if r["id"] in CLAIMS:
                    claims.setdefault(r["id"], {"id": r["id"], "paper": r["paper"], "direction": r["direction"]})
                    claims[r["id"]] |= {v: r["verdict"], f"{v} detail": r["detail"]}
    for name, rows in (("cumulative_rq1.csv", rq1), ("cumulative_claims.csv", list(claims.values()))):
        with open(RESULTS / name, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
