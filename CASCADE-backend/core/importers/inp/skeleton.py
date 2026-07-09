"""
core/importers/inp/skeleton.py — reduce a WNTR network to a target node count.

WNTR's `wntr.morph.skeletonize` removes hydraulic detail below a pipe-diameter
threshold (branch trimming, series and parallel pipe merges) while
redistributing the removed junctions' demand onto retained neighbours — total
demand mass is conserved. Its knob is a *diameter*, not a size, so this module
searches the ascending list of distinct pipe diameters for the smallest
threshold whose skeleton fits the requested node budget (more merging never
adds nodes back, so the search is monotone).

Reservoirs, tanks, pumps and valves are never removed by WNTR skeletonization —
sources and controls survive at every threshold.

Runs with `use_epanet=True`: skeletonization internally solves the network's
hydraulics to decide flow directions for merging. The alternative
(`use_epanet=False`) uses WNTR's pure-Python `WNTRSimulator`, which does not
implement every EPANET valve/headloss type (observed in the wild: PBV and GPV
valves, C-M and D-W headloss) — real utility `.inp` exports use these
routinely, and hitting one crashes the import. `use_epanet=True` instead
shells out to the real EPANET toolkit binary WNTR bundles, which supports the
full vocabulary; it was also faster in measurement (Cassacco, 419→72 nodes:
0.38 s vs 0.51 s).
"""
from __future__ import annotations

import threading
from typing import Any

import wntr
from wntr.morph import skeletonize


class SkeletonError(ValueError):
    """Raised when no diameter threshold reaches the requested node budget."""


# `skeletonize(..., use_epanet=True)` always writes to relative `temp.inp` /
# `temp.rpt` / `temp.bin` — WNTR does not expose a file_prefix for this
# codepath. The backend runs one worker process (Dockerfile), so a
# process-wide lock is sufficient to keep two concurrent imports' calls from
# corrupting each other's temp files.
_SKELETONIZE_LOCK = threading.Lock()


def _node_count(wn: wntr.network.WaterNetworkModel) -> int:
    return wn.num_nodes


def _merged_map(skeleton_map: dict) -> dict[str, list[str]]:
    """WNTR's map is {retained: [absorbed…, itself]} — drop self-references and
    empty entries so node properties only list *foreign* absorbed elements."""
    result: dict[str, list[str]] = {}
    for retained, absorbed in skeleton_map.items():
        others = sorted(a for a in absorbed if a != retained)
        if others:
            result[retained] = others
    return result


def skeletonize_to_target(
    wn: wntr.network.WaterNetworkModel,
    target_nodes: int,
) -> tuple[wntr.network.WaterNetworkModel, dict[str, list[str]], float | None]:
    """Skeletonize until `num_nodes <= target_nodes`.

    Returns `(reduced_model, merged_map, threshold_used)`. When the network is
    already within budget the original model is returned unchanged
    (`threshold_used = None`). Raises SkeletonError when even the coarsest
    threshold cannot reach the budget (the irreducible core — sources, pumps,
    high-degree junctions — is larger than the target).
    """
    if _node_count(wn) <= target_nodes:
        return wn, {}, None

    diameters = sorted({pipe.diameter for _, pipe in wn.pipes()})
    if not diameters:
        raise SkeletonError("Network has no pipes to skeletonize.")

    # Ascending thresholds: each candidate keeps only pipes *strictly larger*
    # relevant to merging; the epsilon ensures pipes exactly at the diameter
    # are included in the merge set.
    candidates = [d + 1e-9 for d in diameters]

    def _skeletonize_at(threshold: float) -> tuple[wntr.network.WaterNetworkModel, dict]:
        try:
            with _SKELETONIZE_LOCK:
                result: Any = skeletonize(
                    wn, threshold, use_epanet=True, return_map=True, return_copy=True
                )
            return result
        except Exception as exc:
            # Defense in depth: convert any unexpected EPANET/WNTR failure
            # (malformed topology, solver non-convergence, …) into our typed
            # error instead of letting it propagate raw.
            raise SkeletonError(f"Skeletonization failed: {exc}") from exc

    best: tuple[wntr.network.WaterNetworkModel, dict, float] | None = None
    coarsest_node_count: int | None = None
    lo, hi = 0, len(candidates) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        threshold = candidates[mid]
        reduced, skeleton_map = _skeletonize_at(threshold)
        if mid == len(candidates) - 1:
            # An all-fail search always probes the coarsest threshold on its
            # way to lo==hi==len-1 (hi only ever decreases on success) —
            # remember its node count so the error path below never needs a
            # second (redundant, full-cost) skeletonize + EPANET solve.
            coarsest_node_count = _node_count(reduced)
        if _node_count(reduced) <= target_nodes:
            best = (reduced, skeleton_map, threshold)
            hi = mid - 1  # try a finer threshold that still fits
        else:
            lo = mid + 1

    if best is None:
        assert coarsest_node_count is not None  # the loop always probes candidates[-1] on this path
        raise SkeletonError(
            f"Cannot reduce below {coarsest_node_count} nodes "
            f"(target was {target_nodes}). Sources, pumps and junction topology "
            f"set the irreducible core — raise the target."
        )

    reduced, skeleton_map, threshold = best
    return reduced, _merged_map(skeleton_map), threshold
