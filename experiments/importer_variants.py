"""
experiments/importer_variants.py — A/B test alternative IMPORTER attribute
derivations (edge capacity, orientation, supply) against the worst-situations
kits, WITHOUT touching any shipped backend file and WITHOUT re-running the
WNTR sweep.

First-principles motivation (why the importer axis, not just allocation):

EPANET solves head-based nonlinear equations (Hazen-Williams/D-W head loss,
Wagner PDD). Real pipes have NO hard capacity — pushing more flow just costs
more head. CASCADE approximates this with hard capacities derived from the
peak |velocity| each pipe reached across an import-time stress sweep
(sim.link_flow_profiles → map._pipe_capacity = π/4·d²·v). Two systematic
pessimism sources follow directly:

  1. CAPACITY: peak sweep velocity is conditional on the scenarios the sweep
     happened to exercise. Any hazard forcing MORE flow through a pipe than
     the sweep ever saw hits an artificial cap that real hydraulics doesn't
     have → engine too pessimistic. (Head loss does eventually bite in
     EPANET, so the cap isn't wrong in principle — just possibly too tight.)
  2. ORIENTATION: EPANET links are UNDIRECTED; CASCADE edges are frozen at
     the direction the sweep observed. A break pattern requiring a reversal
     the sweep never saw structurally disconnects consumers in CASCADE while
     EPANET happily reroutes (kit 05: 124 junctions at engine level 1 vs
     EPANET level 3 — a pure directed-graph cut).

Because every kit edge carries `diameter_m` and `velocity_ms` in properties,
all capacity variants are computable by rescaling the stored capacity —
no .inp re-import, no WNTR solve. Orientation variants add synthetic reverse
edges. Supply is re-derived (sum of incident non-synthetic capacities), the
same rule map.py uses.

GROUND-TRUTH CORRECTION (found while debugging kit 05): when a break pattern
severs a whole component from every source, EPANET's PDD system for that
component is SINGULAR — it converges without warning to an arbitrary internal
circulation (negative delivered demand at some junctions, positive at others,
summing to ~0). Verified on kit 05: JCASS_0008's 160-node component has zero
net inflow yet ~124 junctions read "fully served". Physically every junction
there gets nothing; CASCADE's level 1 is CORRECT and the raw FMS penalizes it.
So each kit's ground truth is corrected here: any demand junction with no
UNDIRECTED path to a source through non-broken elements → true level 1.
Both raw and corrected FMS are reported.

Run from the repo root:
  python experiments/importer_variants.py stage1          # baseline algo x all variants
  python experiments/importer_variants.py stage2 v1,v2    # fairshare on chosen variants
"""
from __future__ import annotations

import csv
import json
import math
import sys
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "CASCADE-backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import schemas.results  # noqa: E402,F401 -- rebuilds Project's forward refs
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Edge, Project  # noqa: E402

from algorithm_variants import compare, run_variant  # noqa: E402

KITS_ROOT = Path(__file__).resolve().parent / "worst-situations"
FLOW_UNIT_SCALE = 1_000_000.0  # mirrors map.FLOW_UNIT_SCALE (not imported: keep this file kit-only)
UNBOUNDED_SUPPLY = 10_000_000.0  # mirrors map.UNBOUNDED_SUPPLY_FALLBACK


# --- transform helpers -------------------------------------------------------

def _scale_caps(proj: Project, factor_fn) -> None:
    """Multiply each capacitated edge's capacity by factor_fn(kind, props, edge).
    factor_fn returning None leaves the edge untouched."""
    for e in proj.edges.values():
        props = e.properties or {}
        if e.capacity is None:
            continue
        f = factor_fn(props.get("kind"), props)
        if f is None or f == 1.0:
            continue
        e.capacity = e.capacity * f


def _velocity_factor(props: dict, new_v_fn) -> float | None:
    """Rescale a capacity computed as π/4·d²·v·share by replacing v with
    new_v_fn(v). Works for split edges too (share cancels)."""
    v = props.get("velocity_ms")
    if not v or v <= 0:
        return None
    return new_v_fn(v) / v


def _add_reverse_edges(proj: Project, frac: float) -> None:
    """Synthetic reverse edge for every ONE-WAY pipe (skip already-split
    __fwd/__rev pairs — those are bidirectional by construction). Mirrors the
    forward edge's functionality so a broken pipe stays broken both ways."""
    split_bases = {
        eid.rsplit("__", 1)[0]
        for eid in proj.edges
        if eid.endswith("__fwd") or eid.endswith("__rev")
    }
    new_edges: dict[str, Edge] = {}
    for eid, e in proj.edges.items():
        props = e.properties or {}
        if props.get("kind") != "pipe":
            continue
        if eid.endswith("__fwd") or eid.endswith("__rev") or eid in split_bases:
            continue
        rid = f"{eid}__synthrev"
        new_edges[rid] = Edge(
            id=rid, source=e.target, target=e.source,
            functionality=e.functionality,
            capacity=e.capacity * frac if e.capacity is not None else None,
            properties={**props, "synthetic_reverse": True},
        )
    proj.edges.update(new_edges)


def _recompute_supplies(proj: Project) -> None:
    """Re-derive Source supply = sum of incident edge capacities (map.py's
    rule), so supply stays consistent with modified pipe capacities. Skips
    synthetic reverse edges (would double-count the same physical pipe) and
    sources on the unbounded fallback."""
    incident: dict[str, float] = {}
    for e in proj.edges.values():
        if not e.capacity:
            continue
        if (e.properties or {}).get("synthetic_reverse"):
            continue
        for endpoint in (e.source, e.target):
            incident[endpoint] = incident.get(endpoint, 0.0) + e.capacity
    for node in proj.nodes.values():
        sc = node.supply_capacity
        if not sc or "water" not in sc:
            continue
        if math.isclose(sc["water"], UNBOUNDED_SUPPLY, rel_tol=1e-9):
            continue
        cap = incident.get(node.id, 0.0)
        if cap > 0:
            sc["water"] = cap


# --- variants ----------------------------------------------------------------

def _v_control(proj: Project) -> None:
    pass


def _v_vfloor(vmin: float):
    def apply(proj: Project) -> None:
        _scale_caps(proj, lambda kind, props: _velocity_factor(props, lambda v: max(v, vmin))
                    if kind in ("pipe", "valve") else None)
        _recompute_supplies(proj)
    return apply


def _v_constv(v_design: float):
    """Ignore the sweep signal entirely: capacity at one constant design
    velocity (π/4·d²·v_design). Tests whether the sweep helps at all."""
    def apply(proj: Project) -> None:
        _scale_caps(proj, lambda kind, props: _velocity_factor(props, lambda v: v_design)
                    if kind in ("pipe", "valve") else None)
        _recompute_supplies(proj)
    return apply


def _v_margin(k: float):
    def apply(proj: Project) -> None:
        _scale_caps(proj, lambda kind, props: k if kind in ("pipe", "valve") else None)
        _recompute_supplies(proj)
    return apply


def _v_bidir(frac: float):
    def apply(proj: Project) -> None:
        _add_reverse_edges(proj, frac)
    return apply


def _v_split_floor(min_share: float):
    """For each bidirectional split pipe (__fwd/__rev pair): floor BOTH
    directions at min_share × the pipe's full physical capacity (fwd+rev).
    min_share=1.0 = full duplex (either direction can carry the whole pipe).

    Motivated by kit 09: a tank's feeder pipe is dominated by RECHARGE flow in
    normal operation, so the proportional split hands the DISCHARGE direction
    ~0.1% of the pipe — but discharge is exactly the direction that matters
    when the tank's upstream feed breaks (the reversal sim.py's sweep declares
    out of scope). Physically a pipe carries its full capacity either way,
    just not both at once."""
    def apply(proj: Project) -> None:
        totals: dict[str, float] = {}
        for eid, e in proj.edges.items():
            if (eid.endswith("__fwd") or eid.endswith("__rev")) and e.capacity:
                base = eid.rsplit("__", 1)[0]
                totals[base] = totals.get(base, 0.0) + e.capacity
        for eid, e in proj.edges.items():
            if (eid.endswith("__fwd") or eid.endswith("__rev")) and e.capacity is not None:
                total = totals.get(eid.rsplit("__", 1)[0], 0.0)
                e.capacity = max(e.capacity, total * min_share)
        _recompute_supplies(proj)
    return apply


def _v_uncap_pv(proj: Project) -> None:
    """Pumps capped at their curve's max flow point + valves at π/4·d²·v may
    both undersize; lift the caps (None → engine default_cap)."""
    for e in proj.edges.values():
        if (e.properties or {}).get("kind") in ("pump", "valve"):
            e.capacity = None


def _v_supply_unbounded(proj: Project) -> None:
    """Isolate whether the 'supply = sum of incident caps' rule is a binding
    pessimism source at all."""
    for node in proj.nodes.values():
        sc = node.supply_capacity
        if sc and "water" in sc:
            sc["water"] = UNBOUNDED_SUPPLY


def _combo(*fns):
    def apply(proj: Project) -> None:
        for fn in fns:
            fn(proj)
    return apply


VARIANTS: dict[str, object] = {
    "control": _v_control,
    "vfloor_0.5": _v_vfloor(0.5),
    "vfloor_1.0": _v_vfloor(1.0),
    "vfloor_2.0": _v_vfloor(2.0),
    "constv_1.0": _v_constv(1.0),
    "constv_2.0": _v_constv(2.0),
    "margin_1.5": _v_margin(1.5),
    "margin_2.0": _v_margin(2.0),
    "margin_3.0": _v_margin(3.0),
    "margin_5.0": _v_margin(5.0),
    "bidir_1.0": _v_bidir(1.0),
    "bidir_0.5": _v_bidir(0.5),
    "uncap_pv": _v_uncap_pv,
    "supply_unbounded": _v_supply_unbounded,
    "split_floor_0.5": _v_split_floor(0.5),
    "split_full": _v_split_floor(1.0),
    # combos (candidates for stage 2, cheap enough to include in stage 1 too)
    "bidir+vfloor_1.0": _combo(_v_vfloor(1.0), _v_bidir(1.0)),
    "bidir+margin_1.5": _combo(_v_margin(1.5), _v_bidir(1.0)),
    "bidir+uncap_pv": _combo(_v_uncap_pv, _v_bidir(1.0)),
    "margin_2.0+split_full": _combo(_v_split_floor(1.0), _v_margin(2.0)),
    "margin_3.0+split_full": _combo(_v_split_floor(1.0), _v_margin(3.0)),
    "margin_2.0+split_0.5": _combo(_v_split_floor(0.5), _v_margin(2.0)),
}


# --- ground-truth correction ---------------------------------------------------

def _source_disconnected(project: Project) -> set[str]:
    """inp_ids of demand junctions with no UNDIRECTED path to any Source
    through functional (functionality > 1) nodes/edges — the set whose EPANET
    PDD 'ground truth' is a singular-system artifact (see module docstring).
    Built from the kit bundle itself: its edges/functionality mirror exactly
    what the ground-truth solve closed (broken links + t=0-closed links)."""
    adj: dict[str, list[str]] = {}
    for e in project.edges.values():
        if e.functionality <= 1:
            continue
        if (e.properties or {}).get("synthetic_reverse"):
            continue
        adj.setdefault(e.source, []).append(e.target)
        adj.setdefault(e.target, []).append(e.source)

    sources = [
        nid for nid, node in project.nodes.items()
        if node.supply_capacity and "water" in node.supply_capacity
        and node.functionality > 1
    ]
    seen = set(sources)
    queue = deque(sources)
    while queue:
        for nxt in adj.get(queue.popleft(), []):
            if nxt in seen:
                continue
            node = project.nodes.get(nxt)
            if node is None or node.functionality <= 1:
                continue
            seen.add(nxt)
            queue.append(nxt)

    out: set[str] = set()
    for nid, node in project.nodes.items():
        profile = (node.category_dependency_profiles or {}).get("water")
        if profile is None or not profile.demand:
            continue
        if nid not in seen:
            inp_id = (node.properties or {}).get("inp_id")
            if inp_id:
                out.add(inp_id)
    return out


# --- runner ------------------------------------------------------------------

def _load_kits():
    kits = []
    for kit in sorted(KITS_ROOT.iterdir()):
        bundle_path = kit / "scenario.bundle.json"
        epanet_path = kit / "epanet_result.json"
        if not kit.is_dir() or not bundle_path.exists() or not epanet_path.exists():
            continue
        bundle = json.loads(bundle_path.read_text())
        kits.append((
            kit.name,
            Project.model_validate(bundle["project"]),
            ModelConfiguration.model_validate(bundle["config"]),
            json.loads(epanet_path.read_text())["levels"],
        ))
    return kits


def run(algorithm: str, variant_names: list[str], out_name: str) -> None:
    kits = _load_kits()
    rows = []
    for kit_name, project, config, epanet_levels in kits:
        disconnected = _source_disconnected(project)
        corrected_levels = {
            jid: (1 if jid in disconnected else lvl)
            for jid, lvl in epanet_levels.items()
        }
        for vname in variant_names:
            proj = project.model_copy(deep=True)
            VARIANTS[vname](proj)
            proj2, result = run_variant(algorithm, "sweep", proj, config)
            fms_raw, _, _, _ = compare(result, proj2, epanet_levels)
            fms, too_pess, too_opt, matched = compare(result, proj2, corrected_levels)
            rows.append({
                "kit": kit_name, "algorithm": algorithm, "variant": vname,
                "fms": round(fms, 4), "fms_raw": round(fms_raw, 4),
                "n_disconnected": len(disconnected),
                "too_pessimistic": too_pess,
                "too_optimistic": too_opt, "matched": matched,
            })
            print(f"{kit_name:28s} {algorithm:24s} {vname:20s} "
                  f"FMS={fms:.3f} (raw {fms_raw:.3f}) pess={too_pess:4d} opt={too_opt:3d}", flush=True)

    out_csv = Path(__file__).resolve().parent / out_name
    with out_csv.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nWrote {out_csv}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "stage1"
    if stage == "stage1":
        run("water_network", list(VARIANTS), "importer_variants_stage1.csv")
    elif stage == "stage2":
        names = sys.argv[2].split(",") if len(sys.argv) > 2 else ["control"]
        run("water_network_fairshare", names, "importer_variants_stage2.csv")
    else:
        raise SystemExit(f"unknown stage {stage!r}")
