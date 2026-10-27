"""
E3 layer 2 — the experts' counterfactual claims (data/e3_claims.csv, frozen at
c2249b7) run as model edits under v2. Rules in TRANSLATION.md (3afa017).

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e3c.py
"""
from __future__ import annotations

import csv
import itertools
import math
from pathlib import Path

import run_e1b
import run_e1d
import run_e1f
from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.model import ASPECTS
from framkit.translate import TranslationConfig, Translated, resonance_config, translate
from schemas.network import CategoryDependencyProfile

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
N = 4


def v2(model) -> Translated:
    return translate(model, resonance_config(mode="nested"))


def add_rule(t: Translated, fid: str, rule: str) -> None:
    node = t.project.nodes[t.fn_node[fid]]
    t.project.nodes[t.fn_node[fid]] = node.model_copy(update={"rules": (node.rules or []) + [rule]})


def barrier(t: Translated, fid: str) -> None:
    """The function holds nominal: it depends on nothing and no rule degrades it."""
    nid = t.fn_node[fid]
    parents = {e.source for e in t.project.edges.values() if e.target == nid}
    cats = {c for p in parents for c in t.project.nodes[p].node_categories or []}
    node = t.project.nodes[nid]
    t.project.nodes[nid] = node.model_copy(update={
        "rules": [], "category_dependency_profiles": {c: CategoryDependencyProfile(dependency_level=1) for c in cats}})


def levels(t: Translated, start: dict[str, int]) -> dict[str, int]:
    return function_levels(t, propagate(t, {t.fn_node[f]: v for f, v in start.items() if f in t.fn_node}))


def compare(base: dict[str, int], edit: dict[str, int], outcome: list[str], direction: str) -> tuple[str, str]:
    b, e = [base[f] for f in outcome], [edit[f] for f in outcome]
    detail = " ".join(f"{f}:{x}->{y}" for f, x, y in zip(outcome, b, e))
    if direction == "improve":
        ok = any(y > x for x, y in zip(b, e)) and all(y >= x for x, y in zip(b, e))
    elif direction == "stay degraded":
        ok = all(y < N for y in e)
    elif direction.startswith("avoid"):
        ok = all(y == N for y in e)
        detail += " (direction " + ("improves" if any(y > x for x, y in zip(b, e)) and all(y >= x for x, y in zip(b, e))
                                    else "does not improve") + ")"
    else:
        raise ValueError(direction)
    return ("agree" if ok else "disagree"), detail


# --- cases -------------------------------------------------------------------

def tian(edit_barrier_f2: bool = False, order: bool = True, f7: int = 3):
    t = v2(readers.read_tian())
    f7n = t.fn_node["F7"]
    for fid in ("F5", "F2"):
        add_rule(t, fid, f"if {f7n}.functionality is <4 then {t.fn_node[fid]} is not performed")
    if edit_barrier_f2:
        barrier(t, "F2")
    start = {"F7": f7, "F1": 4}
    if not order:
        start["F3"] = 1
    return levels(t, start)


def koriyama(barriers: list[str]):
    t = v2(readers.read_togawa())
    for b in barriers:
        barrier(t, b)
    ev = {k: v for k, v in run_e1f.EVENT.items() if k not in barriers}
    return levels(t, ev)


def zheng(edit: str | None):
    model = readers.read_zheng()
    if edit == "C9":
        model.couplings = [c for c in model.couplings if not (c.source == "F5" and c.target == "F7")]
        model.add_coupling("F4", "Successful connection with fire department", "F7", "I")
    t = v2(model)
    f = t.fn_node
    add_rule(t, "F20", f"if {f['F12']}.functionality is <4 and {f['F17']}.functionality is <4 then {f['F20']} is severe")
    start = {"X:Radio/Telephone": 3, "X:Internet/Telephone": 3,
             "X:Firetruck; firefighter; PPE, SCBAS, etc.": 3, "F5": 3}
    if edit == "C8":
        del start["F5"]
    if edit == "C9":
        del start["F5"], start["X:Firetruck; firefighter; PPE, SCBAS, etc."]
    return levels(t, start)


def wenzhou(barriers: list[str]):
    t = v2(readers.read_wenzhou())
    for b in barriers:
        barrier(t, b)
    return levels(t, {k: v for k, v in {"M7": 1, "M10": 1}.items() if k not in barriers})


def smith_ptop(shared: bool) -> float:
    model = readers.read_smith()
    model.functions["S1"].profiles["I"] = "Any"
    if shared:
        model.add_coupling("S8", "Pressure measured", "S10", "R")
    t = translate(model, TranslationConfig(n=2, dep={a: 2 for a in ASPECTS}, fmi_mode=True,
                                           triggers=frozenset({("S10", "S3"), ("S5", "S3")})))
    ev = list(run_e1b.SMITH_EVENTS)
    p = 0.0
    for state in itertools.product((False, True), repeat=len(ev)):
        failed = [e for e, d in zip(ev, state) if d]
        prob = math.prod(run_e1b.SMITH_EVENTS[e] if d else 1 - run_e1b.SMITH_EVENTS[e] for e, d in zip(ev, state))
        if function_levels(t, propagate(t, {t.fn_node[e]: 1 for e in failed}))["S1"] == 1:
            p += prob
    return p


def li_stages() -> dict[str, float]:
    model, params = readers.read_li()
    domains = list(params)
    stage = {f: params[f]["stage"] for f in domains}

    def deficit(stage_barrier: str | None) -> float:
        t = v2(model)
        for f in domains:
            if stage[f] == stage_barrier:
                barrier(t, f)
        lv = levels(t, {f: 3 for f in domains if stage[f] != stage_barrier})
        return float(sum(N - v for f, v in lv.items() if not f.startswith("X:")))
    base = deficit(None)
    return {s: base - deficit(s) for s in ("PEP", "DER", "PER")}


def main() -> None:
    claims = {r["id"]: r for r in csv.DictReader(l for l in open(HERE / "data" / "e3_claims.csv") if not l.startswith("#"))}
    out = []

    def rec(cid, verdict, detail):
        c = claims[cid]
        out.append({"id": cid, "paper": c["paper"], "claim": c["direction"], "verdict": verdict, "detail": detail})

    rec("C1", *compare(tian(), tian(edit_barrier_f2=True), ["F5", "F8"], "stay degraded"))
    rec("C2", *compare(tian(order=False, f7=4), tian(order=True, f7=4), ["F2"], "improve"))
    rec("C3", "not expressible", claims["C3"]["edit"])
    base_k = koriyama([])
    rec("C4", *compare(base_k, koriyama(["T5"]), ["T6"], "improve"))
    rec("C5", *compare(base_k, koriyama(["T1", "T2"]), ["T5", "T6", "T9"], "improve"))
    rec("C6", *compare(base_k, koriyama(["T6"]), ["T9"], "improve"))
    rec("C7", "not expressible", claims["C7"]["edit"])
    base_z = zheng(None)
    rec("C8", *compare(base_z, zheng("C8"), ["F7", "F9", "F10", "F11", "F12"], "improve"))
    rec("C9", *compare(base_z, zheng("C9"), ["F20"], "avoid (nominal)"))
    base_w = wenzhou([])
    rec("C10", *compare(base_w, wenzhou(["M10"]), ["M20"], "avoid (nominal)"))
    rec("C11", "not expressible", claims["C11"]["edit"])
    rec("C12", *compare(base_w, wenzhou(["M5", "M7", "M8", "M10"]), ["M20"], "avoid (nominal)"))
    pb, pc = smith_ptop(False), smith_ptop(True)
    rec("C13", "agree" if pc > pb else "disagree", f"P(top) {pb:.4f} -> {pc:.4f}")
    red = li_stages()
    order = sorted(red, key=lambda s: -red[s])
    rec("C14", "agree" if order == ["PEP", "DER", "PER"] else "disagree",
        "deficit reduction " + " ".join(f"{s}:{red[s]:.1f}" for s in order))
    rec("C15", "see E3b", "Spearman -0.35 (x0.9), 0.26 (x0.5); F7 found at x0.5, F11 not")
    with open(RESULTS / "e3c_claims.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    for r in out:
        print(r)
    _ = run_e1d  # scenario A of E1d is restated in wenzhou()


if __name__ == "__main__":
    main()
