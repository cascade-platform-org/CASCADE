"""
E1c — EXPLORATORY fidelity study after the v1 run (not frozen; informs Gate 1).

1. Nested-rule emulation of resonance (existing rule types only) vs the
   compiled Specific Rules: must be identical.
2. Wider Functionality scale on Zheng: N in {4, 7, 10}, damping Delta levels,
   qualitative severities mapped as fractions of the scale, and the
   common-cause refinement (independent pairs).
3. Tian with the rules written from the paper (F5 from the text, F2 from Table 3).
4. Kaya on a wide scale: the output's exceedance probability graded onto
   N = 10 levels; functions ranked by expected deficit.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e1c.py
"""
from __future__ import annotations

import csv
import itertools
import math
import random
import re
from pathlib import Path

import run_e1
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.oracles import e_factor, spc_scenarios
from framkit.translate import TranslationConfig, default_config, resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"


def level(frac: float, n: int) -> int:
    """Deficit fraction of the scale -> level (0 = nominal, 1 = not performed)."""
    return max(1, min(n, math.floor(n - frac * (n - 1) + 0.5)))


def equivalence() -> list[dict[str, object]]:
    rng = random.Random(1)
    rows = []
    for model in (readers.read_zheng(), readers.read_tian(), readers.read_kaya()[0], readers.read_smith()):
        ts = {k: translate(model, resonance_config(mode=k)) for k in ("rules", "nested")}
        fids, bad = list(model.functions), 0
        for _ in range(200):
            start = {f: rng.randint(1, 4) for f in rng.sample(fids, 3)}
            res = {k: function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))
                   for k, t in ts.items()}
            bad += res["rules"] != res["nested"]
        rows.append({"model": model.name, "scenarios": 200, "mismatches": bad})
    return rows


def zheng() -> list[dict[str, object]]:
    truth = readers.zheng_judgements()
    neg = [f for f, j in truth.items() if j == "negative"]
    pos = [f for f, j in truth.items() if j == "positive"]
    model = readers.read_zheng()
    rows = []
    grid = itertools.product((4, 7, 10), (1, 2, 3), (1 / 3, 1 / 2, 2 / 3), (False, True))
    for n, delta, comms, indep in grid:
        if delta >= n - 1:
            continue
        tc = resonance_config(n=n, damping=delta, mode="nested")
        tc.independent_pairs = indep
        t = translate(model, tc)
        start = {t.fn_node["X:Radio/Telephone"]: level(comms, n),
                 t.fn_node["X:Internet/Telephone"]: level(comms, n),
                 t.fn_node["X:Firetruck; firefighter; PPE, SCBAS, etc."]: level(1 / 3, n),
                 t.fn_node["F5"]: level(1 / 3, n)}
        lv = function_levels(t, propagate(t, start))
        tp = sum(lv[f] < n for f in neg)
        tn = sum(lv[f] == n for f in pos)
        rows.append({"N": n, "damping": delta, "comms_deficit": round(comms, 2),
                     "independent_pairs": indep, "neg": f"{tp}/8", "pos": f"{tn}/8",
                     "balanced_acc": round((tp / 8 + tn / 8) / 2, 3),
                     "wrong": " ".join(sorted([f for f in neg if lv[f] == n] +
                                              [f for f in pos if lv[f] < n], key=lambda x: int(x[1:])))})
    return rows


TIAN_TRUTH = {(4, "present"): False, (4, "absent"): False, (3, "present"): True,
              (3, "absent"): True, (2, "present"): True, (2, "absent"): True}


def tian() -> list[dict[str, object]]:
    model = readers.read_tian()
    rows = []
    variants = {"S0_v0": default_config(4), "S2_nested": resonance_config(mode="nested")}
    for (name, tc), rules in itertools.product(variants.items(), ("none", "F5", "F5+F2")):
        t = translate(model, tc)
        f7 = t.fn_node["F7"]
        add = {"F5": [], "F5+F2": ["F2"]}.get(rules, [])
        if rules != "none":
            add = ["F5"] + add
        for f in add:
            node = t.project.nodes[t.fn_node[f]]
            t.project.nodes[t.fn_node[f]] = node.model_copy(update={"rules": (node.rules or []) + [
                f"if {f7}.functionality is <4 then {t.fn_node[f]} is not performed"]})
        correct, spurious = 0, 0
        for f7l, bosun, f1 in itertools.product((4, 3, 2), ("present", "absent"), (4, 3)):
            start = {f7: f7l, t.fn_node["F1"]: f1}
            if bosun == "absent":
                start[t.fn_node["F2"]] = 1
            lv = function_levels(t, propagate(t, start))
            violated = lv["F2"] < 4 and lv["F5"] < 4 and lv["F8"] < 4
            if f1 == 4:
                correct += violated == TIAN_TRUTH[(f7l, bosun)]
            elif violated and f7l == 4:
                spurious += 1   # late loading alone: not among the paper's scenarios
        rows.append({"semantics": name, "rules": rules, "scenarios_correct": f"{correct}/6",
                     "late_loading_alone_violates": spurious})
    return rows


def kaya_graded(n: int = 10) -> list[dict[str, object]]:
    model, rows = readers.read_kaya()
    rows = [r for r in rows if r["downstream"].strip() != "N/A"]
    workshop = {"F1", "F2", "F8", "F9"}
    out = []
    variants = {"S0_v0": default_config(n), "S2_d1": resonance_config(n=n, damping=1, mode="nested"),
                "S2_d2": resonance_config(n=n, damping=2, mode="nested")}
    for name, tc in variants.items():
        t = translate(model, tc)
        outputs_of: dict[str, set[str]] = {}
        for (src, _), onode in t.out_node.items():
            outputs_of.setdefault(src, set()).add(onode)
        deficit = {f: 0.0 for f in outputs_of}
        for spc, prob in spc_scenarios():
            start: dict[str, int] = {}
            for r in rows:
                e = e_factor(r, spc)
                q = sum(float(r[f"P_T{a}"]) / 100 * float(r[f"P_P{b}"]) / 100
                        for a in range(1, 5) for b in range(1, 5) if a * b * e >= 54 / 4)
                m = re.match(r"^(F\d+)\(?([IPRCT])\)?x?$", r["downstream"].strip())
                onode = t.out_node[(r["upstream"], r["output"])]
                start[onode] = min(start.get(onode, n), n - round(q * (n - 1)))
                del m
            lv = propagate(t, start)
            for f, onodes in outputs_of.items():
                deficit[f] += prob * max(n - lv[o] for o in onodes)
        top4 = sorted(deficit, key=lambda f: (-deficit[f], int(f[1:])))[:4]
        out.append({"semantics": name, "N": n, "top4": " ".join(top4),
                    "top4_in_workshop": len(set(top4) & workshop),
                    "ranking": " ".join(f"{f}:{deficit[f]:.2f}" for f in
                                        sorted(deficit, key=lambda f: -deficit[f])[:8])})
    return out


def write(name: str, rows: list[dict[str, object]]) -> None:
    keys: list[str] = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("e1c_equivalence.csv", equivalence), ("e1c_zheng_scale.csv", zheng),
                     ("e1c_tian.csv", tian), ("e1c_kaya_graded.csv", kaya_graded)):
        rows = fn()
        write(name, rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    _ = (TranslationConfig, run_e1)  # imported for type context / shared helpers
    main()
