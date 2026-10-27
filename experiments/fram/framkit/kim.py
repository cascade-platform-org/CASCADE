"""
framkit/kim.py — two translations of Kim & Yoon 2021's quantitative FRAM.

Kim's variability V >= 1 (1 = nominal, 10 = their resonance criterion) maps to a
logarithmic Functionality scale: level k stands for V = 10^((N - k)/(N - 1)),
and a variability falls in the level whose representative is nearest in log.
Both translations take Kim's per-function variability IEV_i at its published
parameter IEV_p (no sampling), so the effective threshold on the aggregated
coupling variability is theta_i / IEV_p,i.

A  "rules":  each function's aggregation rule, threshold and IEV_p are
   evaluated on every combination of input levels and compiled into the
   minimal set of monotone Specific Rules (`if ... is <a and ... then F is L`).
   Couplings carry no dependency of their own (dependency_level 1), so a
   function degrades only when one of its rules fires.
B  "structural": the formula's shape alone becomes one nested intercategorical
   rule (max, +, * -> worst_of; min -> best_of) and theta_i / IEV_p,i becomes
   the function's damping: dependency_level = level of that threshold.
"""
from __future__ import annotations

import ast
import itertools
import math

from .model import ASPECTS, FramModel
from .oracles import kim_rule
from .translate import Translated, TranslationConfig, translate


def rep(level: int, n: int) -> float:
    return 10 ** ((n - level) / (n - 1))


def to_level(v: float, n: int) -> int:
    """Nearest level in log10; V <= 1 is nominal, V >= 10 is level 1."""
    if v <= 1:
        return n
    k = n - round(math.log10(v) * (n - 1))
    return max(1, min(n, k))


def _inputs(expr: str) -> list[str]:
    return list(dict.fromkeys(n.id for n in ast.walk(ast.parse(expr, mode="eval"))
                              if isinstance(n, ast.Name) and n.id not in ("min", "max")))


def _output(row: dict[str, str], ov: dict[str, float]) -> float:
    """Kim Eq. (5) with IEV_i = IEV_p,i."""
    iev = float(row["iev"])
    agg = kim_rule(row["rule"], ov) * iev
    return agg if agg > float(row["theta"]) else max(1.0, iev)


def compiled_rules(row: dict[str, str], cond_node: dict[str, str], target: str,
                   n: int, labels: dict[int, str]) -> list[str]:
    """Translation A for one function: minimal monotone Specific Rules.

    out(v) is monotone (worse inputs never improve the output), so the set of
    input vectors giving a level <= L is closed downwards; one rule per maximal
    vector of that set covers it, and the worst firing rule wins (Guard 3)."""
    ins = _inputs(row["rule"])
    out = {}
    for v in itertools.product(range(1, n + 1), repeat=len(ins)):
        out[v] = to_level(_output(row, {f: rep(x, n) for f, x in zip(ins, v)}), n)
    rules = []
    for lv in range(1, n):
        inside = {v for v, o in out.items() if o <= lv}
        for v in inside:
            if any(v[j] < n and v[:j] + (v[j] + 1,) + v[j + 1:] in inside for j in range(len(v))):
                continue
            conds = [f"{cond_node[f]}.functionality is <{x + 1}" for f, x in zip(ins, v) if x < n]
            if conds:
                rules.append(f"if {' and '.join(conds)} then {target} is {labels[lv]}")
    return rules


def _shape(node: ast.AST, cat: dict[str, str]) -> str:
    if isinstance(node, ast.Name):
        return cat[node.id]
    if isinstance(node, ast.Call):
        op = {"max": "worst_of", "min": "best_of"}[node.func.id]  # type: ignore[union-attr]
        return f"{op}({', '.join(_shape(a, cat) for a in node.args)})"
    if isinstance(node, ast.BinOp):
        return f"worst_of({_shape(node.left, cat)}, {_shape(node.right, cat)})"
    raise ValueError(ast.dump(node))


def translate_kim(model: FramModel, rows: list[dict[str, str]], n: int, mode: str) -> Translated:
    if mode == "rules":
        t = translate(model, TranslationConfig(n=n, dep={a: 1 for a in ASPECTS}))
    else:
        t = translate(model, TranslationConfig(n=n, dep={a: n for a in ASPECTS}))
    cats = {nd.id: nd.node_categories[0] for nd in t.project.nodes.values()}
    out_of = {src: oid for (src, _), oid in t.out_node.items()}
    for r in rows:
        if not r["rule"]:
            continue
        nid = t.fn_node[r["function"]]
        node = t.project.nodes[nid]
        if mode == "rules":
            update = {"rules": compiled_rules(r, out_of, nid, n, t.labels)}
        else:
            from schemas.network import CategoryDependencyProfile
            dep = to_level(float(r["theta"]) / float(r["iev"]), n)
            tree = ast.parse(r["rule"], mode="eval").body
            expr = _shape(tree, {f: cats[out_of[f]] for f in _inputs(r["rule"])})
            ins = [cats[out_of[f]] for f in _inputs(r["rule"])]
            update = {"rules": [f"{expr} propagates to {nid}"] if len(ins) > 1 else [],
                      "category_dependency_profiles": (
                          {c: CategoryDependencyProfile(dependency_level=dep) for c in ins}
                          if dep < n else None)}
        t.project.nodes[nid] = node.model_copy(update=update)
    return t
