"""
framkit/translate.py — FRAM model -> CASCADE project (TRANSLATION.md, v2).

Shape of the CASCADE model:

  function F  --->  output node O(F, text)  --->  every function that receives text

* Each function is a node with its own Requisite category `fn_<i>`.
* Each distinct (function, output text) is a small output node with the
  Requisite category `out_<k>`, where k indexes the output TEXT: one node per
  service a function provides, CASCADE's modelling standard. Two functions
  producing the same text therefore supply the same category, and a consumer
  takes `best_of` over them (same-named outputs are alternatives). Wiring F
  straight to its consumers would make each consumer depend on every output of
  F, since a parent passes all its Requisite categories to every child
  (engine/logical.py, unconditional Requisite inclusion).
* A consumer combines its distinct outputs with `worst_of` (FMI profile All).
* The aspect a coupling enters through sets the consumer's
  `dependency_level` for that output's category (TranslationConfig.dep).
* v2 (resonance_config): every coupling absorbs one level, and the function
  also follows the second-worst of its distinct inputs. One rule per function,
  with level offsets (ADR-0025):
      worst_of(worst_of(a, b, c) + 1,
               worst_of(best_of(a, b), best_of(a, c), best_of(b, c))) propagates to F
  The damping lives in the `+ 1`, so the inputs carry no dependency profile.
* Cumulative worsening (sensitivity, TRANSLATION.md §4a): the m-th worst input
  minus (m - 2), for m = 3 .. cumulative, continuing v2's series (m = 1: worst
  + 1; m = 2: second worst). A minus leaves a nominal input nominal, so the term
  bites only when m inputs deviate.
* FMI mode (V1) reads the model's profiles: None -> dependency_level 1
  (any drop neutralised); Any -> an intercategorical rule
  `worst_of(best_of(<Any outputs>), <All outputs>...) propagates to <node>`.

Output nodes are plumbing: every score in the harness counts function nodes only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "CASCADE-backend"))

from schemas.config import (  # noqa: E402
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
import schemas.results  # noqa: E402,F401  (defines PropagationResult, which Project references)
from schemas.network import (  # noqa: E402
    Canvas,
    CategoryDependencyProfile,
    Edge,
    Graph,
    Node,
    Project,
    ProjectMeta,
)

from .model import ASPECTS, FramModel

# Harness-only scale colours (the engine ignores them; the brand palette rule
# applies to the product UI).
_LABELS = {4: ("nominal", "#22c55e"), 3: ("variable", "#eab308"),
           2: ("severe", "#f97316"), 1: ("not performed", "#ef4444")}


@dataclass
class TranslationConfig:
    """The declared choices of the translation (frozen in TRANSLATION.md)."""
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
    """Default translation (TRANSLATION.md §2): I, P, R pass the full drop;
    Control and Time degrade without blocking (one level absorbed)."""
    return TranslationConfig(n=n, dep={"I": n, "P": n, "R": n, "C": n - 1, "T": n - 1})


def resonance_config(n: int = 4) -> TranslationConfig:
    """v2: one level of damping on every coupling + second-worst resonance."""
    return TranslationConfig(n=n, dep={a: n - 1 for a in ASPECTS}, resonance=True)


def cumulative_config(order: int, n: int = 4) -> TranslationConfig:
    """v2 plus cumulative worsening up to `order` coinciding deviations."""
    return TranslationConfig(n=n, dep={a: n - 1 for a in ASPECTS}, resonance=True, cumulative=order)


def fmi_config() -> TranslationConfig:
    """V1: N = 2, every aspect blocking, profiles read from the model."""
    return TranslationConfig(n=2, dep={a: 2 for a in ASPECTS}, fmi_mode=True)


@dataclass
class Translated:
    project: Project
    config: ModelConfiguration
    fn_node: dict[str, str]                        # function id -> node id
    out_node: dict[tuple[str, str], str]           # (function id, text) -> node id
    coupling_edge: dict[tuple[str, str, str, str], str]   # coupling -> edge id
    labels: dict[int, str]


def translate(model: FramModel, tc: TranslationConfig) -> Translated:
    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}
    fn_node: dict[str, str] = {}
    out_node: dict[tuple[str, str], str] = {}
    coupling_edge: dict[tuple[str, str, str, str], str] = {}
    text_cat: dict[str, str] = {}
    categories: list[str] = []

    for i, fid in enumerate(model.functions):
        nid = f"fn_{i}"
        fn_node[fid] = nid
        categories.append(nid)
        nodes[nid] = Node(id=nid, label=nid, functionality=tc.n, node_categories=[nid])

    def out_category(text: str) -> str:
        if text not in text_cat:
            text_cat[text] = f"out_{len(text_cat)}"
            categories.append(text_cat[text])
        return text_cat[text]

    for (src, text) in model.outputs():
        oid = f"o_{len(out_node)}"
        out_node[(src, text)] = oid
        nodes[oid] = Node(id=oid, label=oid, functionality=tc.n,
                          node_categories=[out_category(text)])
        eid = f"e_{len(edges)}"
        edges[eid] = Edge(id=eid, source=fn_node[src], target=oid, functionality=tc.n)

    # consumer -> category -> aspects it arrives through
    arrivals: dict[str, dict[str, set[str]]] = {}
    # consumer -> category -> producing output nodes (for the resonance rules)
    producers: dict[str, dict[str, set[str]]] = {}
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
        else:
            producers.setdefault(target, {}).setdefault(cat, set()).add(out_node[(c.source, c.output)])

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

    project = Project(
        version="2.0", meta=ProjectMeta(name=model.name), nodes=nodes, edges=edges,
        canvases=[Canvas(id="cv", graph=Graph(graph_type="generic",
                                              node_ids=list(nodes), edge_ids=list(edges)))],
    )
    scale = [FunctionalityScaleLevel(level=lv, label=_label(lv, tc.n)[0], color=_label(lv, tc.n)[1])
             for lv in range(1, tc.n + 1)]
    config = ModelConfiguration(
        version="1.0", meta=ConfigMeta(name=f"fram-{model.name}"),
        functionality_scale=scale,
        categories=[CategoryDefinition(name=c, category_type="Requisite") for c in categories],
    )
    return Translated(project, config, fn_node, out_node, coupling_edge,
                      {lv: _label(lv, tc.n)[0] for lv in range(1, tc.n + 1)})


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


def _label(level: int, n: int) -> tuple[str, str]:
    if n == 2:
        return ("not performed", "#ef4444") if level == 1 else ("nominal", "#22c55e")
    return _LABELS.get(level, (f"level {level}", "#9ca3af"))
