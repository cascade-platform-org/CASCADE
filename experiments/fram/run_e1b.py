"""
E1b — RQ1 under the v1 proposal (TRANSLATION.md, "v1 proposal and new cases").

Semantics compared on every case:
  S0  v0 default (full dependency on I/P/R, one level absorbed on C/T)
  S1  damping alone (one level absorbed on every coupling)
  S2  damping + resonance (second-worst input, compiled rules)

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e1b.py
"""
from __future__ import annotations

import csv
import itertools
from pathlib import Path

import run_e1
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.model import ASPECTS
from framkit.oracles import KHAKZAD_BASIC
from framkit.translate import TranslationConfig, default_config, resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4
SEMANTICS: dict[str, TranslationConfig] = {
    "S0_v0": default_config(N),
    "S1_damping": TranslationConfig(n=N, dep={a: N - 1 for a in ASPECTS}),
    "S2_resonance": resonance_config(N),
}


def zheng() -> list[dict[str, object]]:
    truth = readers.zheng_judgements()
    model = readers.read_zheng()
    rows = []
    for (sem, tc), comms, rule in itertools.product(SEMANTICS.items(), (2, 3), (False, True)):
        t = translate(model, tc)
        if rule:
            f12, f17, f20 = (t.fn_node[f] for f in ("F12", "F17", "F20"))
            node = t.project.nodes[f20]
            t.project.nodes[f20] = node.model_copy(update={"rules": (node.rules or []) + [
                f"if {f12}.functionality is <4 and {f17}.functionality is <4 then {f20} is severe"]})
        start = {t.fn_node["X:Radio/Telephone"]: comms, t.fn_node["X:Internet/Telephone"]: comms,
                 t.fn_node["X:Firetruck; firefighter; PPE, SCBAS, etc."]: 3, t.fn_node["F5"]: 3}
        lv = function_levels(t, propagate(t, start))
        neg = [f for f, j in truth.items() if j == "negative"]
        pos = [f for f, j in truth.items() if j == "positive"]
        tp = sum(lv[f] < N for f in neg)
        tn = sum(lv[f] == N for f in pos)
        rows.append({
            "case": "zheng_table2", "semantics": sem, "comms": comms, "f20_rule": rule,
            "neg_recovered": f"{tp}/{len(neg)}", "pos_kept": f"{tn}/{len(pos)}",
            "balanced_acc": round((tp / len(neg) + tn / len(pos)) / 2, 3),
            "F20": lv["F20"], "wrong": " ".join(sorted(
                [f for f in neg if lv[f] == N] + [f for f in pos if lv[f] < N],
                key=lambda x: int(x[1:]))),
        })
    return rows


def kaya() -> list[dict[str, object]]:
    rows = []
    for sem, tc in SEMANTICS.items():
        summary, _ = run_e1.kaya(sem, tc)
        fn = run_e1.KAYA_FUNCTIONS[sem]
        degraded = sum(r["cascade"] > 0 for r in fn)
        rows.append({"case": "kaya_workshop", "semantics": sem,
                     "top4": summary["fn_cascade_top4"],
                     "top4_in_workshop": summary["fn_cascade_top4_in_workshop"],
                     "functions_ever_degraded": f"{degraded}/{len(fn)}",
                     "max_freq": max(r["cascade"] for r in fn),
                     "coupling_P/R/F1": summary["cascade_P/R/F1"],
                     "vpn_top4_in_workshop": summary["fn_vpn_top4_in_workshop"]})
    return rows


SMITH_EVENTS = {  # function -> failure probability (Khakzad 2011 basic events)
    "S8": KHAKZAD_BASIC["PT"], "S9": KHAKZAD_BASIC["PC"], "S6": KHAKZAD_BASIC["PY"],
    "S3": 1 - (1 - KHAKZAD_BASIC["A_valve"]) * (1 - KHAKZAD_BASIC["Actuator"]),
    "S2": 1 - (1 - KHAKZAD_BASIC["Hum_error"]) * (1 - KHAKZAD_BASIC["M_valve"]),
}


def smith() -> list[dict[str, object]]:
    rows = []
    for variant in ("a_literal", "b_triggers", "c_shared_sensor"):
        model = readers.read_smith()
        model.functions["S1"].profiles["I"] = "Any"
        triggers: frozenset[tuple[str, str]] = frozenset()
        if variant != "a_literal":
            triggers = frozenset({("S10", "S3"), ("S5", "S3")})
        if variant == "c_shared_sensor":
            model.add_coupling("S8", "Pressure measured", "S10", "R")
        t = translate(model, TranslationConfig(n=2, dep={a: 2 for a in ASPECTS},
                                               fmi_mode=True, triggers=triggers))
        p = 0.0
        events = list(SMITH_EVENTS)
        for failed in itertools.product((False, True), repeat=len(events)):
            prob = 1.0
            ko = {}
            for f, down in zip(events, failed):
                prob *= SMITH_EVENTS[f] if down else 1 - SMITH_EVENTS[f]
                if down:
                    ko[t.fn_node[f]] = 1
            if function_levels(t, propagate(t, ko))["S1"] == 1:
                p += prob
        rows.append({"case": "smith_2017", "variant": variant, "p_top": round(p, 4),
                     "fault_tree": 0.2720})
    return rows


TIAN_TRUTH = {(4, "present"): False, (4, "absent"): False, (3, "present"): True,
              (3, "absent"): True, (2, "present"): True, (2, "absent"): True}


def tian() -> list[dict[str, object]]:
    model = readers.read_tian()
    rows = []
    for (sem, tc), rule in itertools.product(SEMANTICS.items(), (False, True)):
        t = translate(model, tc)
        if rule:
            f7, f5 = t.fn_node["F7"], t.fn_node["F5"]
            node = t.project.nodes[f5]
            t.project.nodes[f5] = node.model_copy(update={"rules": (node.rules or []) + [
                f"if {f7}.functionality is <4 then {f5} is not performed"]})
        correct, detail = 0, []
        for f7, bosun, f1 in itertools.product((4, 3, 2), ("present", "absent"), (4, 3)):
            start = {t.fn_node["F7"]: f7, t.fn_node["F1"]: f1}
            if bosun == "absent":
                start[t.fn_node["F2"]] = 1
            lv = function_levels(t, propagate(t, start))
            violated = lv["F2"] < N and lv["F5"] < N and lv["F8"] < N
            if f1 == 4:
                correct += violated == TIAN_TRUTH[(f7, bosun)]
            detail.append(f"F7={f7}/{bosun[0]}/F1={f1}:{'V' if violated else '-'}")
        rows.append({"case": "tian_2016", "semantics": sem, "f7_rule": rule,
                     "scenarios_correct": f"{correct}/6", "detail": " ".join(detail)})
    return rows


def write(name: str, rows: list[dict[str, object]]) -> None:
    keys: list[str] = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("e1b_zheng.csv", zheng), ("e1b_kaya.csv", kaya),
                     ("e1b_smith.csv", smith), ("e1b_tian.csv", tian)):
        rows = fn()
        write(name, rows)
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
