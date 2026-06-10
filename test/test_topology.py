"""Tests for core/topology.py — incoming (upstream) closure over edges.

These pin the structural contract the flow heuristic's responsibility-share rule
relies on: given a target, find every element that transitively feeds it, with
cycles terminating cleanly.
"""
from schemas.network import Edge

from core.topology import (
    build_incoming_index,
    incoming_closure,
    parents,
)


def _edge(eid: str, source: str, target: str) -> Edge:
    # functionality is required (ge=1); value is irrelevant to topology.
    return Edge(id=eid, source=source, target=target, functionality=4)


def test_linear_chain_closure():
    # a -> b -> c -> target
    edges = [
        _edge("e1", "a", "b"),
        _edge("e2", "b", "c"),
        _edge("e3", "c", "target"),
    ]
    closure = incoming_closure("target", edges)
    assert closure.node_ids == {"a", "b", "c"}
    assert closure.edge_ids == {"e1", "e2", "e3"}


def test_target_excluded_even_with_self_feed_cycle():
    # target -> x -> target : a cycle through the target itself.
    edges = [
        _edge("e1", "target", "x"),
        _edge("e2", "x", "target"),
    ]
    closure = incoming_closure("target", edges)
    # x feeds target; target must not list itself as upstream.
    assert "target" not in closure.node_ids
    assert closure.node_ids == {"x"}
    assert closure.edge_ids == {"e1", "e2"}


def test_cycle_terminates():
    # a <-> b cycle, both feeding target — walk must not hang.
    edges = [
        _edge("e1", "a", "b"),
        _edge("e2", "b", "a"),
        _edge("e3", "b", "target"),
    ]
    closure = incoming_closure("target", edges)
    assert closure.node_ids == {"a", "b"}
    assert closure.edge_ids == {"e1", "e2", "e3"}


def test_diamond_collects_all_paths():
    # source -> l, source -> r, l -> target, r -> target
    edges = [
        _edge("e1", "source", "l"),
        _edge("e2", "source", "r"),
        _edge("e3", "l", "target"),
        _edge("e4", "r", "target"),
    ]
    closure = incoming_closure("target", edges)
    assert closure.node_ids == {"source", "l", "r"}
    assert closure.edge_ids == {"e1", "e2", "e3", "e4"}


def test_unrelated_subgraph_excluded():
    edges = [
        _edge("e1", "a", "target"),
        _edge("e2", "x", "y"),  # disconnected from target
    ]
    closure = incoming_closure("target", edges)
    assert closure.node_ids == {"a"}
    assert closure.edge_ids == {"e1"}


def test_target_with_no_incoming_is_empty():
    edges = [_edge("e1", "target", "downstream")]
    closure = incoming_closure("target", edges)
    assert closure.node_ids == frozenset()
    assert closure.edge_ids == frozenset()


def test_prebuilt_index_matches_inline():
    edges = [_edge("e1", "a", "b"), _edge("e2", "b", "target")]
    index = build_incoming_index(edges)
    via_index = incoming_closure("target", edges, index=index)
    inline = incoming_closure("target", edges)
    assert via_index == inline


def test_parents_returns_direct_incoming_only():
    edges = [
        _edge("e1", "a", "target"),
        _edge("e2", "b", "target"),
        _edge("e3", "c", "a"),  # grandparent, not a direct parent
    ]
    direct = parents("target", edges)
    assert {e.id for e in direct} == {"e1", "e2"}
