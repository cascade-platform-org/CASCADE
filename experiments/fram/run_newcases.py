"""
The two new held-out cases (TRANSLATION.md §4g, declared at 43b0532): Adhita &
Furusho 2021 (two encounters, scored as one case) and Nayak et al. 2022, under
every member of the ablation family, at the declared event coding and over all
codings; then the §4c decision rule among v2, v2+3 and v2+c.

  results/newcases_rq1.csv

Run from the repository root (needs the private transcriptions):
    CASCADE-backend/.venv/bin/python experiments/fram/run_newcases.py
"""
from __future__ import annotations

import csv
import itertools
import statistics
from pathlib import Path

from framkit import readers
from framkit.translate import fmi_config, translate
from run_ablation import FAMILY, MEMBERS, event_for
from run_rq1 import levels

RESULTS = Path(__file__).resolve().parent / "results"

ADHITA_AFFECTED = ["BCM_A", "WAT_A", "WAT_B", "ECN_B", "MAN_B"]       # encounter 2
ADHITA_UNAFFECTED = ["BCM_A", "BCM_C", "WAT_A", "BBC_A"]             # encounter 1
ADHITA_E1 = {"MAN_A": 3}
ADHITA_E2 = {"MAN_A": 3, "BCM_B": 3}
ADHITA_E2_B = {"MAN_A": 3, "BCM_B": 3, "WAT_A": 3}                  # reading B

REG = "X:Understanding of Regulation (EC) 2160/2003 of the European Parliament"
NAYAK_EVENT = {REG: 3, "X:Disapproved disinfectants": 1, "X:Paperwork is available and completed": 1,
               "X:Cleaning chemicals disapproved": 1, "N4.8": 3}
NAYAK_AFFECTED = ["N4.1", "N4.2", "N4.3", "N4.4", "N4.5", "N4.9", "N4.10"]
NAYAK_UNAFFECTED = ["N1.3", "N1.7", "N1.8", "N1.9", "N1.11", "N2.1", "N2.2", "N2.3", "N2.4", "N2.5",
                    "N3.2", "N3.3", "N3.4", "N3.5", "N3.6", "N3.10", "N3.13", "N3.15"]

DECISION = ["v2", "v2+3", "v2+c"]                                    # simpler first (§4c)


def translated(model, member: str):
    """The member's translation and scale: FMI on N = 2, the family on N = 4."""
    return (translate(model, fmi_config()), 2) if member == "FMI" else (translate(model, FAMILY[member]), 4)


def balanced(recall: float, specificity: float) -> float:
    return (recall + specificity) / 2


def adhita(member: str, reading_b: bool = False) -> tuple[float, list[float], dict[str, int], dict[str, int]]:
    """Balanced accuracy at the declared coding, over all codings, and the declared levels."""
    (t1, n), (t2, _) = translated(readers.read_adhita(1), member), translated(readers.read_adhita(2), member)
    e2 = ADHITA_E2_B if reading_b else ADHITA_E2
    affected = [f for f in ADHITA_AFFECTED if f not in e2]

    def score(c1: dict[str, int], c2: dict[str, int]) -> tuple[float, dict[str, int], dict[str, int]]:
        lv1, lv2 = levels(t1, event_for(member, c1)), levels(t2, event_for(member, c2))
        rec = statistics.mean(lv2[f] < n for f in affected)
        spe = statistics.mean(lv1[f] == n for f in ADHITA_UNAFFECTED)
        return balanced(rec, spe), lv1, lv2

    at, lv1, lv2 = score(ADHITA_E1, e2)
    keys = list(e2)
    grid = [score({"MAN_A": a}, dict(zip(keys, combo)))[0]
            for a in (1, 2, 3) for combo in itertools.product((1, 2, 3), repeat=len(keys))]
    return at, grid, lv1, lv2


def nayak(member: str) -> tuple[float, list[float], dict[str, int]]:
    t, n = translated(readers.read_nayak(), member)

    def score(ev: dict[str, int]) -> tuple[float, dict[str, int]]:
        lv = levels(t, event_for(member, ev))
        return balanced(statistics.mean(lv[f] < n for f in NAYAK_AFFECTED),
                        statistics.mean(lv[f] == n for f in NAYAK_UNAFFECTED)), lv

    at, lv = score(NAYAK_EVENT)
    keys = list(NAYAK_EVENT)
    grid = [score(dict(zip(keys, combo)))[0] for combo in itertools.product((1, 2, 3), repeat=len(keys))]
    return at, grid, lv


def existing() -> dict[str, dict[str, float]]:
    """The four earlier cases at the declared coding, from results/ablation_rq1.csv."""
    out: dict[str, dict[str, float]] = {}
    with (RESULTS / "ablation_rq1.csv").open() as fh:
        for r in csv.DictReader(fh):
            if r["case"] in ("Zheng", "Tian", "Wenzhou", "Koriyama"):
                out.setdefault(r["member"], {})[r["case"]] = float(r["declared"])
    return out


def main() -> None:
    rows, details = [], {}
    for m in MEMBERS:
        a_at, a_grid, lv1, lv2 = adhita(m)
        b_at, b_grid, _, _ = adhita(m, reading_b=True)
        n_at, n_grid, nlv = nayak(m)
        details[m] = (lv1, lv2, nlv)
        for case, at, grid in (("Adhita", a_at, a_grid), ("Adhita (reading B)", b_at, b_grid), ("Nayak", n_at, n_grid)):
            rows.append({"case": case, "member": m, "declared": round(at, 3),
                         "grid_mean": round(statistics.mean(grid), 3), "grid_min": round(min(grid), 3),
                         "codings": len(grid)})
    old = existing()
    by = {(r["case"], r["member"]): r for r in rows}
    for m in MEMBERS:
        six = [old[m][c] for c in ("Zheng", "Tian", "Wenzhou", "Koriyama")] + \
              [by[("Adhita", m)]["declared"], by[("Nayak", m)]["declared"]]
        rows.append({"case": "mean of six (declared)", "member": m, "declared": round(statistics.mean(six), 3),
                     "grid_mean": "-", "grid_min": "-", "codings": "-"})
    RESULTS.mkdir(exist_ok=True)
    with (RESULTS / "newcases_rq1.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    def cell(case: str, m: str) -> str:
        return "{declared:.2f} ({grid_mean:.2f}/{grid_min:.2f})".format(**by[(case, m)])

    print(f"{'member':10} {'Adhita':>18} {'Adhita B':>18} {'Nayak':>18} {'six':>6}")
    for m in MEMBERS:
        print(f"{m:10} {cell('Adhita', m):>18} {cell('Adhita (reading B)', m):>18} {cell('Nayak', m):>18} "
              f"{next(r['declared'] for r in rows if r['case'].startswith('mean') and r['member'] == m):>6}")
    new_mean = {m: statistics.mean([by[("Adhita", m)]["declared"], by[("Nayak", m)]["declared"]]) for m in DECISION}
    best = max(new_mean.values())
    winner = next(m for m in DECISION if new_mean[m] >= best - 1e-9)
    print("decision rule (§4c), mean over the new cases:", {m: round(v, 3) for m, v in new_mean.items()}, "->", winner)

    lv1, lv2, nlv = details["v2"]
    print("v2 Adhita E1:", {f: lv1[f] for f in ADHITA_UNAFFECTED}, " E2:", {f: lv2[f] for f in ADHITA_AFFECTED})
    print("v2 Nayak affected:", {f: nlv[f] for f in NAYAK_AFFECTED})
    print("v2 Nayak unaffected below nominal:", {f: nlv[f] for f in NAYAK_UNAFFECTED if nlv[f] < 4})


if __name__ == "__main__":
    main()
