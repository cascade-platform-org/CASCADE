#!/usr/bin/env python3
"""Write publishable copies of the benchmark results into `results/`.

The raw CSVs this harness produces carry the real `.inp` export path in their
`network` column. The three Italian aqueducts behind those exports are
proprietary utility data and are referred to in the paper only as Aqueduct
A/B/C, so the raw CSVs are gitignored and never committed.

This script rewrites that one column to the published alias and copies the
result into `results/`, which IS tracked — those are the per-situation CSVs the
paper's Data and Code Availability statement promises, and every table in the
paper and the Supplementary Material can be recomputed from them.

Nothing else in the files is identifying: the remaining columns are the
situation label (`cluster#7`), the scores, and the confusion counts.

Run:  python experiments/aqueducts/anonymize_results.py
"""
from __future__ import annotations

import csv
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(_HERE, "results")

# Export stem -> published alias. Public benchmarks keep their own names.
ALIAS = {
    "Cassacco_totale": "Aqueduct A",
    "Tarcento_totale": "Aqueduct B",
    "Zampis": "Aqueduct C",
    "CTown": "C-Town",
}

SOURCES = [
    "final_benchmark.csv",
    "final_benchmark_drill.csv",
    "final_benchmark_priority.csv",
    "final_benchmark_drill_priority.csv",
    "orientation_ablation.csv",
]


def alias(raw: str) -> str:
    """Map one `network` cell to its published name, path or bare stem alike."""
    stem = os.path.basename(raw)
    if stem.lower().endswith(".inp"):
        stem = stem[: -len(".inp")]
    return ALIAS.get(stem, stem)


def anonymize(name: str) -> tuple[int, int]:
    """Rewrite one CSV into `results/`. Returns (rows, cells rewritten)."""
    src = os.path.join(_HERE, name)
    with open(src, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames or []
        if "network" not in fields:
            raise SystemExit(f"{name}: no 'network' column — refusing to publish it")
        rows = list(reader)

    changed = 0
    for row in rows:
        new = alias(row["network"])
        if new != row["network"]:
            changed += 1
        row["network"] = new

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name), "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return len(rows), changed


def main() -> None:
    wrote = False
    for name in SOURCES:
        if not os.path.exists(os.path.join(_HERE, name)):
            print(f"  skip   {name} (not present)")
            continue
        n, changed = anonymize(name)
        print(f"  wrote  results/{name}  ({n} rows, {changed} network cells aliased)")
        wrote = True
    if not wrote:
        sys.exit("No source CSVs found — run the benchmark first.")

    # Guard: refuse to leave a real name in a file that is about to be tracked.
    leaked = []
    for name in sorted(os.listdir(OUT_DIR)):
        with open(os.path.join(OUT_DIR, name), encoding="utf-8") as fh:
            text = fh.read().lower()
        for real in ALIAS:
            if real.lower() in text:
                leaked.append(f"{name}: {real}")
    if leaked:
        sys.exit("ANONYMIZATION FAILED — real names still present: " + ", ".join(leaked))
    print("  check  no real export name remains in results/")


if __name__ == "__main__":
    main()
