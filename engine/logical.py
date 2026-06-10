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

from typing import Optional

from core.aggregation import attributed
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
) -> dict[str, tuple[int, dict[str, float]]]:
    """Per-category logical candidates: ``{category -> (level, shares)}``.

    Stages 1–2 of the logical heuristic (deliverable + intracategorical `best_of`)
    for each dependency category, leaving the intercategorical conjunction to
    `compose_categories`. `skip` excludes categories owned by another mechanism
    (e.g. `SourceToDemands` categories handled by flow), so the dispatcher can run
    logical only for the categories flow does not cover and merge the two before
    composing.
    """
    # Union of what the target declares and what its parents supply, minus skips.
    categories: set[str] = declared_categories(target)
    for edge in incoming:
        parent = nodes.get(edge.source)
        if parent is not None:
            categories.update(parent_categories(parent))
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

        # Stage 2: intracategorical redundancy (best surviving supplier).
        cg = attributed("best_of", deliverables)
        candidates[category] = (cg.level, _rekey_shares(cg.shares, binding))

    return candidates


def compose_categories(
    candidates: dict[str, tuple[int, dict[str, float]]],
) -> Optional[tuple[int, dict[str, float]]]:
    """Stage 3: intercategorical conjunction across per-category candidates.

    `worst_of` over the per-category levels (all categories needed), with
    responsibility taken from the binding (worst) categories — ties union per
    ADR-0003. Accepts candidates from any mechanism (logical or flow), so it is
    the single composition point for a node's final proposal. Returns `None` when
    there are no candidates (the node keeps its level).
    """
    if not candidates:
        return None
    cat_level = {cat: level for cat, (level, _) in candidates.items()}
    cat_shares = {cat: shares for cat, (_, shares) in candidates.items()}
    inter = attributed("worst_of", cat_level)
    return inter.level, _compose(inter.shares, cat_shares)


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
