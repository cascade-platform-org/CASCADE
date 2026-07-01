"""
auth/entitlement.py — per-user engine-evaluation budget (ADR-0008).

A **token bucket** is a rate limiter you can picture as a bucket that holds up
to `capacity` tokens and refills at a steady drip. Each engine evaluation spends
one token; a request that cannot afford its cost is refused rather than queued.
A short burst is allowed (spend the whole bucket at once) but the long-run
average is capped at the refill rate — here, `evals_per_minute` per role.

State is in-process (a dict of buckets). That is why the v1 deployment runs a
SINGLE backend instance (see deployment.md / ADR-0008); a multi-instance
deployment would need a shared store (e.g. Redis). The bucket resets on restart,
which for a rate limiter is harmless (it only ever grants *more* budget).
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional


@dataclass
class _Bucket:
    tokens: float
    updated: float  # monotonic timestamp of the last refill


class TokenBucketLimiter:
    """Thread-safe per-key token bucket keyed by user id."""

    def __init__(self) -> None:
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def try_consume(
        self, key: str, rate_per_minute: Optional[int], cost: int = 1
    ) -> tuple[bool, Optional[float]]:
        """Attempt to spend `cost` tokens for `key`.

        Returns (allowed, tokens_remaining). When `rate_per_minute` is None the
        key is unbounded: always allowed, remaining is None.
        """
        if rate_per_minute is None:
            return True, None
        if rate_per_minute <= 0:
            return False, 0.0

        capacity = float(rate_per_minute)
        refill_per_second = capacity / 60.0
        now = time.monotonic()

        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                # New users start with a full bucket.
                bucket = _Bucket(tokens=capacity, updated=now)
                self._buckets[key] = bucket
            else:
                elapsed = now - bucket.updated
                bucket.tokens = min(capacity, bucket.tokens + elapsed * refill_per_second)
                bucket.updated = now

            if bucket.tokens >= cost:
                bucket.tokens -= cost
                return True, bucket.tokens
            return False, bucket.tokens

    def reset(self) -> None:
        """Drop all buckets (used by tests)."""
        with self._lock:
            self._buckets.clear()


# Process-wide singleton — the whole point is shared state across requests.
_limiter = TokenBucketLimiter()


def get_limiter() -> TokenBucketLimiter:
    return _limiter
