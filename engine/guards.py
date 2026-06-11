"""
engine/guards.py — Proposal guards (PRIVATE IP).

Guards run in the Guard phase of the pipeline (ADR-0003 → Guard mechanics): they
read a proposal and modulate its severity. They never originate a degradation.
This module provides the two built-in guards as pure helpers; the round loop in
propagation.py applies them in the canonical order `dependency_level → backup`
(rule-override, the third guard, waits on rule evaluation).

Both read `category_dependency_profiles[category]`; an absent profile means the
worst-case default (full dependency, no backup).
"""
from __future__ import annotations

from schemas.network import Node


def _profile(node: Node, category: str):
    return (node.category_dependency_profiles or {}).get(category)


def dependency_level(node: Node, category: str, n: int) -> int:
    """The node's dependency level for a category, clamped to `[1, N]`.

    Absent profile or unset level → `N` (full dependency, no attenuation), the
    worst-case default. Clamping guards against a configured value above `N`
    (which would otherwise turn the attenuation shift negative and *worsen* the
    proposal).
    """
    profile = _profile(node, category)
    if profile is None or profile.dependency_level is None:
        return n
    return max(1, min(n, profile.dependency_level))


def attenuate(level: int, dep: int, n: int) -> int:
    """Linear-shift attenuation (ADR-0003): `min(N, level + (N − dep))`.

    `dep = N` passes the full drop; `dep = 1` neutralises any drop (shift `N−1`
    ≥ the maximum possible drop); intermediate values reduce the drop linearly.
    Clamped at `N` (not at the node's current level): this runs **per category**
    before composition, so a healthy category must keep its full level — clamping
    to `current` here would wrongly drag every category down to the node's level
    and defeat a loosening intercategorical rule. Monotonicity is enforced later
    by the commit (`worst_of(current, proposal)`).
    """
    return min(n, level + (n - dep))


def backup_duration(node: Node, category: str) -> int | None:
    """Backup deferral hours for a category, or None when the node has no usable
    backup there (no profile, `backup` off, or no positive `backup_duration`)."""
    profile = _profile(node, category)
    if profile is None or not profile.backup:
        return None
    if not profile.backup_duration or profile.backup_duration <= 0:
        return None
    return profile.backup_duration
