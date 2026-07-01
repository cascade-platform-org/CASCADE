"""Unit tests for the token-bucket limiter (auth/entitlement.py, ADR-0008)."""
from __future__ import annotations

import auth.entitlement as ent_mod
from auth.entitlement import TokenBucketLimiter


def test_unbounded_rate_always_allowed():
    lim = TokenBucketLimiter()
    for _ in range(1000):
        allowed, remaining = lim.try_consume("u", None)
        assert allowed
        assert remaining is None


def test_zero_rate_always_denied():
    lim = TokenBucketLimiter()
    allowed, remaining = lim.try_consume("u", 0)
    assert not allowed
    assert remaining == 0.0


def test_burst_up_to_capacity_then_denied(monkeypatch):
    frozen = [1000.0]
    monkeypatch.setattr(ent_mod.time, "monotonic", lambda: frozen[0])
    lim = TokenBucketLimiter()

    for _ in range(3):  # a fresh bucket starts full (capacity == rate)
        assert lim.try_consume("u", 3)[0]
    allowed, remaining = lim.try_consume("u", 3)
    assert not allowed
    assert remaining < 1


def test_refill_over_time(monkeypatch):
    frozen = [1000.0]
    monkeypatch.setattr(ent_mod.time, "monotonic", lambda: frozen[0])
    lim = TokenBucketLimiter()

    for _ in range(60):  # rate 60/min == 1 token/sec; drain the full bucket
        assert lim.try_consume("u", 60)[0]
    assert not lim.try_consume("u", 60)[0]

    frozen[0] += 2.0  # two seconds later ~2 tokens have dripped back
    assert lim.try_consume("u", 60)[0]
    assert lim.try_consume("u", 60)[0]
    assert not lim.try_consume("u", 60)[0]


def test_cost_greater_than_one(monkeypatch):
    frozen = [0.0]
    monkeypatch.setattr(ent_mod.time, "monotonic", lambda: frozen[0])
    lim = TokenBucketLimiter()

    allowed, remaining = lim.try_consume("u", 10, cost=10)
    assert allowed
    assert remaining == 0
    assert not lim.try_consume("u", 10, cost=1)[0]


def test_buckets_are_per_key(monkeypatch):
    frozen = [0.0]
    monkeypatch.setattr(ent_mod.time, "monotonic", lambda: frozen[0])
    lim = TokenBucketLimiter()

    assert lim.try_consume("a", 1)[0]
    assert not lim.try_consume("a", 1)[0]  # a is drained
    assert lim.try_consume("b", 1)[0]      # b is independent


def test_reset_clears_all_buckets(monkeypatch):
    frozen = [0.0]
    monkeypatch.setattr(ent_mod.time, "monotonic", lambda: frozen[0])
    lim = TokenBucketLimiter()

    assert lim.try_consume("a", 1)[0]
    assert not lim.try_consume("a", 1)[0]
    lim.reset()
    assert lim.try_consume("a", 1)[0]  # full again after reset
