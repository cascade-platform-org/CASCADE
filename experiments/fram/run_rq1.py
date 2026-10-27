"""
RQ1 — does converting a FRAM model into a propagation model preserve the
conclusions of the original analysis? Every case under v2 (TRANSLATION.md), with
S0 (full dependency: reachability) as the baseline.

Function-level scores use one definition throughout: a function is predicted
degraded when its level is below N; recall = truly degraded found, precision =
predicted-degraded that are truly degraded, both over the functions the source
labels.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_rq1.py
"""
from __future__ import annotations

import csv
import itertools
import math
import re
from pathlib import Path

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.kim import to_level, translate_kim
from framkit.model import ASPECTS
from framkit.oracles import CONFIDENCE, e_factor, spc_scenarios, vpn_exceedance
from framkit.translate import TranslationConfig, Translated, default_config, resonance_config, translate
from schemas.network import CategoryDependencyProfile

RESULTS = Path(__file__).resolve().parent / "results"
N = 4
SEMANTICS = {"S0": default_config, "v2": resonance_config}


def add_rule(t: Translated, fid: str, rule: str) -> None:
    node = t.project.nodes[t.fn_node[fid]]
    t.project.nodes[t.fn_node[fid]] = node.model_copy(update={"rules": (node.rules or []) + [rule]})


def levels(t: Translated, start: dict[str, int]) -> dict[str, int]:
    return function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items()}))


def score(lv: dict[str, int], degraded: list[str], nominal: list[str], n: int = N) -> dict[str, object]:
    tp = sum(lv[f] < n for f in degraded)
    fp = sum(lv[f] < n for f in nominal)
    wrong = [f for f in degraded if lv[f] == n] + [f for f in nominal if lv[f] < n]
    return {"recall": f"{tp}/{len(degraded)}", "precision": f"{tp}/{tp + fp}" if tp + fp else "-",
            "misses": " ".join(wrong)}


# --- cases (events and rules: TRANSLATION.md, per-case mappings) -------------------

def zheng(sem: str) -> dict[str, object]:
    truth = readers.zheng_judgements()
    t = translate(readers.read_zheng(), SEMANTICS[sem]())
    f = t.fn_node
    add_rule(t, "F20", f"if {f['F12']}.functionality is <4 and {f['F17']}.functionality is <4 then {f['F20']} is severe")
    lv = levels(t, {"X:Radio/Telephone": 3, "X:Internet/Telephone": 3,
                    "X:Firetruck; firefighter; PPE, SCBAS, etc.": 3, "F5": 3})
    return score(lv, [k for k, j in truth.items() if j == "negative"], [k for k, j in truth.items() if j == "positive"])


TIAN_TRUTH = {(4, "present"): False, (4, "absent"): False, (3, "present"): True,
              (3, "absent"): True, (2, "present"): True, (2, "absent"): True}


def tian(sem: str) -> dict[str, object]:
    t = translate(readers.read_tian(), SEMANTICS[sem]())
    f7 = t.fn_node["F7"]
    for fid in ("F5", "F2"):
        add_rule(t, fid, f"if {f7}.functionality is <4 then {t.fn_node[fid]} is not performed")
    tp = fp = 0
    for (f7l, bosun), violates in TIAN_TRUTH.items():
        start = {"F7": f7l, "F1": 4} | ({"F2": 1} if bosun == "absent" else {})
        lv = levels(t, start)
        pred = lv["F2"] < N and lv["F5"] < N and lv["F8"] < N
        tp += pred and violates
        fp += pred and not violates
    return {"recall": f"{tp}/4 violating scenarios", "precision": f"{tp}/{tp + fp}", "misses": ""}


SMITH_EVENTS = {"S8": 0.1647, "S9": 0.2818, "S6": 0.1538,
                "S3": 1 - (1 - 0.3403) * (1 - 0.2015), "S2": 1 - (1 - 0.2696) * (1 - 0.1393)}


def smith_translation(shared_sensor: bool) -> Translated:
    model = readers.read_smith()
    model.functions["S1"].profiles["I"] = "Any"           # its two Inputs are alternatives
    if shared_sensor:
        model.add_coupling("S8", "Pressure measured", "S10", "R")
    return translate(model, TranslationConfig(n=2, dep={a: 2 for a in ASPECTS}, fmi_mode=True,
                                              triggers=frozenset({("S10", "S3"), ("S5", "S3")})))


def smith_ptop(shared_sensor: bool) -> float:
    t = smith_translation(shared_sensor)
    ev = list(SMITH_EVENTS)
    p = 0.0
    for state in itertools.product((False, True), repeat=len(ev)):
        prob = math.prod(SMITH_EVENTS[e] if d else 1 - SMITH_EVENTS[e] for e, d in zip(ev, state))
        if function_levels(t, propagate(t, {t.fn_node[e]: 1 for e, d in zip(ev, state) if d}))["S1"] == 1:
            p += prob
    return p


def _amplifies(row: dict[str, str]) -> bool:
    num = den = 0.0
    for a, b in itertools.product((3, 4), repeat=2):
        w = float(row[f"P_T{a}"]) * float(row[f"P_P{b}"])
        num += w * float(row[f"A_T{a}"]) * float(row[f"A_P{b}"])
        den += w
    return (num / den if den else 1.0) > 1


def _output_variable(row: dict[str, str], spc) -> bool:
    e = e_factor(row, spc)
    p = sum(float(row[f"P_T{a}"]) / 100 * float(row[f"P_P{b}"]) / 100
            for a in range(1, 5) for b in range(1, 5) if a * b * e >= 54 / 4)
    return p >= CONFIDENCE


KAYA_WORKSHOP = {"F1", "F2", "F8", "F9"}


def kaya(sem: str) -> dict[str, object]:
    """Exact over the 81 SPC scenarios: how often each function's output degrades.
    A coupling whose expected amplification does not exceed 1 absorbs one more level."""
    model, rows = readers.read_kaya()
    rows = [r for r in rows if r["downstream"].strip() != "N/A"]
    t = translate(model, SEMANTICS[sem]())
    edge_row = {}
    for r in rows:
        m = re.match(r"^(F\d+)\(?([IPRCT])\)?x?$", r["downstream"].strip())
        edge_row[t.coupling_edge[(r["upstream"], r["output"], m.group(1), m.group(2))]] = r
    for eid, r in edge_row.items():
        if _amplifies(r):
            continue
        e = t.project.edges[eid]
        node = t.project.nodes[e.target]
        cat = t.project.nodes[e.source].node_categories[0]
        prof = dict(node.category_dependency_profiles or {})
        cur = prof.get(cat)
        prof[cat] = CategoryDependencyProfile(dependency_level=min(N - 1, cur.dependency_level if cur and cur.dependency_level else N))
        t.project.nodes[e.target] = node.model_copy(update={"category_dependency_profiles": prof})
    outputs_of: dict[str, set[str]] = {}
    for (src, _), o in t.out_node.items():
        outputs_of.setdefault(src, set()).add(o)
    freq = dict.fromkeys(outputs_of, 0.0)
    vpn = dict.fromkeys(outputs_of, 0.0)
    for spc, prob in spc_scenarios():
        start: dict[str, int] = {}
        for eid, r in edge_row.items():
            o = t.project.edges[eid].source
            start[o] = min(start.get(o, N), 3 if _output_variable(r, spc) else N)
        lv = propagate(t, start)
        up = {r["upstream"] for r in edge_row.values() if vpn_exceedance(r, spc) >= CONFIDENCE}
        for f, outs in outputs_of.items():
            freq[f] += prob * any(lv[o] < N for o in outs)
            vpn[f] += prob * (f in up)
    top = sorted(freq, key=lambda f: (-freq[f], int(f[1:])))[:4]
    top_vpn = sorted(vpn, key=lambda f: (-vpn[f], int(f[1:])))[:4]
    return {"recall": f"{len(set(top) & KAYA_WORKSHOP)}/4 in top-4", "precision": "-",
            "misses": f"top-4 {' '.join(top)}; VPN re-run {len(set(top_vpn) & KAYA_WORKSHOP)}/4"}


KIM_SCEN = {"S1": (1.2, 1.2, 1.2), "S2": (1.2, 1.2, 1.4), "S3": (1.3, 1.3, 1.5)}


def kim_events(n: int, scen: str) -> dict[str, int]:
    return {f: to_level(1.96 * s, n) for f, s in zip(("F3", "F4", "F5"), KIM_SCEN[scen])}


def kim(mode: str) -> dict[str, object]:
    """Union over S1-S3 of the levels, N = 7. Degraded truth: F7-F13 (Table 7);
    nominal truth: F2, F6."""
    model, rows = readers.read_kim()
    t = translate_kim(model, rows, 7, mode)
    lv = {}
    for s in KIM_SCEN:
        for f, v in levels(t, kim_events(7, s)).items():
            lv[f] = min(lv.get(f, 7), v)
    res = score(lv, ["F7", "F8", "F9", "F10", "F11", "F12", "F13"], ["F2", "F6"], n=7)
    res["misses"] = (res["misses"] + f"; level 1 (resonance) {sum(lv[f] == 1 for f in ('F4', 'F5', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'))}/8").strip("; ")
    return res


WZ_DEGRADED = ["M5", "M8", "M11", "M16", "M17", "M19", "M20"]
WZ_NOMINAL = ["M12", "M13"]
WZ_TABLE3 = {("M5", "M11"), ("M7", "M8"), ("M8", "M17"), ("M10", "M16"), ("M10", "M19"), ("M8", "M5"),
             ("M8", "M20"), ("M10", "M5"), ("M11", "M15"), ("M11", "M18"), ("M16", "M17"), ("M19", "M20")}


def coupling_pr(model, lv, truth) -> str:
    flagged = {(c.source, c.target) for c in model.couplings
               if not c.source.startswith("X:") and lv[c.source] < N and lv[c.target] < N}
    tp = len(flagged & truth)
    return f"couplings P {tp}/{len(flagged)}, R {tp}/{len(truth)}"


def wenzhou(sem: str) -> dict[str, object]:
    model = readers.read_wenzhou()
    lv = levels(translate(model, SEMANTICS[sem]()), {"M7": 1, "M10": 1})
    res = score(lv, WZ_DEGRADED, WZ_NOMINAL)
    res["misses"] = (res["misses"] + "; " + coupling_pr(model, lv, WZ_TABLE3)).strip("; ")
    return res


KORIYAMA_EVENT = {"T1": 3, "T2": 3, "X:Immediate environment": 3,
                  "X:Function restricted during nighttime": 3, "X:Emergency call (119)": 3}
KORIYAMA_RED = {("T1", "T5"), ("T2", "T6"), ("T5", "T6"), ("T6", "T9")}


def koriyama(sem: str) -> dict[str, object]:
    model = readers.read_togawa()
    lv = levels(translate(model, SEMANTICS[sem]()), KORIYAMA_EVENT)
    res = score(lv, ["T5", "T6", "T9"], ["T7", "T8", "T3", "T4"])
    res["misses"] = (res["misses"] + "; " + coupling_pr(model, lv, KORIYAMA_RED)).strip("; ")
    return res


CASES = [
    ("Zheng 2024", "Table 2 expert judgements", zheng),
    ("Tian 2016", "model-checking scenarios, accident report", tian),
    ("Kaya 2020", "workshop: functions varying most", kaya),
    ("Wenzhou 2011 (held out)", "accident report via Tables 1, 3, 4", wenzhou),
    ("Koriyama 2019 (held out)", "Fig. 6, retrospective report", koriyama),
]


def main() -> None:
    rows = []
    for case, truth, fn in CASES:
        for sem in SEMANTICS:
            rows.append({"case": case, "truth": truth, "translation": sem, **fn(sem)})
    for mode, label in (("rules", "v2 (formula rules)"), ("structural", "shape only")):
        rows.append({"case": "Kim & Yoon 2021 (N = 7)", "truth": "Tables 6-7 (method output)",
                     "translation": label, **kim(mode)})
    for shared, label in ((False, "fault tree 0.2720"), (True, "direction: worse than FT")):
        rows.append({"case": "Smith 2017" + (" + shared sensor" if shared else ""), "truth": label,
                     "translation": "binary", "recall": f"P(top) {smith_ptop(shared):.4f}", "precision": "-",
                     "misses": ""})
    with open(RESULTS / "rq1.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
