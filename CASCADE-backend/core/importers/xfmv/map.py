# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
"""
core/importers/xfmv/map.py — FramModel → CASCADE model (ADR-0026).

This is the conversion the FRAM paper evaluates (experiments/fram, its
TRANSLATION.md): the paper's harness calls `translate` from here, so the
numbers it reports are computed by the code the importer ships.

Shape of the CASCADE model:

  function F  --->  output node O(F, text)  --->  every function that receives text

* Each function is a node with its own Requisite category.
* Each distinct (function, output text) is a small output node whose category
  is named after the output TEXT: one node per service a function provides,
  CASCADE's modelling standard. Two functions producing the same text supply
  the same category, so a consumer takes `best_of` over them (same-named
  outputs are alternatives). Wiring F straight to its consumers would make
  each consumer depend on every output of F, since a parent passes all its
  Requisite categories to every child (engine/logical.py).
* A consumer combines its distinct outputs with `worst_of` (FMI profile All).
* The aspect a coupling enters through sets the consumer's `dependency_level`
  for that output's category (TranslationConfig.dep).
* v2 (`resonance_config`, the importer's default): every coupling absorbs one
  level, and the function also follows the second-worst of its distinct
  inputs. One rule per function, with level offsets (ADR-0025):
      worst_of(worst_of(a, b, c) + 1,
               worst_of(best_of(a, b), best_of(a, c), best_of(b, c))) propagates to F
* Cumulative worsening (a declared sensitivity of the paper): the m-th worst
  input minus (m - 2), for m = 3 .. cumulative.
* FMI mode reads the model's profiles: None → dependency_level 1; Any → a rule
  `worst_of(best_of(<Any outputs>), <All outputs>...) propagates to <node>`.

Node ids are machine keys (`fn_<i>`, `o_<k>`); labels carry the function names
and output texts, and category names are slugs of them, so rules stay readable
and parseable.
"""
from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field
from typing import Literal

import networkx as nx

from core.importers.inp.map import generate_scale
from core.importers.xfmv.model import ASPECTS, FramModel
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    GraphTypeConfig,
    ModelConfiguration,
)
from schemas.network import (
    Canvas,
    CategoryDependencyProfile,
    Edge,
    Graph,
    Node,
    Position,
    Project,
    ProjectMeta,
)
from schemas.sync import ProjectBundle

Semantics = Literal["v2", "reachability", "fmi"]
GRAPH_TYPE_NAME = "fram"

_FRAM_LABELS = {
    4: ("not performed", "severe", "variable", "nominal"),
    2: ("not performed", "nominal"),
}


@dataclass
class TranslationConfig:
    """The declared choices of the translation (the paper's TRANSLATION.md)."""
    n: int = 4
    # aspect -> dependency_level on the 1..n scale; n = full dependency.
    dep: dict[str, int] = field(default_factory=dict)
    fmi_mode: bool = False
    # Resonance: the function also follows the SECOND-worst of its distinct
    # inputs. With damping on every coupling (dep = n - 1) a single deviating
    # input is absorbed by one level and two coinciding deviations pass.
    resonance: bool = False
    # (target fid, source fid) couplings read as triggers: the target acts on
    # the source's deviation, so it does not depend on the source being up.
    triggers: frozenset[tuple[str, str]] = frozenset()
    # Cumulative worsening: the highest m (coinciding deviations) whose term is
    # added; 0 = off, 3 = the third deviation only, n = every m that can bite.
    cumulative: int = 0

    def dependency(self, aspect: str) -> int:
        return self.dep.get(aspect, self.n)


def default_config(n: int = 4) -> TranslationConfig:
    """Reachability (the paper's S0): I, P, R pass the full drop; Control and
    Time degrade without blocking (one level absorbed)."""
    return TranslationConfig(n=n, dep={"I": n, "P": n, "R": n, "C": n - 1, "T": n - 1})


def resonance_config(n: int = 4) -> TranslationConfig:
    """v2: one level of damping on every coupling + second-worst resonance."""
    return TranslationConfig(n=n, dep={a: n - 1 for a in ASPECTS}, resonance=True)


def cumulative_config(order: int, n: int = 4) -> TranslationConfig:
    """v2 plus cumulative worsening up to `order` coinciding deviations."""
    return TranslationConfig(n=n, dep={a: n - 1 for a in ASPECTS}, resonance=True, cumulative=order)


def fmi_config() -> TranslationConfig:
    """The FMI's reading: N = 2, every aspect blocking, profiles from the model."""
    return TranslationConfig(n=2, dep={a: 2 for a in ASPECTS}, fmi_mode=True)


def config_for(semantics: Semantics) -> TranslationConfig:
    return {"v2": resonance_config, "reachability": default_config, "fmi": fmi_config}[semantics]()


@dataclass
class Translated:
    project: Project
    config: ModelConfiguration
    fn_node: dict[str, str]                        # function id -> node id
    out_node: dict[tuple[str, str], str]           # (function id, text) -> node id
    coupling_edge: dict[tuple[str, str, str, str], str]   # coupling -> edge id
    labels: dict[int, str]


class _Slugs:
    """Unique, parser-safe category names from free text: lowercase letters,
    digits and underscores, never a node id."""

    _NODE_ID = re.compile(r"^(fn|o)_\d+$")

    def __init__(self) -> None:
        self.used: set[str] = set()

    def __call__(self, text: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40].strip("_") or "output"
        if base[0].isdigit():
            base = "c_" + base
        name, k = base, 2
        while name in self.used or self._NODE_ID.match(name):
            name, k = f"{base}_{k}", k + 1
        self.used.add(name)
        return name


def scale(n: int) -> list[FunctionalityScaleLevel]:
    """The generated gradient, with FRAM's labels where the scale has them."""
    levels = generate_scale(n)
    names = _FRAM_LABELS.get(n, tuple(f"level {lv}" for lv in range(1, n + 1)))
    return [lv.model_copy(update={"label": names[lv.level - 1]}) for lv in levels]


def translate(model: FramModel, tc: TranslationConfig) -> Translated:
    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}
    fn_node: dict[str, str] = {}
    out_node: dict[tuple[str, str], str] = {}
    coupling_edge: dict[tuple[str, str, str, str], str] = {}
    text_cat: dict[str, str] = {}
    categories: list[str] = []
    slug = _Slugs()

    for i, (fid, fn) in enumerate(model.functions.items()):
        nid = f"fn_{i}"
        fn_node[fid] = nid
        cat = slug(fn.name)
        categories.append(cat)
        nodes[nid] = Node(id=nid, label=fn.name, functionality=tc.n, node_categories=[cat],
                          properties={"description": fn.description} if fn.description else None)

    def out_category(text: str) -> str:
        if text not in text_cat:
            text_cat[text] = slug(text)
            categories.append(text_cat[text])
        return text_cat[text]

    for (src, text) in model.outputs():
        oid = f"o_{len(out_node)}"
        out_node[(src, text)] = oid
        nodes[oid] = Node(id=oid, label=text, functionality=tc.n,
                          node_categories=[out_category(text)])
        eid = f"e_{len(edges)}"
        edges[eid] = Edge(id=eid, source=fn_node[src], target=oid, functionality=tc.n)

    # consumer -> category -> aspects it arrives through
    arrivals: dict[str, dict[str, set[str]]] = {}
    trigger_cats: dict[str, set[str]] = {}
    for c in model.couplings:
        eid = f"e_{len(edges)}"
        target = fn_node[c.target]
        cat = out_category(c.output)
        edges[eid] = Edge(id=eid, source=out_node[(c.source, c.output)], target=target,
                          functionality=tc.n)
        coupling_edge[(c.source, c.output, c.target, c.aspect)] = eid
        arrivals.setdefault(target, {}).setdefault(cat, set()).add(c.aspect)
        if (c.target, c.source) in tc.triggers:
            trigger_cats.setdefault(target, set()).add(cat)

    for fid, nid in list(fn_node.items()):
        fn = model.functions[fid]
        profiles: dict[str, CategoryDependencyProfile] = {}
        any_cats: dict[str, list[str]] = {}   # aspect -> its Any categories
        all_cats: list[str] = []
        resonant: list[tuple[str, int]] = []   # (input category, levels its coupling absorbs)
        for cat, aspects in arrivals.get(nid, {}).items():
            levels = []
            for a in aspects:
                if tc.fmi_mode and fn.profile(a) == "None":
                    levels.append(1)
                elif cat in trigger_cats.get(nid, set()):
                    levels.append(1)
                else:
                    levels.append(tc.dependency(a))
            dep = max(levels)
            if tc.resonance and cat not in trigger_cats.get(nid, set()):
                # The damping moves into the rule's worst term (`+ k`); the
                # input stays undamped for the second-worst term.
                resonant.append((cat, tc.n - dep))
            elif dep < tc.n:
                profiles[cat] = CategoryDependencyProfile(dependency_level=dep)
            any_aspects = sorted(a for a in aspects if tc.fmi_mode and fn.profile(a) == "Any")
            if any_aspects:
                # Any holds within one aspect type: one best_of group per aspect.
                any_cats.setdefault(any_aspects[0], []).append(cat)
            elif dep > 1:
                all_cats.append(cat)
        update: dict[str, object] = {}
        if profiles:
            update["category_dependency_profiles"] = profiles
        if any_cats:
            parts = [f"best_of({', '.join(cats)})" if len(cats) > 1 else cats[0]
                     for cats in any_cats.values()]
            parts += all_cats
            expr = f"worst_of({', '.join(parts)})" if len(parts) > 1 else parts[0]
            update["rules"] = [f"{expr} propagates to {nid}"]
        if tc.resonance and resonant:
            update["rules"] = [f"{_resonance_rule(resonant, tc.cumulative)} propagates to {nid}"]
        if update:
            nodes[nid] = nodes[nid].model_copy(update=update)

    _unique_labels(nodes, {oid: model.functions[src].name for (src, _), oid in out_node.items()})
    project = Project(
        version="2.0", meta=ProjectMeta(name=model.name), nodes=nodes, edges=edges,
        canvases=[Canvas(id="cv", label=model.name,
                         graph=Graph(graph_type=GRAPH_TYPE_NAME, node_ids=list(nodes), edge_ids=list(edges)))],
    )
    levels = scale(tc.n)
    config = ModelConfiguration(
        version="1.0", meta=ConfigMeta(name=f"fram-{model.name}"),
        functionality_scale=levels,
        categories=[CategoryDefinition(name=c, category_type="Requisite") for c in categories],
        graph_types=[GraphTypeConfig(name=GRAPH_TYPE_NAME, heuristics=[])],
    )
    return Translated(project, config, fn_node, out_node, coupling_edge,
                      {lv.level: lv.label for lv in levels})


def _unique_labels(nodes: dict[str, Node], producer: dict[str, str]) -> None:
    """Give every node a distinct label (the app flags shared labels as
    ambiguous). An output node whose text is also a function's name, or another
    producer's output, becomes "text (output of Function)"; the node id breaks
    any tie left."""
    def clashes() -> set[str]:
        seen: dict[str, int] = {}
        for n in nodes.values():
            seen[n.label or ""] = seen.get(n.label or "", 0) + 1
        return {lbl for lbl, k in seen.items() if k > 1}

    dup = clashes()
    for oid, fn_name in producer.items():
        if nodes[oid].label in dup:
            nodes[oid] = nodes[oid].model_copy(update={"label": f"{nodes[oid].label} (output of {fn_name})"})
    dup = clashes()
    for nid, n in list(nodes.items()):
        if n.label in dup:
            nodes[nid] = n.model_copy(update={"label": f"{n.label} [{nid}]"})


def _offset(k: int) -> str:
    return "" if k == 0 else f" + {k}" if k > 0 else f" - {-k}"


def _kth_worst(cats: list[str], k: int) -> str:
    """The k-th worst of the inputs: the worst, over every k of them, of their
    best. k = 1 is the worst input, k = len(cats) the best."""
    if k == 1:
        return f"worst_of({', '.join(cats)})"
    groups = [f"best_of({', '.join(g)})" for g in itertools.combinations(cats, k)]
    return groups[0] if len(groups) == 1 else f"worst_of({', '.join(groups)})"


def _resonance_rule(inputs: list[tuple[str, int]], cumulative: int) -> str:
    """worst_of(worst + damping, second worst[, m-th worst - (m - 2) ...]).

    `inputs` pairs each input category with the levels its coupling absorbs.
    When every coupling absorbs the same amount (always, under v2) the damping
    is one offset on the worst term; otherwise each input carries its own.
    """
    cats = [c for c, _ in inputs]
    absorbs = {k for _, k in inputs}
    if len(absorbs) == 1:
        terms = [_kth_worst(cats, 1) + _offset(absorbs.pop())]
    else:
        terms = [f"worst_of({', '.join(c + _offset(k) for c, k in inputs)})"]
    for m in range(2, len(cats) + 1):
        if m >= 3 and m > cumulative:
            break
        terms.append(_kth_worst(cats, m) + _offset(2 - m))
    return terms[0] if len(terms) == 1 else f"worst_of({', '.join(terms)})"


# --- the bundle the importer returns ---------------------------------------------

_COLUMN, _ROW, _OUTPUT_DX, _OUTPUT_DY = 320.0, 140.0, 150.0, 45.0


def layout(model: FramModel, t: Translated) -> Project:
    """Place every node: a function where the modeller drew it in FMV, else in
    columns by upstream depth (loops collapsed); its output nodes beside it."""
    where: dict[str, tuple[float, float]] = {}
    if all(f.position for f in model.functions.values()):
        where = {fid: f.position for fid, f in model.functions.items() if f.position}
    else:
        g = nx.DiGraph((c.source, c.target) for c in model.couplings)
        g.add_nodes_from(model.functions)
        dag = nx.condensation(g)
        depth: dict[int, int] = {}
        for comp in nx.topological_sort(dag):
            depth[comp] = max((depth[p] + 1 for p in dag.predecessors(comp)), default=0)
        rows: dict[int, int] = {}
        for fid in model.functions:
            d = depth[dag.graph["mapping"][fid]]
            where[fid] = (d * _COLUMN, rows.get(d, 0) * _ROW)
            rows[d] = rows.get(d, 0) + 1
    nodes = dict(t.project.nodes)
    for fid, nid in t.fn_node.items():
        x, y = where[fid]
        nodes[nid] = nodes[nid].model_copy(update={"position": Position(x=x, y=y)})
    per_fn: dict[str, int] = {}
    for (src, _), oid in t.out_node.items():
        x, y = where[src]
        k = per_fn.get(src, 0)
        per_fn[src] = k + 1
        nodes[oid] = nodes[oid].model_copy(update={"position": Position(x=x + _OUTPUT_DX, y=y + k * _OUTPUT_DY)})
    return t.project.model_copy(update={"nodes": nodes})


def build_bundle(model: FramModel, semantics: Semantics = "v2") -> ProjectBundle:
    """The importer's result: the converted model, laid out, ready to open."""
    t = translate(model, config_for(semantics))
    return ProjectBundle(project=layout(model, t), config=t.config)
