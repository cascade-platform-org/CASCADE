"""
RQ2 — does the converted model correctly predict the effect of interventions?

  importance  Smith/Khakzad: CASCADE's Birnbaum importance and Shapley vs the
              closed-form fault tree, against single-knockout Vitality and topology.
  kim         Kim & Yoon: IEV_p x factor per function, model vs the oracle.
  claims      the experts' counterfactual claims (data/e3_claims.csv, frozen at
              c2249b7 under the rules declared at 3afa017), run as model edits.
  topology    single-knockout Vitality vs topological reach on every case
              (the reason rankings by single failures carry little model content).

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_rq2.py
"""
from __future__ import annotations

import csv
import itertools
import math
import random
import statistics
from pathlib import Path

import networkx as nx
from scipy.stats import spearmanr

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.kim import to_level, translate_kim
from framkit.model import FramModel
from framkit.oracles import kim_simulate
from framkit.translate import Translated, default_config, resonance_config, translate
from run_rq1 import KORIYAMA_EVENT, N, SMITH_EVENTS, add_rule, levels, smith_ptop, smith_translation
from schemas.network import CategoryDependencyProfile

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"


def shapley(players: list[str], v) -> dict[str, float]:
    n = len(players)
    val = {frozenset(s): v(s) for k in range(n + 1) for s in itertools.combinations(players, k)}
    return {p: sum(math.factorial(len(s)) * math.factorial(n - len(s) - 1) / math.factorial(n)
                   * (val[frozenset(s) | {p}] - val[frozenset(s)])
                   for k in range(n) for s in itertools.combinations([q for q in players if q != p], k))
            for p in players}


def topological(model) -> dict[str, dict[str, float]]:
    g = nx.DiGraph((c.source, c.target) for c in model.couplings)
    g.add_nodes_from(model.functions)
    rev = g.reverse()
    return {"degree": {n: float(d) for n, d in g.degree()},
            "out_reach": {n: float(len(nx.descendants(g, n))) for n in g},
            "betweenness": nx.betweenness_centrality(g),
            "pagerank_rev": nx.pagerank(rev),
            "katz_rev": nx.katz_centrality_numpy(rev, alpha=0.1)}


def vitality(t: Translated, n: int = N) -> dict[str, float]:
    fns = [f for f in t.fn_node if not f.startswith("X:")]

    def op(lv):
        return sum((lv[f] - 1) / (n - 1) for f in fns) / len(fns)
    base = op(function_levels(t, propagate(t)))
    return {f: base - op(function_levels(t, propagate(t, {t.fn_node[f]: 1}))) for f in fns}


# --- importance: Smith / Khakzad --------------------------------------------------------

AUTO = ("S8", "S9", "S6", "S3")


def birnbaum(top) -> dict[str, float]:
    ev = list(SMITH_EVENTS)
    out = {}
    for i in ev:
        others = [e for e in ev if e != i]
        p = {True: 0.0, False: 0.0}
        for state in itertools.product((False, True), repeat=len(others)):
            prob = math.prod(SMITH_EVENTS[e] if d else 1 - SMITH_EVENTS[e] for e, d in zip(others, state))
            failed = {e for e, d in zip(others, state) if d}
            for fi in (True, False):
                p[fi] += prob * top(failed | ({i} if fi else set()))
        out[i] = p[True] - p[False]
    return out


def importance() -> list[dict[str, object]]:
    truth = birnbaum(lambda f: bool(f & set(AUTO)) and "S2" in f)
    rows = []
    for shared in (False, True):
        t = smith_translation(shared)
        model = readers.read_smith()

        def top(failed, t=t):
            return function_levels(t, propagate(t, {t.fn_node[e]: 1 for e in failed}))["S1"] == 1
        scores = {"CASCADE Birnbaum": birnbaum(top),
                  "CASCADE Shapley": shapley(list(SMITH_EVENTS), lambda s: float(top(set(s)))),
                  "single-knockout Vitality": {e: v for e, v in vitality(t, 2).items() if e in SMITH_EVENTS}}
        scores.update({k: {e: s.get(e, 0.0) for e in SMITH_EVENTS} for k, s in topological(model).items()})
        ev = list(SMITH_EVENTS)
        for m, s in scores.items():
            rho = spearmanr([s[e] for e in ev], [truth[e] for e in ev])[0]
            rows.append({"variant": "shared sensor" if shared else "as published", "metric": m,
                         "spearman_vs_FT": round(float(rho), 2) if rho == rho else "nan",
                         "first": max(ev, key=lambda e: (s[e], e)),
                         "scores": " ".join(f"{e}:{s[e]:.3g}" for e in ev)})
        rows.append({"variant": "shared sensor" if shared else "as published", "metric": "(FT Birnbaum)",
                     "spearman_vs_FT": "", "first": "S2", "scores": " ".join(f"{e}:{truth[e]:.3g}" for e in ev)})
    return rows


# --- Kim & Yoon interventions vs the oracle --------------------------------------------

def kim(trials: int = 1500) -> list[dict[str, object]]:
    model, rows = readers.read_kim()
    scored = [r["function"] for r in rows if r["rule"]]
    sigma = {r["function"]: float(r["iev"]) for r in rows} | {"F3": 1.2, "F4": 1.2, "F5": 1.4}

    def oracle(sg):
        rng = random.Random(7)                      # common random numbers
        return statistics.mean(kim_simulate(rows, sg, rng)["duration"] for _ in range(trials))

    def deficit(sg):
        t = translate_kim(model, [{**r, "iev": str(sg[r["function"]])} for r in rows], 7, "rules")
        ev = {f: to_level(1.96 * sg[f], 7) for f in ("F3", "F4", "F5")}
        return float(sum(7 - v for v in levels(t, ev).values()))
    out = []
    for factor in (0.9, 0.5):
        bo, bm = oracle(sigma), deficit(sigma)
        o = {f: 100 * (oracle(sigma | {f: sigma[f] * factor}) - bo) / bo for f in scored}
        m = {f: bm - deficit(sigma | {f: sigma[f] * factor}) for f in scored}
        rho = spearmanr([o[f] for f in scored], [m[f] for f in scored])[0]
        out.append({"factor": factor, "spearman": round(float(rho), 2),
                    "oracle_top3": " ".join(sorted(scored, key=lambda f: -o[f])[:3]),
                    "model_top3": " ".join(sorted(scored, key=lambda f: (-m[f], int(f[1:])))[:3]),
                    "functions_model_resolves": sum(m[f] != 0 for f in scored)})
    return out


# --- the experts' counterfactual claims ---------------------------------------------------

def barrier(t: Translated, fid: str) -> None:
    """The function holds nominal: it depends on nothing and no rule degrades it."""
    nid = t.fn_node[fid]
    cats = {c for e in t.project.edges.values() if e.target == nid
            for c in t.project.nodes[e.source].node_categories or []}
    t.project.nodes[nid] = t.project.nodes[nid].model_copy(update={
        "rules": [], "category_dependency_profiles": {c: CategoryDependencyProfile(dependency_level=1) for c in cats}})


def verdict(base, edit, outcome, direction) -> tuple[str, str]:
    b, e = [base[f] for f in outcome], [edit[f] for f in outcome]
    detail = " ".join(f"{f}:{x}->{y}" for f, x, y in zip(outcome, b, e))
    improves = any(y > x for x, y in zip(b, e)) and all(y >= x for x, y in zip(b, e))
    if direction == "improve":
        return ("agree" if improves else "disagree"), detail
    if direction == "stay degraded":
        return ("agree" if all(y < N for y in e) else "disagree"), detail
    return ("agree" if all(y == N for y in e) else "disagree"), detail + f" (direction {'improves' if improves else 'does not improve'})"


def tian(barrier_f2=False, order=True, f7=3):
    t = translate(readers.read_tian(), resonance_config())
    for fid in ("F5", "F2"):
        add_rule(t, fid, f"if {t.fn_node['F7']}.functionality is <4 then {t.fn_node[fid]} is not performed")
    if barrier_f2:
        barrier(t, "F2")
    return levels(t, {"F7": f7, "F1": 4} | ({} if order else {"F3": 1}))


def koriyama(held: list[str]):
    t = translate(readers.read_togawa(), resonance_config())
    for f in held:
        barrier(t, f)
    return levels(t, {k: v for k, v in KORIYAMA_EVENT.items() if k not in held})


def zheng(edit=None):
    model = readers.read_zheng()
    if edit == "C9":                                   # cancel F5: F7 takes F4's output
        model.couplings = [c for c in model.couplings if not (c.source == "F5" and c.target == "F7")]
        model.add_coupling("F4", "Successful connection with fire department", "F7", "I")
    t = translate(model, resonance_config())
    f = t.fn_node
    add_rule(t, "F20", f"if {f['F12']}.functionality is <4 and {f['F17']}.functionality is <4 then {f['F20']} is severe")
    start = {"X:Radio/Telephone": 3, "X:Internet/Telephone": 3, "X:Firetruck; firefighter; PPE, SCBAS, etc.": 3, "F5": 3}
    drop = {"C8": ["F5"], "C9": ["F5", "X:Firetruck; firefighter; PPE, SCBAS, etc."]}.get(edit, [])
    return levels(t, {k: v for k, v in start.items() if k not in drop})


def wenzhou(held: list[str]):
    t = translate(readers.read_wenzhou(), resonance_config())
    for f in held:
        barrier(t, f)
    return levels(t, {k: v for k, v in {"M7": 1, "M10": 1}.items() if k not in held})


def li_stages() -> dict[str, float]:
    rows = [r for r in csv.DictReader(line for line in open(readers.MODELS / "li_2026_metro_rainfall.csv")
                                        if not line.startswith("#"))]
    model = FramModel("li_2026")
    stage = {}
    for r in rows:
        model.add_function(r["upstream"], r["function_name"])
        if r["V"]:
            stage[r["upstream"]] = r["stage"]
    for r in rows:
        if r["downstream"]:
            model.add_function(r["downstream"], r["downstream"])
            model.add_coupling(r["upstream"], r["function_name"], r["downstream"], r["aspect"])

    def deficit(held_stage):
        t = translate(model, resonance_config())
        for f, s in stage.items():
            if s == held_stage:
                barrier(t, f)
        lv = levels(t, {f: 3 for f, s in stage.items() if s != held_stage})
        return float(sum(N - v for v in lv.values()))
    base = deficit(None)
    return {s: base - deficit(s) for s in ("PEP", "DER", "PER")}


def claims() -> list[dict[str, object]]:
    c = {r["id"]: r for r in csv.DictReader(line for line in open(HERE / "data" / "e3_claims.csv")
                                             if not line.startswith("#"))}
    out = []

    def rec(cid, v, d):
        out.append({"id": cid, "paper": c[cid]["paper"], "claim": c[cid]["quote"][:90], "direction": c[cid]["direction"],
                    "verdict": v, "detail": d})
    rec("C1", *verdict(tian(), tian(barrier_f2=True), ["F5", "F8"], "stay degraded"))
    rec("C2", *verdict(tian(order=False, f7=4), tian(f7=4), ["F2"], "improve"))
    rec("C3", "not expressible", c["C3"]["edit"])
    kb = koriyama([])
    rec("C4", *verdict(kb, koriyama(["T5"]), ["T6"], "improve"))
    rec("C5", *verdict(kb, koriyama(["T1", "T2"]), ["T5", "T6", "T9"], "improve"))
    rec("C6", *verdict(kb, koriyama(["T6"]), ["T9"], "improve"))
    rec("C7", "not expressible", c["C7"]["edit"])
    zb = zheng()
    rec("C8", *verdict(zb, zheng("C8"), ["F7", "F9", "F10", "F11", "F12"], "improve"))
    rec("C9", *verdict(zb, zheng("C9"), ["F20"], "avoid"))
    wb = wenzhou([])
    rec("C10", *verdict(wb, wenzhou(["M10"]), ["M20"], "avoid"))
    rec("C11", "not expressible", c["C11"]["edit"])
    rec("C12", *verdict(wb, wenzhou(["M5", "M7", "M8", "M10"]), ["M20"], "avoid"))
    pb, pc = smith_ptop(False), smith_ptop(True)
    rec("C13", "agree" if pc > pb else "disagree", f"P(top) {pb:.4f} -> {pc:.4f}")
    red = li_stages()
    order = sorted(red, key=lambda s: -red[s])
    rec("C14", "agree" if order == ["PEP", "DER", "PER"] else "disagree",
        "deficit reduction " + " ".join(f"{s}:{red[s]:.1f}" for s in order))
    rec("C15", "see kim", "Kim interventions table")
    return out


# --- single-knockout Vitality vs topology ------------------------------------------------

def topology_check() -> list[dict[str, object]]:
    out = []
    for name, model in (("Zheng", readers.read_zheng()), ("Wenzhou", readers.read_wenzhou()),
                        ("Koriyama", readers.read_togawa()), ("Tian", readers.read_tian()),
                        ("Kaya", readers.read_kaya()[0])):
        topo = topological(model)
        for sem, cfg in (("S0", default_config), ("v2", resonance_config)):
            v = vitality(translate(model, cfg()))
            fs = sorted(v)
            row = {"case": name, "translation": sem, "functions": len(fs)}
            for k in ("out_reach", "katz_rev", "degree"):
                row[f"rho_{k}"] = round(float(spearmanr([v[f] for f in fs], [topo[k].get(f, 0) for f in fs])[0]), 2)
            out.append(row)
    return out


def write(name: str, rows: list[dict[str, object]]) -> None:
    with open(RESULTS / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    for name, fn in (("rq2_importance.csv", importance), ("rq2_claims.csv", claims),
                     ("rq2_topology.csv", topology_check), ("rq2_kim.csv", kim)):
        rows = fn()
        write(name, rows)
        print(f"== {name}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
