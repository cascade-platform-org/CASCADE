"""
E1 / E1b — does the collapsed output recover the experts' conclusions (RQ1)?

Mappings are the frozen ones of TRANSLATION.md v0 §3; variants of §5.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e1.py
"""
from __future__ import annotations

import csv
from pathlib import Path

from scipy.stats import spearmanr

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.model import FramModel
from framkit.oracles import spc_scenarios, vpn_frequency
from framkit.translate import TranslationConfig, default_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4

VARIANTS: dict[str, TranslationConfig] = {
    "default": default_config(N),
    "CT_blocking": TranslationConfig(n=N, dep={"I": 4, "P": 4, "R": 4, "C": 4, "T": 4}),
    "CT_dep2": TranslationConfig(n=N, dep={"I": 4, "P": 4, "R": 4, "C": 2, "T": 2}),
    "R_dep3": TranslationConfig(n=N, dep={"I": 4, "P": 4, "R": 3, "C": 3, "T": 3}),
}

# --- Zheng 2024 ---------------------------------------------------------------

ZHENG_EVENT = {"X:Radio/Telephone": 2, "X:Internet/Telephone": 2,
               "X:Firetruck; firefighter; PPE, SCBAS, etc.": 3}
ZHENG_NEG = ("F12", "F17", "F20")
ZHENG_POS = ("F2", "F14", "F15")


def zheng(variant: str, tc: TranslationConfig, rule: bool) -> dict[str, object]:
    model = readers.read_zheng()
    t = translate(model, tc)
    if rule:
        f12, f17, f20 = (t.fn_node[f] for f in ZHENG_NEG)
        target = t.project.nodes[f20]
        t.project.nodes[f20] = target.model_copy(update={"rules": (target.rules or []) + [
            f"if {f12} is variable and {f17} is variable then {f20} is severe"]})
    levels = function_levels(t, propagate(t, {t.fn_node[k]: v for k, v in ZHENG_EVENT.items()}))
    fg = {f: lv for f, lv in levels.items() if not f.startswith("X:")}
    tp = sum(fg[f] < N for f in ZHENG_NEG)
    tn = sum(fg[f] == N for f in ZHENG_POS)
    return {
        "case": "zheng_2024", "variant": variant + ("+rule" if rule else ""),
        "neg_recovered": f"{tp}/3", "pos_kept": f"{tn}/3",
        "levels_labelled": " ".join(f"{f}={fg[f]}" for f in ZHENG_NEG + ZHENG_POS),
        "degraded_functions": f"{sum(lv < N for lv in fg.values())}/{len(fg)}",
        "F20": fg["F20"],
    }


# --- Kaya & Hocaoglu 2020 -------------------------------------------------------

def _parse_ground_truth() -> dict[tuple[str, str], float]:
    """Fig. 5 frequencies from the CSV header, keyed by (upstream, downstream)."""
    import re
    for ln in (readers.MODELS / "kaya_2020_nicu_couplings.csv").read_text().splitlines():
        if ln.startswith("# Ground truth"):
            body = ln.split(":", 1)[1].split("(bar")[0]
            return {(a, b): float(v) for a, b, v in
                    re.findall(r"(F\d+)-(F\d+)(?:\([IPRCT]\)|[IPRCT])?\s+(\d+(?:\.\d+)?)", body)}
    raise RuntimeError("ground truth line not found")


def _deviated_amplification(row: dict[str, str]) -> float:
    num = den = 0.0
    for t in (3, 4):
        for q in (3, 4):
            w = float(row[f"P_T{t}"]) * float(row[f"P_P{q}"])
            num += w * float(row[f"A_T{t}"]) * float(row[f"A_P{q}"])
            den += w
    return num / den if den else 1.0


def _output_variable(row: dict[str, str], spc) -> bool:
    from framkit.oracles import e_factor
    e = e_factor(row, spc)
    p = sum(float(row[f"P_T{t}"]) / 100 * float(row[f"P_P{q}"]) / 100
            for t in range(1, 5) for q in range(1, 5) if t * q * e >= 54 / 4)
    return p >= 0.05


def kaya(variant: str, tc: TranslationConfig) -> tuple[dict[str, object], list[dict[str, object]]]:
    import re
    model, rows = readers.read_kaya()
    rows = [r for r in rows if r["downstream"].strip() != "N/A"]
    t = translate(model, tc)
    passes: dict[str, bool] = {}       # edge id -> passes the drop
    coupling_of: dict[str, tuple[str, str, str]] = {}
    row_of: dict[str, dict[str, str]] = {}
    for r in rows:
        m = re.match(r"^(F\d+)\(?([IPRCT])\)?x?$", r["downstream"].strip())
        key = (r["upstream"], r["output"], m.group(1), m.group(2))
        eid = t.coupling_edge[key]
        passes[eid] = _deviated_amplification(r) > 1
        coupling_of[eid] = (r["upstream"], m.group(1), m.group(2))
        row_of[eid] = r
    # amplification sets the consumer's dependency on that output's category
    for eid, ok in passes.items():
        e = t.project.edges[eid]
        target = t.project.nodes[e.target]
        cat = t.project.nodes[e.source].node_categories[0]
        profiles = dict(target.category_dependency_profiles or {})
        if not ok:
            from schemas.network import CategoryDependencyProfile
            current = profiles.get(cat)
            dep = min(N - 1, current.dependency_level if current and current.dependency_level else N)
            profiles[cat] = CategoryDependencyProfile(dependency_level=dep)
        t.project.nodes[e.target] = target.model_copy(update={"category_dependency_profiles": profiles or None})

    freq = {eid: 0.0 for eid in passes}
    freq_onehop = {eid: 0.0 for eid in passes}
    outputs_of: dict[str, set[str]] = {}
    for (src, _text), onode in t.out_node.items():
        outputs_of.setdefault(src, set()).add(onode)
    fn_freq = {f: 0.0 for f in outputs_of}
    fn_freq_onehop = {f: 0.0 for f in outputs_of}
    fn_freq_vpn = {f: 0.0 for f in outputs_of}
    for spc, prob in spc_scenarios():
        out_level: dict[str, int] = {}
        for eid, r in row_of.items():
            onode = t.project.edges[eid].source
            lv = 3 if _output_variable(r, spc) else 4
            out_level[onode] = min(out_level.get(onode, 4), lv)
        levels = propagate(t, out_level)
        for eid in passes:
            onode = t.project.edges[eid].source
            if passes[eid] and levels[onode] < N:
                freq[eid] += 100 * prob
            if passes[eid] and out_level.get(onode, 4) < N:
                freq_onehop[eid] += 100 * prob
        from framkit.oracles import CONFIDENCE, vpn_exceedance
        vpn_up = {coupling_of[eid][0] for eid, r in row_of.items()
                  if vpn_exceedance(r, spc) >= CONFIDENCE}
        for f, onodes in outputs_of.items():
            if any(levels[o] < N for o in onodes):
                fn_freq[f] += 100 * prob
            if any(out_level.get(o, 4) < N for o in onodes):
                fn_freq_onehop[f] += 100 * prob
            if f in vpn_up:
                fn_freq_vpn[f] += 100 * prob

    # Post-freeze addition (labelled in the report): the workshop's functions
    # "whose performance varies the most" (Kaya & Hocaoglu 2020, Sect. 4.4).
    workshop = {"F1", "F2", "F8", "F9"}
    fn_rows = []
    for f in sorted(outputs_of, key=lambda x: int(x[1:])):
        fn_rows.append({"function": f, "workshop": f in workshop,
                        "vpn": round(fn_freq_vpn[f], 1), "cascade": round(fn_freq[f], 1),
                        "cascade_onehop": round(fn_freq_onehop[f], 1)})
    KAYA_FUNCTIONS[variant] = fn_rows

    truth = _parse_ground_truth()
    per_coupling = []
    for eid, (up, down, asp) in coupling_of.items():
        per_coupling.append({
            "coupling": f"{up}-{down}({asp})",
            "published_fig5": truth.get((up, down), 0.0),
            "vpn_reproduction": round(vpn_frequency(row_of[eid]), 1),
            "cascade": round(freq[eid], 1),
            "cascade_onehop": round(freq_onehop[eid], 1),
            "passes": passes[eid],
        })
    summary = {"case": "kaya_2020", "variant": variant}
    for col in ("vpn_reproduction", "cascade", "cascade_onehop"):
        pred = {p["coupling"] for p in per_coupling if p[col] > 0}
        gold = {p["coupling"] for p in per_coupling if p["published_fig5"] > 0}
        tp = len(pred & gold)
        prec = tp / len(pred) if pred else 0.0
        rec = tp / len(gold) if gold else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        rho = spearmanr([p["published_fig5"] for p in per_coupling], [p[col] for p in per_coupling]).statistic
        summary[f"{col}_flagged"] = len(pred)
        summary[f"{col}_P/R/F1"] = f"{prec:.2f}/{rec:.2f}/{f1:.2f}"
        summary[f"{col}_spearman"] = round(float(rho), 3)
    for col in ("vpn", "cascade", "cascade_onehop"):
        top4 = sorted(fn_rows, key=lambda r: (-r[col], int(r["function"][1:])))[:4]
        summary[f"fn_{col}_top4"] = " ".join(r["function"] for r in top4)
        summary[f"fn_{col}_top4_in_workshop"] = sum(r["workshop"] for r in top4)
    return summary, per_coupling


KAYA_FUNCTIONS: dict[str, list[dict[str, object]]] = {}


def write(name: str, rows: list[dict[str, object]]) -> None:
    keys: list[str] = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    zrows = [zheng(v, tc, rule) for v, tc in VARIANTS.items() for rule in (False, True)]
    for r in zrows:
        print(r)
    write("e1_zheng.csv", zrows)

    krows = []
    for v, tc in VARIANTS.items():
        summary, per = kaya(v, tc)
        krows.append(summary)
        print(summary)
        if v == "default":
            write("e1_kaya_couplings.csv", sorted(per, key=lambda p: -p["published_fig5"]))
            write("e1_kaya_functions.csv", KAYA_FUNCTIONS[v])
            for r in KAYA_FUNCTIONS[v]:
                print(r)
    write("e1_kaya.csv", krows)


if __name__ == "__main__":
    main()
