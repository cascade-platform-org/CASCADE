"""
The thresholds of the paper's §5 as the scale grows (TRANSLATION.md §4m,
declared at a535e8a).

Zheng and Koriyama at N = 4, 7, 10, 13 (damping absorbs exactly (N - 1)/3
levels, and the 4-level reading maps exactly). Each period of a Temporal
Simulation is one propagation of the state its Events impose, so the period
states are propagated directly: Zheng before and after the mutual aid, Koriyama
at one night hour (23:00) and one day hour (07:00), on fine grids of d and κ.
Checked against the app-run CSVs at N = 4 and 7.

  results/scale_limit_zheng.csv, scale_limit_koriyama.csv, scale_limit_thresholds.csv

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/scale_limit.py
"""
from __future__ import annotations

import csv
import itertools
from pathlib import Path

import decide_koriyama as dk
import decide_zheng as dz
from framkit.engine import propagate

RESULTS = Path(__file__).resolve().parent / "results"
SCALES = (4, 7, 10, 13)
D_FINE = [k / 100 for k in range(71)]
K_FINE = [k / 100 for k in range(1, 121)]


def zheng_state(t, intervention: str, n: int, s: int, d: float, aid: bool) -> dict[str, int]:
    ops = [(t.fn_node[x], ["functionality"], dz.level(n, s)) for x in (dz.RADIO, dz.NET)]
    ops.append(("other_areas", ["category_dependency_profiles", "crews", "demand"], round(dz.NEED * d)))
    if intervention == "I0":
        ops.append((t.fn_node["F5"], ["functionality"], dz.level(n, 3)))
    if intervention in ("I2", "I3"):
        ops.append(("mutual_aid", ["supply_capacity", "crews"], round(dz.NEED * d) if aid else 0))
    return propagate(dz.apply(t, ops))


def zheng() -> list[dict[str, object]]:
    rows = []
    for n, intervention in itertools.product(SCALES, dz.INTERVENTIONS):
        t = dz.build(intervention, n)
        f20, f17 = t.fn_node["F20"], t.fn_node["F17"]
        for s, d in itertools.product(dz.S_GRID, D_FINE):
            before = zheng_state(t, intervention, n, s, d, aid=False)
            after = zheng_state(t, intervention, n, s, d, aid=True) if intervention in ("I2", "I3") else before
            rows.append({"N": n, "intervention": intervention, "s": s, "d": d, "F17_before": before[f17],
                         "F20_before": before[f20], "F20_after": after[f20]})
    return rows


def koriyama() -> list[dict[str, object]]:
    rows = []
    for n, intervention, kappa in itertools.product(SCALES, dk.INTERVENTIONS, K_FINE):
        t = dk.build_flow(intervention, n, kappa)
        for assumption in dk.READINGS:
            for r in (dk.R if assumption == "B" else [1]):
                lv = {h: dk.hour(t, intervention, n, assumption, r, h) for h in (23, 31)}   # 23:00, 07:00
                rows.append({"N": n, "assumption": assumption, "intervention": intervention, "kappa": kappa,
                             "r": r, "T9_night": lv[23]["T9"], "T9_day": lv[31]["T9"]})
    return rows


def first_failing(xs: list[float], ok: list[bool]) -> str:
    """The smallest grid value from which `ok` is False to the end (or '-')."""
    for i in range(len(xs)):
        if not any(ok[i:]):
            return f"{xs[i]:.2f}" if i else "all"
    return "none"


def first_holding(xs: list[float], ok: list[bool]) -> str:
    """The smallest grid value from which `ok` is True to the end (or 'never')."""
    for i in range(len(xs)):
        if all(ok[i:]):
            return f"{xs[i]:.2f}"
    return "never"


def thresholds(zr: list[dict[str, object]], kr: list[dict[str, object]]) -> list[dict[str, object]]:
    out = []
    for n, intervention, s in itertools.product(SCALES, dz.INTERVENTIONS, dz.S_GRID):
        sel = [r for r in zr if r["N"] == n and r["intervention"] == intervention and r["s"] == s]
        for when in ("before", "after"):
            out.append({"case": "Zheng", "N": n, "variant": intervention, "condition": f"s={s}, {when} aid",
                        "measure": "F20 nominal fails from d =",
                        "value": first_failing(D_FINE, [r[f"F20_{when}"] == n for r in sel])})
    for n, intervention, assumption in itertools.product(SCALES, dk.INTERVENTIONS, dk.READINGS):
        for r in (dk.R if assumption == "B" else [1]):
            sel = [x for x in kr if x["N"] == n and x["intervention"] == intervention
                   and x["assumption"] == assumption and x["r"] == r]
            for when in ("night", "day"):
                out.append({"case": "Koriyama", "N": n, "variant": intervention,
                            "condition": f"{assumption}{'' if assumption == 'A' else f', r={r}'}, {when}",
                            "measure": "T9 nominal from kappa =",
                            "value": first_holding(K_FINE, [x[f"T9_{when}"] == n for x in sel])})
    return out


def check(zr: list[dict[str, object]], kr: list[dict[str, object]]) -> list[str]:
    """Differences from the app-run CSVs at N = 4 and 7 (grid points shared with them)."""
    bad = []
    z = {(r["N"], r["intervention"], r["s"], r["d"]): r for r in zr}
    with (RESULTS / "decision_scale.csv").open() as fh:
        for r in csv.DictReader(fh):
            k = (int(r["N"]), r["intervention"], int(r["s_at_N4"]), float(r["d"]))
            if (z[k]["F20_before"], z[k]["F20_after"]) != (int(r["F20_before"]), int(r["F20_after"])):
                bad.append(f"Zheng {k}: {z[k]['F20_before']}/{z[k]['F20_after']} vs {r['F20_before']}/{r['F20_after']}")
    kk = {(r["N"], r["assumption"], r["intervention"], r["kappa"], r["r"]): r for r in kr}
    idx_night, idx_day = dk.HOURS.index(23), dk.HOURS.index(31)
    with (RESULTS / "koriyama_capacity.csv").open() as fh:
        for r in csv.DictReader(fh):
            k = (int(r["N"]), r["assumption"], r["intervention"], float(r["kappa"]), float(r["r"]))
            hours = [int(v) for v in r["T9_by_hour"].split()]
            mine = kk[k]
            if (mine["T9_night"], mine["T9_day"]) != (hours[idx_night], hours[idx_day]):
                bad.append(f"Koriyama {k}")
    return bad


def write(name: str, rows: list[dict[str, object]]) -> None:
    with (RESULTS / name).open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"== {name}: {len(rows)} rows")


def main() -> None:
    zr, kr = zheng(), koriyama()
    write("scale_limit_zheng.csv", zr)
    write("scale_limit_koriyama.csv", kr)
    th = thresholds(zr, kr)
    write("scale_limit_thresholds.csv", th)
    bad = check(zr, kr)
    print("check against the app-run CSVs:", "identical" if not bad else f"{len(bad)} differences", bad[:10])
    for r in th:
        print(r)


if __name__ == "__main__":
    main()
