"""
V1 — verification of the translation (PLAN §4.4, §6).

(a) FMI. For every model in the FMV library plus Grabbe 2022 (285 functions,
    non-default profiles), run the baseline, every single-function knockout and
    200 random knockout pairs. In each scenario compare the set of functions
    CASCADE leaves operational (N = 2, FMI mode) with
      - the greatest fixed point of the FMI activation operator (P1/P3: CASCADE
        should equal it exactly, cycles included), and
      - the least fixed point, i.e. the FMI's own run (P1: equal on acyclic
        models; P3: may differ on cycles).
(b) Fault tree. Khakzad 2011's feed-control tree as a CASCADE model (series =
    worst_of across outputs, parallel = same-named alternatives = best_of);
    enumerate all 2^7 basic-event scenarios and weight them by probability.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_v1.py
"""
from __future__ import annotations

import csv
import itertools
import random
from pathlib import Path

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.model import FramModel
from framkit.oracles import KHAKZAD_AUTO, KHAKZAD_BASIC, KHAKZAD_MANUAL, activation, khakzad_top_event
from framkit.translate import fmi_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
SEED = 20261026
PAIRS = 200


def fmi_check(model: FramModel) -> dict[str, object]:
    t = translate(model, fmi_config())
    fids = list(model.functions)
    rng = random.Random(SEED)
    scenarios: list[tuple[str, ...]] = [()] + [(f,) for f in fids]
    if len(fids) >= 2:
        scenarios += [tuple(rng.sample(fids, 2)) for _ in range(PAIRS)]
    eq_gfp = eq_lfp = 0
    divergent: set[str] = set()
    for ko in scenarios:
        levels = function_levels(t, propagate(t, {t.fn_node[f]: 1 for f in ko}))
        cascade = {f for f, lv in levels.items() if lv == 2}
        gfp = activation(model, set(ko), "full")
        lfp = activation(model, set(ko), "empty")
        eq_gfp += cascade == gfp
        eq_lfp += cascade == lfp
        divergent |= cascade ^ lfp
    return {
        "model": model.name,
        "functions": len(fids),
        "couplings": len(model.couplings),
        "acyclic": model.is_acyclic(),
        "non_default_profiles": sum(bool(f.profiles) for f in model.functions.values()),
        "scenarios": len(scenarios),
        "cascade_eq_gfp": eq_gfp,
        "cascade_eq_fmi": eq_lfp,
        "functions_diverging_from_fmi": len(divergent),
    }


def khakzad_model() -> FramModel:
    m = FramModel("khakzad_2011_feed_control")
    for e in KHAKZAD_BASIC:
        m.add_function(e, e)
    for f in ("auto", "manual", "feed"):
        m.add_function(f, f)
    for e in KHAKZAD_AUTO:            # OR of failures = all needed = worst_of
        m.add_coupling(e, f"{e} working", "auto", "I")
    for e in KHAKZAD_MANUAL:
        m.add_coupling(e, f"{e} working", "manual", "I")
    for branch in ("auto", "manual"):  # AND of failures = alternatives = best_of
        m.add_coupling(branch, "valve control", "feed", "I")
    return m


def fault_tree_check() -> tuple[float, float]:
    m = khakzad_model()
    t = translate(m, fmi_config())
    p_top = 0.0
    events = list(KHAKZAD_BASIC)
    for failed in itertools.product((False, True), repeat=len(events)):
        prob = 1.0
        ko = {}
        for e, f in zip(events, failed):
            prob *= KHAKZAD_BASIC[e] if f else 1 - KHAKZAD_BASIC[e]
            if f:
                ko[t.fn_node[e]] = 1
        if function_levels(t, propagate(t, ko))["feed"] == 1:
            p_top += prob
    return p_top, khakzad_top_event()


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    rows = []
    for path in readers.library_models() + [readers.grabbe_path()]:
        model = readers.read_xfmv(path)
        if not model.couplings:
            continue
        row = fmi_check(model)
        rows.append(row)
        print(row)
    with open(RESULTS / "v1_fmi.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    cascade_p, closed_form = fault_tree_check()
    with open(RESULTS / "v1_fault_tree.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["case", "cascade_enumeration", "closed_form", "published"])
        w.writerow(["khakzad_2011", f"{cascade_p:.6f}", f"{closed_form:.6f}", "0.2720"])
    print(f"Khakzad top event: CASCADE {cascade_p:.6f}, closed form {closed_form:.6f}, published 0.2720")


if __name__ == "__main__":
    main()
