# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
"""
engine/logical.py — Category-aware logical proposal (PRIVATE IP).

Implements the logical heuristic of ADR-0003: for a target node, aggregate the
Functionality delivered by its upstream neighbours into a single proposed level,
together with the responsibility share for that proposal.

Three stages (ADR-0003 → Multi-category composition):
  1. Deliverable      L(u→v) = worst_of(node_u, edge_u→v)   — node/edge limitation
  2. Intracategorical C_g     = best_of over deliverables    — redundancy
  3. Intercategorical I       = worst_of over categories     — conjunction

The responsibility for each stage comes from `core.aggregation.attributed`, and
is composed across stages so the final dict blames the actual binding elements.

Only the open aggregation maths lives in core/; the dispatch and composition —
what makes this the engine's logical heuristic — live here.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from core.aggregation import OPERATORS, attributed
from core.utils.normalization import normalize_category_name
from schemas.network import Edge, Node


def parent_categories(node: Node) -> set[str]:
    """The categories a node can supply/carry to a downstream consumer.

    A node participates in a category if it lists it among `node_categories` or
    supplies it (`supply_capacity`). The union of these across a target's parents
    is the set of categories the target depends on — dependency is **graph-driven**
    (ADR-0003): a node depends on a category because an edge connects it to a
    parent of that category, not because it declares a `category_dependency_profile`
    (those are optional guard parameters; their absence means worst-case default,
    i.e. full dependency / no protection).
    """
    cats: set[str] = set()
    if node.node_categories:
        cats.update(node.node_categories)
    if node.supply_capacity:
        cats.update(node.supply_capacity.keys())
    return cats


def _supplies(parent: Node, category: str) -> bool:
    """True if `parent` can supply `category` to a consumer.

    Either the parent explicitly participates in the category, or it declares no
    categories at all — in which case it is treated as a generic feeder that
    supplies whatever the consumer depends on (so tagging only the consumer
    still propagates). A parent tagged with *other* categories does NOT supply
    this one, preserving multi-category disambiguation.
    """
    pc = parent_categories(parent)
    return category in pc or not pc


def declared_categories(node: Node) -> set[str]:
    """The categories a node itself is associated with as a consumer.

    A node declares a dependency category by listing it in `node_categories` or by
    carrying a `category_dependency_profiles` entry for it. This is the
    consumer-side signal, complementing the supplier-side `parent_categories`.
    """
    cats: set[str] = set()
    if node.node_categories:
        cats.update(node.node_categories)
    if node.category_dependency_profiles:
        cats.update(node.category_dependency_profiles.keys())
    return cats


def logical_category_candidates(
    target: Node,
    incoming: list[Edge],
    node_func: dict[str, int],
    edge_func: dict[str, int],
    nodes: dict[str, Node],
    skip: frozenset[str] = frozenset(),
    intra_op: Optional[Callable[[str], Optional[str]]] = None,
    category_types: Optional[dict[str, str]] = None,
) -> dict[str, tuple[int, dict[str, float]]]:
    """Per-category logical candidates: ``{category -> (level, shares)}``.

    Stages 1–2 of the logical heuristic (deliverable + intracategorical `best_of`)
    for each dependency category, leaving the intercategorical conjunction to
    `compose_categories`. `skip` excludes categories owned by another mechanism
    (e.g. `SourceToDemands` categories handled by flow), so the dispatcher can run
    logical only for the categories flow does not cover and merge the two before
    composing.

    `category_types` (category name -> "Requisite" | "SourceToDemands") lets a
    parent's Requisite-typed categories always reach the target — see the
    unconditional-Requisite-inclusion note below. Omit only from call sites that
    have no config category types available (in which case the pre-existing
    overlap-only behaviour applies uniformly).
    """
    category_types = category_types or {}
    # Build the set of categories the target depends on.
    # Start from what the target itself declares.
    categories: set[str] = declared_categories(target)
    target_cats = frozenset(categories)
    for edge in incoming:
        parent = nodes.get(edge.source)
        if parent is None:
            continue
        parent_cats = parent_categories(parent)

        # A Requisite category the parent supplies always becomes a dependency
        # for the target, regardless of any overlap with the target's own
        # declared categories — a threshold dependency must never be silently
        # dropped just because the parent also happens to share another
        # category with the target. (Concretely: an inline pump/valve node
        # tagged ["water", "pumping"] feeding a "water"-declared consumer must
        # still gate that consumer on "pumping" — the shared "water" category
        # must not swallow the pump's Requisite dependency.)
        requisite_parent_cats = {
            c for c in parent_cats if category_types.get(c) == "Requisite"
        }
        categories.update(requisite_parent_cats)

        # Add the parent's OTHER (non-Requisite) categories only when there is
        # NO overlap between the target's declared categories and the parent's
        # FULL category set. A parent that shares a category with the target
        # already contributes through that shared category; blindly adding its
        # remaining categories would create spurious cross-category
        # dependencies (e.g., a digital+power node attaching a phantom power
        # dependency to a digital-only child that has its own redundant
        # digital suppliers). When there IS no overlap — or the parent is an
        # untagged generic feeder (parent_cats empty) — the edge represents a
        # genuine cross-category or generic dependency and the parent's
        # categories flow through normally.
        if not parent_cats or not target_cats.intersection(parent_cats):
            categories.update(parent_cats)
    categories -= skip

    candidates: dict[str, tuple[int, dict[str, float]]] = {}
    for category in categories:
        # Stage 1: deliverables from each contributing parent in this category.
        deliverables: dict[str, int] = {}   # edge_id -> delivered level
        binding: dict[str, str] = {}        # edge_id -> responsible element id
        for edge in incoming:
            parent = nodes.get(edge.source)
            if parent is None or not _supplies(parent, category):
                continue
            parent_level = node_func[edge.source]
            link_level = edge_func[edge.id]
            deliverables[edge.id] = min(parent_level, link_level)
            # The worse of (parent, edge) is the binding constraint to blame;
            # tie goes to the parent node (the substantive supplier).
            binding[edge.id] = edge.source if parent_level <= link_level else edge.id

        if not deliverables:
            continue

        # Stage 2: intracategorical aggregation. Default is best_of (redundancy);
        # an intracategorical rule may re-parameterise the operator for this
        # category at this target.
        operator = (intra_op(category) if intra_op else None) or "best_of"
        cg = attributed(operator, deliverables)
        candidates[category] = (cg.level, _rekey_shares(cg.shares, binding))

    return candidates


def compose_categories(
    candidates: dict[str, tuple[int, dict[str, float]]],
    inter_override: Optional[tuple[str, list[str]]] = None,
    n: Optional[int] = None,
) -> Optional[tuple[int, dict[str, float], frozenset[str]]]:
    """Stage 3: intercategorical conjunction across per-category candidates.

    Default: `worst_of` over the per-category levels (all categories needed).
    An intercategorical rule may pass `inter_override = (operator, categories)`
    to re-parameterise this: the operator is applied over exactly the listed
    categories, each at its candidate level or **N** when it produced no
    candidate (not degraded). The listed categories are **normalised** names
    (case-insensitive vocabulary, ADR-0002); they are matched against the actual
    candidate keys via the normaliser, so a rule may spell a category differently
    from the node's `node_categories`. Either way responsibility is taken from
    the binding (worst) categories — ties union per ADR-0003.

    Returns `(level, responsibility, binding_categories)`, or `None` when there
    are no candidates. `binding_categories` are the worst categories that set the
    level — the backup guard consults their profiles.
    """
    if not candidates:
        return None

    if inter_override is not None and n is not None:
        operator, categories = inter_override
        # Map each normalised override category to the real candidate key, so the
        # actual node-spelled key (not the normalised form) carries the blame.
        by_norm = {normalize_category_name(key): key for key in candidates}
        cat_level: dict[str, int] = {}
        cat_shares: dict[str, dict[str, float]] = {}
        for category in categories:
            actual = by_norm.get(category)
            if actual is not None:
                level, shares = candidates[actual]
                cat_level[actual] = level
                cat_shares[actual] = shares
            else:
                cat_level[category] = n  # not degraded → counts as full
        if not cat_level:
            return None
    else:
        operator = "worst_of"
        cat_level = {cat: level for cat, (level, _) in candidates.items()}
        cat_shares = {cat: shares for cat, (_, shares) in candidates.items()}

    inter = attributed(operator, cat_level)
    # Blame only binding categories that actually carry a share dict (the
    # degraded ones); missing-as-N categories contribute no responsibility.
    binding_with_shares = {c: w for c, w in inter.shares.items() if c in cat_shares}
    return inter.level, _compose(binding_with_shares, cat_shares), frozenset(inter.shares)


def eval_nested_func_ast(
    func_ast: dict[str, Any],
    candidates: dict[str, tuple[int, dict[str, float]]],
    nodes: dict[str, Node],
    n: int,
) -> Optional[tuple[int, dict[str, float], frozenset[str]]]:
    """Evaluate a nested function AST (e.g. worst_of(best_of(A, B), best_of(C, B)))
    over per-category candidates, returning (level, responsibility, binding).

    Arguments in the AST can be:
    - ``reference_node`` / ``reference_edge`` / ``reference_unknown``: resolved to
      the candidate of the node's primary category (the first category listed in
      ``node_categories`` that has a candidate). If no candidate exists the argument
      contributes ``n`` (fully operational, no blame) — the same convention as the
      flat intercategorical override for an un-degraded category.
    - ``reference_category``: looked up directly in ``candidates``; absent category
      → ``n``, no blame.
    - ``function``: sub-expression evaluated recursively.

    Returns ``None`` only when the entire outer function has no resolvable arguments
    at all (no candidates whatsoever), so the propagation loop can fall back to the
    default compose.
    """

    def _resolve(ast_node: dict[str, Any]) -> tuple[int, dict[str, float]]:
        kind = ast_node.get("type")

        if kind == "reference_category":
            cat = ast_node["name"]
            if cat in candidates:
                return candidates[cat]
            return n, {}  # category not degraded → fully operational, no blame

        if kind in ("reference_node", "reference_edge", "reference_unknown"):
            node = nodes.get(ast_node["name"])
            if node is not None:
                for cat in (node.node_categories or []):
                    if cat in candidates:
                        return candidates[cat]
            return n, {}  # no matching candidate → fully operational, no blame

        if kind == "function":
            op_name = ast_node["name"]
            if op_name not in OPERATORS:
                # Unknown operator inside a nested rule — skip, treat as fully operational.
                return n, {}
            args = ast_node.get("arguments", [])
            arg_results = [_resolve(a) for a in args]
            # Use str indices as keys so attributed() gets unique string keys per arg.
            levels = {str(i): r[0] for i, r in enumerate(arg_results)}
            if not levels:
                return n, {}
            agg = attributed(op_name, levels)
            # Propagate blame: weight each arg's element shares by the attribution.
            combined: dict[str, float] = {}
            for idx_str, weight in agg.shares.items():
                _, shares = arg_results[int(idx_str)]
                for elem, share in shares.items():
                    combined[elem] = combined.get(elem, 0.0) + weight * share
            return agg.level, combined

        return n, {}

    if func_ast.get("type") != "function":
        return None

    level, shares = _resolve(func_ast)
    return level, shares, frozenset()


def _rekey_shares(shares: dict[str, float], binding: dict[str, str]) -> dict[str, float]:
    """Map per-edge shares onto their binding element ids, summing collisions
    (two edges binding on the same element combine their shares).
    """
    out: dict[str, float] = {}
    for edge_id, share in shares.items():
        element = binding[edge_id]
        out[element] = out.get(element, 0.0) + share
    return out


def _compose(
    category_shares: dict[str, float],
    per_category: dict[str, dict[str, float]],
) -> dict[str, float]:
    """Fold the binding categories' element-level blame into one dict.

    `category_shares` weights each binding category (ties union per ADR-0003);
    within each, `per_category[g]` distributes that weight over its elements.
    """
    out: dict[str, float] = {}
    for category, weight in category_shares.items():
        for element, share in per_category[category].items():
            out[element] = out.get(element, 0.0) + weight * share
    return out
