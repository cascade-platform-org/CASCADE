"""
E2 — can model-based centrality metrics identify the functions experts rank as
critical (RQ2)? Structural Vitality Centrality on the default translation
(TRANSLATION.md v0 §4) against the published rankings and topological baselines.

Run from the repository root:
    CASCADE-backend/.venv/bin/python experiments/fram/run_e2.py
"""
from __future__ import annotations

import csv
import unicodedata
from pathlib import Path

import networkx as nx
from scipy.stats import hypergeom, spearmanr

from framkit import readers
from framkit.engine import function_levels, propagate
from framkit.model import FramModel
from framkit.translate import Translated, default_config, translate

RESULTS = Path(__file__).resolve().parent / "results"
N = 4


def operativity(levels: dict[str, int]) -> float:
    return sum((lv - 1) / (N - 1) for lv in levels.values()) / len(levels)


def vitality_functions(t: Translated) -> dict[str, float]:
    base = operativity(function_levels(t, propagate(t)))
    return {f: base - operativity(function_levels(t, propagate(t, {nid: 1})))
            for f, nid in t.fn_node.items()}


def vitality_couplings(t: Translated) -> dict[tuple[str, str, str, str], float]:
    base = operativity(function_levels(t, propagate(t)))
    return {c: base - operativity(function_levels(t, propagate(t, edge_levels={eid: 1})))
            for c, eid in t.coupling_edge.items()}


def baselines(model: FramModel) -> dict[str, dict[str, float]]:
    g = nx.DiGraph()
    g.add_nodes_from(model.functions)
    g.add_edges_from((c.source, c.target) for c in model.couplings)
    rev = g.reverse()   # importance = what depends on you: rank sources of influence
    return {
        "degree": {n: float(d) for n, d in g.degree()},
        "out_reach": {n: float(len(nx.descendants(g, n))) for n in g},
        "betweenness": nx.betweenness_centrality(g),
        "pagerank_rev": nx.pagerank(rev),
        "katz_rev": nx.katz_centrality_numpy(rev, alpha=0.1),
    }


def top(scores: dict[str, float], k: int, among: set[str] | None = None) -> list[str]:
    items = [(f, s) for f, s in scores.items() if among is None or f in among]
    return [f for f, _ in sorted(items, key=lambda x: (-x[1], str(x[0])))[:k]]


def overlap_row(case: str, method: str, scores: dict[str, float], gold: set[str], k: int,
                universe: set[str]) -> dict[str, object]:
    hit = len(set(top(scores, k, universe)) & gold)
    p = hypergeom.sf(hit - 1, len(universe), len(gold), k)
    return {"case": case, "method": method, "k": k, "gold": len(gold), "universe": len(universe),
            "hits": hit, "expected_random": round(k * len(gold) / len(universe), 2),
            "p_hypergeom": round(float(p), 4)}


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).replace("’", "'").lower().strip()


def grabbe() -> list[dict[str, object]]:
    model = readers.read_xfmv(readers.grabbe_path())
    t = translate(model, default_config(N))
    by_name = {norm(f.name): fid for fid, f in model.functions.items()}
    gold: dict[str, set[str]] = {"human": set(), "automation": set()}
    for r in readers.grabbe_risk_functions():
        fid = by_name[norm(r["model_name"] or r["function"])]
        for inst in gold:
            if r[inst] == "1":
                gold[inst].add(fid)
    universe = set(model.functions)
    methods = {"vitality": vitality_functions(t), **baselines(model)}
    rows = []
    for inst, g in gold.items():
        for m, s in methods.items():
            rows.append(overlap_row(f"grabbe_2022_{inst}", m, s, g, len(g), universe))
    return rows


def li() -> list[dict[str, object]]:
    model, params = readers.read_li()
    t = translate(model, default_config(N))
    domains = set(params)
    gold = {"P4", "P5", "R3", "S2", "R5"}
    methods = {"vitality": vitality_functions(t), **baselines(model)}
    rows = [overlap_row("li_2026", m, s, gold, 5, domains) for m, s in methods.items()]
    for r, (m, s) in zip(rows, methods.items()):
        r["top5"] = " ".join(top(s, 5, domains))
    return rows


def couplings_case(case: str, model: FramModel, truth: dict[tuple[str, str], float],
                   k: int) -> list[dict[str, object]]:
    t = translate(model, default_config(N))
    vit = vitality_couplings(t)
    g = nx.DiGraph((c.source, c.target) for c in model.couplings)
    eb = nx.edge_betweenness_centrality(g)
    keys = list(vit)
    methods = {
        "vitality": {c: vit[c] for c in keys},
        "edge_betweenness": {c: eb.get((c[0], c[2]), 0.0) for c in keys},
        "source_out_reach": {c: float(len(nx.descendants(g, c[0]))) for c in keys},
    }
    gold_vals = [truth.get((c[0], c[2]), 0.0) for c in keys]
    gold_top = set(sorted(keys, key=lambda c: -truth.get((c[0], c[2]), 0.0))[:k])
    rows = []
    for m, s in methods.items():
        rho = spearmanr(gold_vals, [s[c] for c in keys]).statistic
        hit = len(set(top({str(c): v for c, v in s.items()}, k)) & {str(c) for c in gold_top})
        p = hypergeom.sf(hit - 1, len(keys), k, k)
        rows.append({"case": case, "method": m, "k": k, "gold": k, "universe": len(keys),
                     "hits": hit, "expected_random": round(k * k / len(keys), 2),
                     "p_hypergeom": round(float(p), 4), "spearman": round(float(rho), 3)})
    return rows


def kaya() -> list[dict[str, object]]:
    from run_e1 import _parse_ground_truth
    model, _ = readers.read_kaya()
    return couplings_case("kaya_2020_couplings", model, _parse_ground_truth(), 13)


def zinetullina() -> list[dict[str, object]]:
    model, rows = readers.read_zinetullina()
    truth = {(r["upstream"], r["downstream"]): float(r["cv_p5"]) for r in rows}
    return couplings_case("zinetullina_2021_couplings", model, truth, 3)


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    rows = grabbe() + li() + kaya() + zinetullina()
    keys: list[str] = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(RESULTS / "e2_rankings.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
