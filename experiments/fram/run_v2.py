"""
v2 — every case under the one translation the paper uses (TRANSLATION.md, v2).

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_v2.py
"""
from __future__ import annotations

import csv
import itertools
from pathlib import Path

import run_e1
import run_e1b
import run_e1d
import run_e1e
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.kim import translate_kim
from framkit.model import ASPECTS
from framkit.translate import TranslationConfig, resonance_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4


def v2(n: int = N, triggers: frozenset = frozenset()) -> TranslationConfig:
    tc = resonance_config(n=n, mode="nested")
    tc.triggers = triggers
    return tc


def add_rule(t, fid: str, rule: str) -> None:
    node = t.project.nodes[t.fn_node[fid]]
    t.project.nodes[t.fn_node[fid]] = node.model_copy(update={"rules": (node.rules or []) + [rule]})


def zheng() -> dict[str, object]:
    truth = readers.zheng_judgements()
    t = translate(readers.read_zheng(), v2())
    f = t.fn_node
    add_rule(t, "F20", f"if {f['F12']}.functionality is <4 and {f['F17']}.functionality is <4 then {f['F20']} is severe")
    start = {f["X:Radio/Telephone"]: 3, f["X:Internet/Telephone"]: 3,
             f["X:Firetruck; firefighter; PPE, SCBAS, etc."]: 3, f["F5"]: 3}
    lv = function_levels(t, propagate(t, start))
    neg = [k for k, j in truth.items() if j == "negative"]
    pos = [k for k, j in truth.items() if j == "positive"]
    tp, tn = sum(lv[k] < N for k in neg), sum(lv[k] == N for k in pos)
    wrong = sorted([k for k in neg if lv[k] == N] + [k for k in pos if lv[k] < N], key=lambda x: int(x[1:]))
    return {"case": "Zheng 2024", "truth": "Table 2 judgements (8 neg, 8 pos)",
            "result": f"neg {tp}/8, pos {tn}/8, bal. acc {(tp + tn) / 16:.3f}", "misses": " ".join(wrong)}


def tian() -> dict[str, object]:
    t = translate(readers.read_tian(), v2())
    f7 = t.fn_node["F7"]
    for fid in ("F5", "F2"):
        add_rule(t, fid, f"if {f7}.functionality is <4 then {t.fn_node[fid]} is not performed")
    correct, spurious = 0, 0
    for f7l, bosun, f1 in itertools.product((4, 3, 2), ("present", "absent"), (4, 3)):
        start = {f7: f7l, t.fn_node["F1"]: f1}
        if bosun == "absent":
            start[t.fn_node["F2"]] = 1
        lv = function_levels(t, propagate(t, start))
        violated = lv["F2"] < N and lv["F5"] < N and lv["F8"] < N
        if f1 == 4:
            correct += violated == run_e1b.TIAN_TRUTH[(f7l, bosun)]
        elif violated and f7l == 4:
            spurious += 1
    return {"case": "Tian 2016", "truth": "model-checking scenarios + accident report",
            "result": f"{correct}/6 scenarios", "misses": f"{spurious} spurious violations"}


def smith() -> list[dict[str, object]]:
    out = []
    for variant in ("b_triggers", "c_shared_sensor"):
        model = readers.read_smith()
        model.functions["S1"].profiles["I"] = "Any"
        if variant == "c_shared_sensor":
            model.add_coupling("S8", "Pressure measured", "S10", "R")
        t = translate(model, TranslationConfig(n=2, dep={a: 2 for a in ASPECTS}, fmi_mode=True,
                                               triggers=frozenset({("S10", "S3"), ("S5", "S3")})))
        p = 0.0
        events = list(run_e1b.SMITH_EVENTS)
        for failed in itertools.product((False, True), repeat=len(events)):
            prob, ko = 1.0, {}
            for fid, down in zip(events, failed):
                prob *= run_e1b.SMITH_EVENTS[fid] if down else 1 - run_e1b.SMITH_EVENTS[fid]
                if down:
                    ko[t.fn_node[fid]] = 1
            if function_levels(t, propagate(t, ko))["S1"] == 1:
                p += prob
        out.append({"case": f"Smith 2017 ({variant})",
                    "truth": "fault tree 0.2720" if variant.startswith("b") else "direction: worse than FT",
                    "result": f"P(top) = {p:.4f}", "misses": ""})
    return out


def kaya() -> dict[str, object]:
    summary, _ = run_e1.kaya("v2", v2())
    return {"case": "Kaya 2020", "truth": "workshop {F1, F2, F8, F9}",
            "result": f"top-4 {summary['fn_cascade_top4']} ({summary['fn_cascade_top4_in_workshop']}/4)",
            "misses": f"VPN re-run {summary['fn_vpn_top4_in_workshop']}/4"}


def wenzhou() -> dict[str, object]:
    model = readers.read_wenzhou()
    t = translate(model, v2())
    lv = run_e1d.run(t, {"M7": 1, "M10": 1})
    flagged = {(c.source, c.target) for c in model.couplings if lv[c.source] < N and lv[c.target] < N}
    return {"case": "Wenzhou 2011 (held out)", "truth": "accident report via Tables 1, 3, 4",
            "result": f"chain {sum(lv[k] < N for k in run_e1d.POS)}/7, uninvolved {sum(lv[k] == N for k in run_e1d.NEG)}/2, "
                      f"P/R Table 3 {run_e1d.prf(flagged, run_e1d.TABLE3)}", "misses": ""}


def kim() -> dict[str, object]:
    model, rows = readers.read_kim()
    n = 7
    t = translate_kim(model, rows, n, "rules")
    scored = [r["function"] for r in rows if r["rule"]]
    lv = {s: run_e1e.levels(t, run_e1e.events(n, s, 0)) for s in run_e1e.SCEN}
    worst = {k: min(lv[s][k] for s in run_e1e.SCEN) for k in scored}
    g1 = sum(worst[k] < n for k in run_e1e.G1_POS) + sum(worst[k] == n for k in run_e1e.G1_NEG)
    g2 = sum(worst[k] == 1 for k in run_e1e.G2_POS) + sum(worst[k] > 1 for k in run_e1e.G2_NEG)
    return {"case": "Kim & Yoon 2021 (N = 7)", "truth": "Tables 6-7 (method output)",
            "result": f"pattern {g1}/9, resonance {g2}/12", "misses": "F2 degraded"}


def main() -> None:
    rows = [zheng(), tian(), *smith(), kaya(), wenzhou(), kim()]
    with open(RESULTS / "v2_all_cases.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
