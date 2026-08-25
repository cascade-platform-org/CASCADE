# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
"""
engine/propagation.py — Propagation engine (PRIVATE IP).

Proposal phase runs two sub-steps per round (ADR-0005):
  1. Universal Requisite pass — logical aggregation over every incoming edge for
     every node, regardless of category type (best_of within source-category group,
     worst_of across groups). Absent profile → dependency_level = N (full dependency).
  2. SourceToDemands flow pass — priority min-cost max-flow for demanding nodes.
     Both passes merge per category via worst_of before the guard phase.

Pipeline per round (ADR-0003 → propose → guard → commit):
  - effective edge Functionality is refreshed: worst_of(intrinsic, source) (ADR-0004)
  - each node gets a logical proposal `P`; commit `worst_of(current, P)`
Rounds repeat until no Element worsens (a fixed point). Because Functionality is a
bounded-below integer that only ever decreases, the loop is guaranteed to
terminate; a generous round cap guards against pathological inputs and emits a
"convergence not reached" warning rather than looping forever.

Public interface (the only thing services/ may call):
    run(request: PropagationRequest) -> PropagationResult
"""
from __future__ import annotations

from datetime import datetime, timezone

from core.topology import build_incoming_index
from engine import guards
from engine.flow import ALLOCATIONS, DEFAULT_ALLOCATION, flow_category_candidates, is_flow_consumer
from engine.logical import compose_categories, eval_nested_func_ast, logical_category_candidates, parent_categories
from engine.rules_eval import RuleContext
from schemas.results import ElementUpdate, PropagationRequest, PropagationResult

# The heuristic id (api/propagation_routes.py's capability catalog) whose
# `allocation` param selects the flow pass's scarcity strategy.
_FLOW_HEURISTIC_ID = "source-to-demands-flow"


def _resolve_flow_allocation(request: PropagationRequest) -> str:
    """Scarcity-allocation strategy for this run's flow pass, from the graph
    types of the (already scope-filtered) project's canvases: the first canvas
    whose GraphTypeConfig carries an enabled "source-to-demands-flow"
    heuristic with a valid `allocation` param wins; anything else (no config,
    no heuristic entry, unknown value) falls back to DEFAULT_ALLOCATION.
    Resolved once per run, not per category — the flow pass is project-wide,
    and one canvas's graph type declaring a strategy is the modeller's intent
    for the scenario, not for a single resource."""
    by_name = {gt.name: gt for gt in request.config.graph_types or []}
    for canvas in request.project.canvases:
        graph_type = by_name.get(canvas.graph.graph_type)
        if graph_type is None:
            continue
        for heuristic in graph_type.heuristics:
            if heuristic.id != _FLOW_HEURISTIC_ID or not heuristic.enabled:
                continue
            allocation = (heuristic.params or {}).get("allocation")
            if allocation in ALLOCATIONS:
                return allocation
    return DEFAULT_ALLOCATION


def run(request: PropagationRequest) -> PropagationResult:
    nodes = request.project.nodes
    edges = list(request.project.edges.values())

    # --- working state -----------------------------------------------------
    node_func: dict[str, int] = {nid: n.functionality for nid, n in nodes.items()}
    node_ft: dict[str, int] = {nid: (n.functionality_time or 0) for nid, n in nodes.items()}
    edge_intrinsic: dict[str, int] = {e.id: e.functionality for e in edges}
    edge_func: dict[str, int] = dict(edge_intrinsic)
    node_resp: dict[str, dict[str, float]] = {}  # final blame for degraded nodes
    # Generic attribute-set rule state (ADR-0015). `attr_overlay` holds values a
    # rule has written this run, keyed by element id then attribute; `attr_latched`
    # remembers which (element, attribute) pairs a rule has already set so each is
    # applied at most once — a set-once latch that keeps the fixed point
    # terminating for these non-monotone attributes.
    attr_overlay: dict[str, dict[str, object]] = {}
    attr_latched: set[tuple[str, str]] = set()

    incoming_index = build_incoming_index(edges)
    edges_by_id = {e.id: e for e in edges}
    rules = RuleContext(nodes, edges, request.config)

    # ADR-0005: Universal Requisite runs for every node over every incoming edge
    # regardless of category type. SourceToDemands flow is an additive layer on top.
    # The two passes are merged per category via worst_of before the guard phase.
    category_types = {c.name: c.category_type for c in request.config.categories}
    flow_categories = [
        name for name, ctype in category_types.items() if ctype == "SourceToDemands"
    ]
    flow_allocation = _resolve_flow_allocation(request)

    # N = the best (highest) Functionality level. Derive it from the maximum
    # configured level, NOT from len(functionality_scale): the scale need not be a
    # contiguous 1..N (the schema only enforces level >= 1), and the guards use N
    # as the ceiling — a wrong N would let dependency_level attenuation clamp a
    # healthy category *below* its real level, originating a degradation a guard
    # must never originate.
    scale_size = max(
        (lvl.level for lvl in request.config.functionality_scale), default=1
    )
    max_rounds = (len(nodes) + 1) * scale_size + 5

    # For each node, precompute which SourceToDemands categories to skip in the
    # Requisite pass. A category is skipped only when BOTH hold:
    #   - the node itself is a demand-bearing flow consumer of it (otherwise the
    #     flow pass produces no candidate for this node and skipping would erase
    #     the dependency entirely — e.g. a node that left the category but is
    #     still fed by its suppliers must keep the Requisite floor), and
    #   - every parent that supplies it is explicitly tagged with that same
    #     category — meaning the flow pass fully captures the dependency and
    #     the Requisite floor would be an unfair ceiling.
    # Cross-category parents or untagged feeders prevent the skip.
    requisite_skip: dict[str, frozenset[str]] = {}
    for nid in nodes:
        skip: set[str] = set()
        all_parents = [nodes[e.source] for e in incoming_index.get(nid, []) if e.source in nodes]
        for cat in flow_categories:
            if (
                is_flow_consumer(nodes[nid], cat)
                and all_parents
                and all(cat in parent_categories(p) for p in all_parents)
            ):
                skip.add(cat)
        requisite_skip[nid] = frozenset(skip)

    # --- fixed-point iteration --------------------------------------------
    iterations = 0
    converged = False
    while iterations < max_rounds:
        iterations += 1
        changed = False

        # Refresh effective edge Functionality from current source levels.
        for edge in edges:
            source_level = node_func.get(edge.source)
            edge_func[edge.id] = (
                min(edge_intrinsic[edge.id], source_level)
                if source_level is not None
                else edge_intrinsic[edge.id]
            )

        # Solve flow once per SourceToDemands category; collect per-node candidates.
        flow_candidates: dict[str, dict[str, tuple[int, dict[str, float]]]] = {}
        for category in flow_categories:
            for nid, candidate in flow_category_candidates(
                category, nodes, edges, node_func, edge_func, scale_size,
                allocation=flow_allocation,
            ).items():
                flow_candidates.setdefault(nid, {})[category] = candidate

        # Resolver for specific-rule conditions against the current round's state.
        resolve = _make_resolver(
            nodes, edges_by_id, node_func, edge_func, node_ft, attr_overlay
        )

        # Propose → guard → commit per node.
        for nid in nodes:
            node = nodes[nid]
            current = node_func[nid]

            # Propose — two sub-steps, merged per category via worst_of (ADR-0005).
            # 1. Universal Requisite pass: logical aggregation over all incoming edges,
            #    all categories. SourceToDemands categories whose every contributing
            #    parent is explicitly in that category are skipped — the flow pass
            #    fully captures those dependencies.
            candidates = logical_category_candidates(
                node, incoming_index.get(nid, []), node_func, edge_func, nodes,
                skip=requisite_skip[nid],
                intra_op=lambda category, _nid=nid: rules.intra_operator(_nid, category),
                category_types=category_types,
            )
            # 2. SourceToDemands flow pass: additive layer. Merge each flow candidate
            #    into the running dict via worst_of so neither pass silently overwrites.
            for category, (flow_level, flow_shares) in flow_candidates.get(nid, {}).items():
                if category not in candidates:
                    candidates[category] = (flow_level, flow_shares)
                else:
                    log_level, log_shares = candidates[category]
                    if flow_level < log_level:
                        candidates[category] = (flow_level, flow_shares)
                    elif flow_level == log_level:
                        merged = dict(log_shares)
                        for k, v in flow_shares.items():
                            merged[k] = merged.get(k, 0.0) + v
                        total = sum(merged.values()) or 1.0
                        candidates[category] = (flow_level, {k: v / total for k, v in merged.items()})

            # Guard 1 — dependency_level attenuation, per category.
            for category, (level, shares) in candidates.items():
                dep = guards.dependency_level(node, category, scale_size)
                candidates[category] = (
                    guards.attenuate(level, dep, scale_size),
                    shares,
                )

            # Compose; an intercategorical rule may re-parameterise the operator.
            proposal = compose_categories(
                candidates, rules.inter_override(nid), scale_size
            )

            # Nested intercategorical override: a rule whose outer function contains
            # sub-functions (e.g. worst_of(best_of(A, B), best_of(C, B))). This
            # replaces the compose result because it defines a richer grouping that
            # the flat (operator, categories) API cannot represent.
            nested_ast = rules.nested_inter_ast(nid)
            if nested_ast is not None:
                nested = eval_nested_func_ast(nested_ast, candidates, nodes, scale_size)
                if nested is not None:
                    proposal = nested

            # Guard 3 — specific-rule override (highest priority): a firing
            # specific rule replaces the proposal outright (blame = the elements
            # its condition references). Still clamped to worsening at commit.
            override = rules.specific_override(nid, resolve)
            if override is not None:
                level, blame = override
                proposal = (level, blame, frozenset())

            if proposal is None:
                continue
            level, responsibility, binding = proposal
            if level >= current:  # monotone commit: only worsening sticks
                continue

            # Guard 2 — backup deferral, per category: a binding category with
            # backup has its drop deferred into functionality_time (the reserve
            # keeps that dependency served against ANY drop, not just critical).
            # But a backup covers ONLY its own category — a concurrent drop
            # carried by categories WITHOUT backup must still commit this round.
            # The immediate commit is what the proposal composes to once every
            # backed category is excluded (treated as "fine while the reserve
            # lasts"). A node already counting down holds without refreshing
            # its countdown.
            durations = [
                d
                for category in binding
                if (d := guards.backup_duration(node, category)) is not None
            ]
            if durations:
                # Worse (shortest) reserve wins: the node degrades when the
                # FIRST backup runs out. An already-running countdown is
                # tightened, never extended or refreshed.
                pending = min(durations)
                node_ft[nid] = pending if node_ft[nid] == 0 else min(node_ft[nid], pending)
                unbacked = {
                    category: candidate
                    for category, candidate in candidates.items()
                    if guards.backup_duration(node, category) is None
                }
                fallback = (
                    compose_categories(unbacked, rules.inter_override(nid), scale_size)
                    if unbacked
                    else None
                )
                if nested_ast is not None and unbacked:
                    nested = eval_nested_func_ast(nested_ast, unbacked, nodes, scale_size)
                    if nested is not None:
                        fallback = nested
                if fallback is None:
                    continue  # every candidate was backed — pure deferral
                level, responsibility, _unbacked_binding = fallback
                if level >= current:
                    continue  # the unbacked categories alone worsen nothing now

            node_func[nid] = level
            node_resp[nid] = responsibility
            changed = True

        # Generic attribute-set rules (ADR-0015): apply every firing assignment
        # as a set-once latch. Evaluated after the functionality sub-step so a
        # condition sees this round's committed functionality; the overlay makes a
        # rule-set attribute visible to later rules' conditions. First writer to a
        # given (element, attribute) wins and is never overwritten — this is what
        # bounds the loop for these non-monotone attributes.
        for target, attribute, value in rules.firing_attr_assignments(resolve):
            if (target, attribute) in attr_latched:
                continue
            attr_latched.add((target, attribute))
            current = attr_overlay.get(target, {}).get(
                attribute, _stored_attribute(nodes, edges_by_id, target, attribute)
            )
            if current != value:
                attr_overlay.setdefault(target, {})[attribute] = value
                changed = True

        if not changed:
            converged = True
            break

    # --- assemble updates (only changed elements) -------------------------
    # Accumulate per element so a functionality change and a rule-set attribute on
    # the same element merge into ONE update rather than two.
    acc: dict[str, ElementUpdate] = {}
    for nid, node in nodes.items():
        functionality_changed = node_func[nid] < node.functionality
        ft_changed = node_ft[nid] != (node.functionality_time or 0)
        if functionality_changed or ft_changed:
            acc[nid] = ElementUpdate(
                id=nid,
                functionality=node_func[nid],
                functionality_time=node_ft[nid] if ft_changed else None,
                responsibility_share=node_resp.get(nid) or None,
            )
    for edge in edges:
        if edge_func[edge.id] < edge_intrinsic[edge.id]:
            # An edge degrades only because its source did (ADR-0004), so the
            # source carries the responsibility.
            acc[edge.id] = ElementUpdate(
                id=edge.id,
                functionality=edge_func[edge.id],
                responsibility_share={edge.source: 1.0},
            )

    # Fold in generic attribute-set results (ADR-0015). A recognised first-class
    # field fills its typed ElementUpdate slot; anything else lands in `properties`.
    # An element touched only by an attribute rule still needs a (required)
    # functionality value — emit its unchanged current level.
    _FIRST_CLASS = {"direct_damage", "expected_repair_time", "functionality_time"}
    for eid, attrs in attr_overlay.items():
        entry = acc.get(eid)
        if entry is None:
            current_func = node_func[eid] if eid in nodes else edge_func[eid]
            entry = ElementUpdate(id=eid, functionality=current_func)
            acc[eid] = entry
        for attribute, value in attrs.items():
            if attribute in _FIRST_CLASS:
                setattr(entry, attribute, value)
            else:
                props = entry.properties or {}
                props[attribute] = value
                entry.properties = props

    updates: list[ElementUpdate] = list(acc.values())

    warnings: list[str] = list(rules.warnings)
    if not converged:
        warnings.append("convergence not reached")

    return PropagationResult(
        scope=request.scope,
        updates=updates,
        computed_at=datetime.now(tz=timezone.utc),
        iterations=iterations,
        warnings=warnings,
    )


def _stored_attribute(nodes, edges_by_id, element_id, attribute):
    """The element's stored value for `attribute` (first-class field, else a
    `properties` entry), or None. Used to skip a no-op attribute-set rule whose
    value already matches what the element carries."""
    element = nodes.get(element_id) or edges_by_id.get(element_id)
    if element is None:
        return None
    value = getattr(element, attribute, None)
    if value is None and element.properties:
        value = element.properties.get(attribute)
    return value


def _make_resolver(nodes, edges_by_id, node_func, edge_func, node_ft, attr_overlay):
    """Build a resolver for rule conditions: (node_type, name, attribute) → value.

    Functionality and functionality_time read the live working state; an attribute
    a rule has set this run is read from `attr_overlay` (so one rule's assignment
    is visible to another rule's condition, ADR-0015); any other attribute reads
    the element's stored field.
    """
    def resolve(node_type, name, attribute):
        overlay = attr_overlay.get(name)
        if overlay is not None and attribute in overlay:
            return overlay[attribute]
        if node_type == "edge":
            edge = edges_by_id.get(name)
            if edge is None:
                return None
            if attribute == "functionality":
                return edge_func.get(name)
            return getattr(edge, attribute, None)
        node = nodes.get(name)
        if node is None:
            return None
        if attribute == "functionality":
            return node_func.get(name)
        if attribute == "functionality_time":
            return node_ft.get(name)
        result = getattr(node, attribute, None)
        if result is None and node.properties:
            result = node.properties.get(attribute)
        return result

    return resolve
