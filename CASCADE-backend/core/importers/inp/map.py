"""
core/importers/inp/map.py — WNTR WaterNetworkModel → CASCADE ProjectBundle.

Mapping rules (docs/adr — INP import):

  Reservoir            → Source node, supply_capacity["water"] = sum of its
                         outgoing pipe capacities
  Tank                 → Source node + water profile {backup, backup_duration}
                         (backup_duration = storage volume ÷ downstream demand:
                         the tank keeps supplying that long after its feeder
                         fails — the engine's backup guard defers the drop)
  Junction demand > 0  → Service node, water profile {demand, priority}
  Junction demand = 0  → Infrastructure node
  Pump link            → inline Infrastructure node (category "pumping") +
                         two half-edges — its Functionality gates downstream
                         flow via the universal Requisite pass
  Valve link           → inline Infrastructure node (category "valve"), same
  Pipe                 → edge, capacity = π/4·d²·v (m³/s), v from a baseline
                         hydraulic simulation per pipe (core/importers/inp/sim.py),
                         not a single assumed constant

Every node on the water path declares the "water" category — the engine's flow
pass only routes through category members. A pipe's direction is read off the
SIGN of its simulated flow (core.importers.inp.sim.link_flow_profiles) — not
guessed from graph topology — so plain and "reoriented" .inp variants import
identically. A pipe the sweep shows carrying meaningful flow in BOTH
directions (a loop pipe reversing as demand is pushed toward stress) becomes
TWO independently-capacitated edges, one each direction, splitting the pipe's
one physical capacity between them in proportion to how much each direction is
actually used. A pipe the sweep reports no signal for at all (isolated/idle
branch) falls back to a multi-source BFS from the Source set, exactly as
before this simulation-based orientation existed.

All hydraulic quantities are SI (WNTR normalises on parse) internally — used
for the physical calculations (pipe capacity, tank backup duration, downstream
demand sums). Flow-typed values written into the model (`demand`,
`supply_capacity`, edge `capacity`) are rescaled by `FLOW_UNIT_SCALE` — see
that constant's docstring for why this is not optional.
"""
from __future__ import annotations

import math
import secrets
from collections import deque
from typing import Any, Literal, Optional

import wntr
from pydantic import BaseModel, Field

# Importing schemas.results defines PropagationResult and rebuilds the models
# that forward-reference it (Project / PropagationScorecardEntry) — required
# before instantiating Project below.
import schemas.results  # noqa: F401

from core.importers.inp.geo import PlacementResult, place_nodes
from core.importers.inp.sim import (
    DECISIVE_VELOCITY_MS,
    FALLBACK_VELOCITY_MS,
    MIN_HEDGE_SHARE,
    NEGLIGIBLE_VELOCITY_MS,
    LinkFlowProfile,
)
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    EventDefinition,
    FunctionalityScaleLevel,
    GraphTypeConfig,
    ModelConfiguration,
)
from schemas.network import (
    Canvas,
    CategoryDependencyProfile,
    Edge,
    Graph,
    Node,
    Project,
    ProjectMeta,
)
from schemas.sync import ProjectBundle

DEFAULT_N_LEVELS = 3  # app default functionality scale size

# The engine's SourceToDemands flow heuristic (engine/flow.py, `_scaled`) feeds
# networkx's min-cost-flow solver, which requires INTEGER capacities/weights —
# it converts every float quantity via `round(value * 1000)` (fixed-point,
# millesimal resolution). Real water demand in SI units (m³/s) is tiny — a
# typical domestic connection is ~1e-5 to 1e-4 m³/s — so under that ×1000
# conversion EVERY SINGLE DEMAND IN A REAL NETWORK ROUNDS TO EXACTLY ZERO
# (verified on Cassacco_totale.inp: all 410 demand-bearing junctions). A
# zero-capacity demand-sink edge means the flow solver can never deliver
# anything to that node no matter how healthy the network is — every imported
# water network would show 100% of its consumers permanently critical on any
# Propagation, independent of actual topology or supply.
# The engine (CASCADE-backend/engine/) is protected/proprietary (CLAUDE.md
# §7, ADR-0009) and unit-agnostic by design — only ratios of demand / supply /
# capacity affect its output — so rescaling every flow-typed quantity by the
# same constant factor here, entirely within the importer, is a correctness
# fix that changes nothing about relative behaviour. mL/s (×1e6 from SI m³/s)
# keeps even the smallest realistic residential demand several orders of
# magnitude above the engine's rounding floor.
FLOW_UNIT_SCALE = 1_000_000.0


def _flow_units(value: float) -> float:
    """SI (m³/s) → the engine-safe unit `FLOW_UNIT_SCALE` defines. Apply this
    ONLY when writing a value into a Node/Edge field the flow heuristic reads
    (`demand`, `supply_capacity`, edge `capacity`) — never to values used in a
    genuinely physical calculation (e.g. tank backup_duration, which needs
    true SI m³/s to produce real hours)."""
    return value * FLOW_UNIT_SCALE

DemandMode = Literal["peak", "base", "avg"]

# Source supply_capacity is always the sum of a Reservoir/Tank's outgoing pipe
# capacities — not a user choice. A source with literally no capacitated
# outgoing pipe (degenerate/malformed data) has nothing sensible to derive
# from, so it falls back to this constant — comfortably above any realistic
# network's total demand (validated against Cassacco/Zampis ~2e3 and ky10
# ~9.5e4 in FLOW_UNIT_SCALE units) while staying well under the engine's
# INF_CAP sentinel after its own ×1000 scaling. A specific known real value is
# set by editing the node's `supply_capacity` in the Inspector after import —
# no dedicated import knob for that; the app already supports it.
UNBOUNDED_SUPPLY_FALLBACK = 10_000_000.0

# Ready-made scenario events (see build_bundle) — one blackout event shared
# by every imported network, so applying it always hits whatever pumps this
# specific import has, without per-pump event clutter.
BLACKOUT_EVENT_ID = "evt-blackout-pump-failure"
# No .inp data distinguishes real repair times per pump; a blanket estimate
# (power restoration + pump restart, not a structural rebuild) is a reasonable
# default the user can tune in Config once imported.
BLACKOUT_REPAIR_HOURS = 6

# One shared event for every tank's reserve countdown — same reasoning as
# BLACKOUT_EVENT_ID above.
TANK_RESERVE_EVENT_ID = "evt-tank-reserve"


def _wn_node(wn: Any, node_id: str) -> Any:
    """`wn.get_node` for an id taken from the model's own name lists — never
    None in practice; typed Any because WNTR ships no usable stubs."""
    return wn.get_node(node_id)


GRAPH_TYPE_NAME = "water_network"

# Fixed 3-stop gradient (red → orange → green) every generated scale
# interpolates across, matching the app's own default palette exactly.
_GRADIENT_STOPS = ((0xEF, 0x44, 0x44), (0xF9, 0x73, 0x16), (0x22, 0xC5, 0x5E))


def _gradient_color(t: float) -> str:
    """RGB hex at position `t` (0..1) along the red→orange→green gradient."""
    a, b, seg_t = (
        (_GRADIENT_STOPS[0], _GRADIENT_STOPS[1], t / 0.5)
        if t <= 0.5
        else (_GRADIENT_STOPS[1], _GRADIENT_STOPS[2], (t - 0.5) / 0.5)
    )
    r, g, bl = (round(a[i] + (b[i] - a[i]) * seg_t) for i in range(3))
    return f"#{r:02x}{g:02x}{bl:02x}"


def generate_scale(n_levels: int) -> list[FunctionalityScaleLevel]:
    """Build an `n_levels`-level functionality scale for the imported config.

    `n_levels == 3` reproduces the app's own hardcoded default exactly
    (critical / operational_warning / operational, the same three colors) —
    every other size gets generated generic labels (level 1 = "critical",
    level n = "operational", everything between = "degraded (i/n)") and a
    color interpolated along the same red→orange→green gradient the N=3
    default uses. Labels/colors are freely editable in Config after import —
    this only needs to be a reasonable starting point, not a final one.
    """
    if n_levels == DEFAULT_N_LEVELS:
        return [
            FunctionalityScaleLevel(level=1, label="critical", color="#ef4444"),
            FunctionalityScaleLevel(level=2, label="operational_warning", color="#f97316"),
            FunctionalityScaleLevel(level=3, label="operational", color="#22c55e"),
        ]
    levels: list[FunctionalityScaleLevel] = []
    for i in range(1, n_levels + 1):
        t = (i - 1) / (n_levels - 1)
        label = "critical" if i == 1 else "operational" if i == n_levels else f"degraded ({i}/{n_levels})"
        levels.append(FunctionalityScaleLevel(level=i, label=label, color=_gradient_color(t)))
    return levels


_CATEGORIES = [
    CategoryDefinition(name="water", category_type="SourceToDemands", color="#0ea5e9", icon="Droplet"),
    CategoryDefinition(name="pumping", category_type="Requisite", color="#f59e0b", icon="Fan"),
    CategoryDefinition(name="valve", category_type="Requisite", color="#8b5cf6", icon="CircleDot"),
]


class ImportOptions(BaseModel):
    """Knobs of the .inp mapping pipeline (defaults per ADR-0012).

    The single declaration of these knobs: `ImportInpRequest` (the API body)
    subclasses this model, so adding a knob here exposes it end-to-end without
    a field-by-field copy at the route.
    """

    demand_mode: DemandMode = Field(
        default="peak",
        description="Demand snapshot: base × max/mean pattern multiplier, or base alone.",
    )
    source_crs: str = Field(
        default="EPSG:3004",
        description="CRS of projected .inp coordinates (default Gauss-Boaga Est). "
                    "Ignored when coordinates are abstract drawing units.",
    )
    n_levels: int = Field(
        default=DEFAULT_N_LEVELS, ge=2,
        description="Size of the functionality scale (1..n_levels) node/edge "
                    "functionality values are expressed on. A scale is "
                    "auto-generated for this size (generate_scale) and emitted "
                    "in the imported config — unless the caller is merging "
                    "into an existing project, in which case this should be "
                    "set to that project's own functionality_scale length so "
                    "the imported values line up with it (the generated scale "
                    "itself is then discarded, not merged in).",
    )


# --- intermediate link representation ---------------------------------------

class _Link(BaseModel):
    id: str
    kind: Literal["pipe", "pump", "valve"]
    start: str
    end: str
    capacity: Optional[float]  # m³/s; None = engine default
    open_: bool
    properties: dict[str, Any]
    # Pipes only: peak |velocity| simulated each direction (see
    # core.importers.inp.sim.LinkFlowProfile). None on both = the sweep
    # reported no signal at all for this link — orientation falls back to
    # BFS. Pumps/valves never populate these; their orientation/direction is
    # unaffected by this mechanism.
    velocity_fwd: Optional[float] = None
    velocity_rev: Optional[float] = None


def _pipe_capacity(diameter_m: float, velocity: float) -> float:
    return math.pi / 4.0 * diameter_m**2 * velocity


def _demand_value(junction: Any, mode: DemandMode, wn: Any) -> float:
    """Demand in m³/s for one junction under the chosen mode."""
    total = 0.0
    for ts in junction.demand_timeseries_list:
        base = ts.base_value or 0.0
        mult = 1.0
        if mode != "base" and ts.pattern_name:
            try:
                m = wn.get_pattern(ts.pattern_name).multipliers
                if len(m):
                    mult = float(max(m)) if mode == "peak" else float(sum(m) / len(m))
            except KeyError:
                pass
        total += base * mult
    return total


def compute_junction_demands(wn: Any, mode: DemandMode) -> dict[str, float]:
    """Every junction's demand (SI m³/s) under `mode` — the single source both
    `build_bundle` (what demand gets emitted) and the baseline hydraulic solve
    (core.importers.inp.sim.link_flow_profiles — what demand pipe capacity is
    sized against) must agree on. Calling this once and passing the SAME dict
    to both keeps them consistent regardless of `mode`; computing it twice
    from the same (wn, mode) is deterministic, but callers should still
    prefer passing one shared dict where practical."""
    return {
        jid: _demand_value(_wn_node(wn, jid), mode, wn)
        for jid in wn.junction_name_list
    }


def _collect_links(
    wn: Any, flow_profiles: dict[str, LinkFlowProfile]
) -> list[_Link]:
    """`flow_profiles` — per-pipe/valve LinkFlowProfile from a baseline
    hydraulic sweep (core.importers.inp.sim.link_flow_profiles); a link
    absent from it (no flow across the sweep, or the solve failed) uses
    FALLBACK_VELOCITY_MS and carries no direction signal (velocity_fwd/rev
    stay None), which is exactly the signal build_bundle uses to fall back to
    BFS orientation for that one link."""
    links: list[_Link] = []
    pipe_names = set(wn.pipe_name_list)
    pump_names = set(wn.pump_name_list)
    for lid, link in wn.links():
        open_ = str(link.initial_status) not in ("Closed", "CLOSED", "2")
        if lid in pipe_names:
            profile = flow_profiles.get(lid)
            velocity = profile.peak if profile is not None else FALLBACK_VELOCITY_MS
            links.append(_Link(
                id=lid, kind="pipe", start=link.start_node_name, end=link.end_node_name,
                capacity=_pipe_capacity(link.diameter, velocity),
                open_=open_,
                velocity_fwd=profile.velocity_fwd if profile is not None else None,
                velocity_rev=profile.velocity_rev if profile is not None else None,
                properties={
                    "length_m": round(link.length, 2),
                    "diameter_m": round(link.diameter, 4),
                    "roughness": link.roughness,
                    "velocity_ms": round(velocity, 4),
                },
            ))
        elif lid in pump_names:
            cap: Optional[float] = None
            try:
                curve = link.get_pump_curve()
                if curve is not None and curve.points:
                    cap = max(x for x, _ in curve.points)
            except Exception:
                cap = None
            links.append(_Link(
                id=lid, kind="pump", start=link.start_node_name, end=link.end_node_name,
                capacity=cap,
                # A pump's .inp initial_status/pattern reflects one arbitrary
                # moment of a scheduled duty cycle (e.g. off overnight, or
                # waiting on a tank-level control) — not equipment failure.
                # CASCADE's baseline is a "working condition" snapshot: every
                # pump an operator CAN run is imported as operational, exactly
                # like every pipe/valve. A pump that is actually out of
                # service is represented the same way any other hazard is —
                # by applying the Blackout Hazard (or a bespoke one), not by
                # whatever the source file's t=0 schedule happened to be.
                open_=True,
                properties={"pump_type": str(getattr(link, "pump_type", ""))},
            ))
        else:  # valve
            diameter = getattr(link, "diameter", None)
            profile = flow_profiles.get(lid)
            velocity = profile.peak if profile is not None else FALLBACK_VELOCITY_MS
            links.append(_Link(
                id=lid, kind="valve", start=link.start_node_name, end=link.end_node_name,
                capacity=_pipe_capacity(diameter, velocity) if diameter else None,
                open_=open_,
                properties={
                    "valve_type": str(getattr(link, "valve_type", "")),
                    "setting": getattr(link, "initial_setting", None),
                    "velocity_ms": round(velocity, 4),
                },
            ))
    return links


def _orient_edges(
    edge_pairs: dict[str, tuple[str, str]],
    sources: set[str],
    *,
    fixed: dict[str, tuple[str, str]] | None = None,
) -> dict[str, tuple[str, str]]:
    """Multi-source BFS depth orientation: supply flows shallow → deep. This
    is the FALLBACK mechanism now — build_bundle only routes an edge through
    here when no simulated flow direction exists for it at all (see
    `link_flow_profiles` / `LinkFlowProfile` in sim.py).

    Edges between equal-depth nodes (mesh loops) and edges in components
    unreachable from any Source keep their .inp direction.

    `fixed` — edges whose direction is already known (from a solved
    simulation) and must NOT be reoriented here. They still contribute to the
    adjacency graph, so BFS depth for the genuinely ambiguous `edge_pairs`
    reflects the true, full topology rather than just the ambiguous subset.
    """
    fixed = fixed or {}
    all_pairs = {**edge_pairs, **fixed}
    adjacency: dict[str, list[str]] = {}
    for a, b in all_pairs.values():
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)

    depth: dict[str, int] = {s: 0 for s in sources if s in adjacency}
    queue = deque(depth)
    while queue:
        current = queue.popleft()
        for neighbour in adjacency.get(current, []):
            if neighbour not in depth:
                depth[neighbour] = depth[current] + 1
                queue.append(neighbour)

    oriented: dict[str, tuple[str, str]] = {}
    for eid, (a, b) in edge_pairs.items():
        da, db = depth.get(a), depth.get(b)
        if da is not None and db is not None and da > db:
            oriented[eid] = (b, a)
        else:
            oriented[eid] = (a, b)
    return oriented


def _downstream_demand(
    start: str,
    oriented: dict[str, tuple[str, str]],
    demands: dict[str, float],
) -> float:
    """Total demand reachable from `start` along oriented edges."""
    out_adj: dict[str, list[str]] = {}
    for a, b in oriented.values():
        out_adj.setdefault(a, []).append(b)
    seen = {start}
    queue = deque([start])
    total = 0.0
    while queue:
        for nxt in out_adj.get(queue.popleft(), []):
            if nxt not in seen:
                seen.add(nxt)
                total += demands.get(nxt, 0.0)
                queue.append(nxt)
    return total


def _unreachable_demand_nodes(
    oriented: dict[str, tuple[str, str]],
    sources: set[str],
    demands: dict[str, float],
) -> list[str]:
    """Demand-bearing junctions with no path from any Source along `oriented`
    edges. Should always be empty — a non-empty result means the imported
    graph structurally cannot ever deliver to these junctions regardless of
    hazards/disservices, which is worth surfacing as an import warning rather
    than silently showing up as "critical" once the project is opened."""
    out_adj: dict[str, list[str]] = {}
    for a, b in oriented.values():
        out_adj.setdefault(a, []).append(b)
    seen = set(sources)
    queue = deque(sources)
    while queue:
        for nxt in out_adj.get(queue.popleft(), []):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return sorted(jid for jid, d in demands.items() if d > 0 and jid not in seen)


def build_bundle(
    wn: wntr.network.WaterNetworkModel,
    *,
    name: str,
    options: ImportOptions | None = None,
    priorities: dict[str, int] | None = None,
    flow_profiles: dict[str, LinkFlowProfile] | None = None,
    merged_map: dict[str, list[str]] | None = None,
    warnings: list[str] | None = None,
) -> ProjectBundle:
    """Map a (possibly skeletonized) WNTR model to a CASCADE ProjectBundle.

    `priorities`     — junction id → 1..10 from the WNTR scarcity sweep (inp_sim).
    `flow_profiles`  — pipe/valve id → LinkFlowProfile from a baseline
                       hydraulic sweep on THIS SAME (already skeletonized)
                       model (inp_sim.link_flow_profiles); a link absent from
                       it falls back to FALLBACK_VELOCITY_MS and BFS
                       orientation. A pipe whose profile shows meaningful flow
                       in only one direction is oriented by that sign instead
                       of BFS; one showing meaningful flow in BOTH directions
                       becomes two independently-capacitated edges (see the
                       module docstring).
    `merged_map`     — retained id → original ids absorbed by skeletonization.
    `warnings`       — mutable list; non-fatal notes are appended for the caller.
    """
    options = options or ImportOptions()
    priorities = priorities or {}
    flow_profiles = flow_profiles or {}
    merged_map = merged_map or {}
    warnings = warnings if warnings is not None else []
    n = options.n_levels

    junction_names = set(wn.junction_name_list)
    source_names = set(wn.reservoir_name_list) | set(wn.tank_name_list)
    links = _collect_links(wn, flow_profiles)

    demands = compute_junction_demands(wn, options.demand_mode)

    # --- inline pump/valve nodes + edge pair endpoints ----------------------
    taken_ids = set(wn.node_name_list)

    def _fresh(base: str) -> str:
        candidate = base
        suffix = 2
        while candidate in taken_ids:
            candidate = f"{base}_{suffix}"
            suffix += 1
        taken_ids.add(candidate)
        return candidate

    inline_nodes: dict[str, _Link] = {}   # inline node id → originating link
    edge_meta: dict[str, _Link] = {}
    edge_capacity: dict[str, Optional[float]] = {}
    edge_direction: dict[str, str] = {}   # eid → "forward"/"reverse", split pipes only
    oriented_known: dict[str, tuple[str, str]] = {}   # direction already known (simulated)
    bfs_pairs: dict[str, tuple[str, str]] = {}         # no signal — needs the BFS fallback
    bidirectional_pipes: list[str] = []
    fallback_pipes: list[str] = []

    def _emit_split(link: _Link, share_fwd: float) -> None:
        """Two independently-capacitated edges for a pipe carrying meaningful
        flow both ways, splitting its ONE physical capacity in proportion to
        `share_fwd` (a single cross-section can't carry its full rated
        capacity in both directions at once)."""
        bidirectional_pipes.append(link.id)
        total_cap = link.capacity
        eid_fwd, eid_rev = f"e_{link.id}__fwd", f"e_{link.id}__rev"
        oriented_known[eid_fwd] = (link.start, link.end)
        edge_capacity[eid_fwd] = total_cap * share_fwd if total_cap is not None else None
        edge_meta[eid_fwd] = link
        edge_direction[eid_fwd] = "forward"
        oriented_known[eid_rev] = (link.end, link.start)
        edge_capacity[eid_rev] = total_cap * (1 - share_fwd) if total_cap is not None else None
        edge_meta[eid_rev] = link
        edge_direction[eid_rev] = "reverse"

    def _emit_fallback(link: _Link) -> None:
        """No usable simulated signal (no reading at all, or neither side
        ever cleared the noise floor) — same BFS-orientation fallback
        behaviour as before this mechanism existed."""
        fallback_pipes.append(link.id)
        eid = f"e_{link.id}"
        bfs_pairs[eid] = (link.start, link.end)
        edge_capacity[eid] = link.capacity
        edge_meta[eid] = link

    for link in links:
        if link.kind == "pipe":
            fwd, rev = link.velocity_fwd, link.velocity_rev
            fwd_v, rev_v = fwd or 0.0, rev or 0.0
            if (fwd is None and rev is None) or max(fwd_v, rev_v) <= NEGLIGIBLE_VELOCITY_MS:
                _emit_fallback(link)
            elif fwd_v > NEGLIGIBLE_VELOCITY_MS and rev_v > NEGLIGIBLE_VELOCITY_MS:
                # Meaningful flow BOTH ways across the sweep, at ANY
                # magnitude. Deliberately no extra noise gate here beyond
                # NEGLIGIBLE_VELOCITY_MS itself (tried and reverted — ADR-0012
                # "Pipe capacity / orientation"): confidently forcing a single
                # WRONG direction for a genuine near-balance point in a real
                # multi-source mesh can silently disconnect everything
                # downstream of it, a far worse failure than an occasionally
                # too-generous split.
                _emit_split(link, fwd_v / (fwd_v + rev_v))
            elif max(fwd_v, rev_v) <= DECISIVE_VELOCITY_MS:
                # Only ONE side ever cleared the noise floor, and even that
                # side's velocity is too low to call the direction question
                # confidently closed (see DECISIVE_VELOCITY_MS's docstring —
                # the Zampis.inp regression this guards against, ADR-0012
                # "Pipe capacity / orientation"). Still hedge with a
                # double-oriented edge rather than trusting a single
                # low-confidence reading outright — but a PURE proportional
                # split would hand the unobserved side exactly 0% capacity
                # (nothing to hedge with at all, since it never registered
                # any signal), so this reserves it a guaranteed minimum share
                # instead: real, usable capacity for a later hazard that
                # needs that direction, at the cost of a little capacity the
                # dominant direction rarely needs anyway.
                share_fwd = min(1.0 - MIN_HEDGE_SHARE, max(MIN_HEDGE_SHARE, fwd_v / (fwd_v + rev_v)))
                _emit_split(link, share_fwd)
            else:
                # One side clears NEGLIGIBLE_VELOCITY_MS, the other never
                # registered anything at all, AND the observed side's
                # velocity clears DECISIVE_VELOCITY_MS — a confidently
                # one-way pipe. Trust it over a topology guess.
                eid = f"e_{link.id}"
                oriented_known[eid] = (
                    (link.start, link.end) if fwd_v >= rev_v else (link.end, link.start)
                )
                edge_capacity[eid] = link.capacity
                edge_meta[eid] = link
        else:
            mid = _fresh(f"{link.kind}_{link.id}")
            inline_nodes[mid] = link
            for eid, pair in ((f"e_{link.id}__in", (link.start, mid)),
                              (f"e_{link.id}__out", (mid, link.end))):
                bfs_pairs[eid] = pair
                edge_capacity[eid] = link.capacity
                edge_meta[eid] = link

    if bidirectional_pipes:
        warnings.append(
            f"{len(bidirectional_pipes)} pipe(s) carry meaningful simulated "
            f"flow in both directions and are modelled as two independently-"
            f"capacitated edges: {', '.join(sorted(bidirectional_pipes)[:5])}"
            + ("…" if len(bidirectional_pipes) > 5 else "")
        )
    if fallback_pipes:
        total_pipes = sum(1 for link in links if link.kind == "pipe")
        warnings.append(
            f"{len(fallback_pipes)} of {total_pipes} pipe(s) had no reliable "
            f"simulated flow signal (none at all, or never above "
            f"{NEGLIGIBLE_VELOCITY_MS} m/s) and were oriented by graph "
            f"topology instead of a solved flow direction; capacity for those "
            f"with literally no signal falls back to a generic "
            f"{FALLBACK_VELOCITY_MS} m/s estimate."
        )
    oriented = {**oriented_known, **_orient_edges(bfs_pairs, source_names, fixed=oriented_known)}

    unreachable = _unreachable_demand_nodes(oriented, source_names, demands)
    if unreachable:
        warnings.append(
            f"{len(unreachable)} junction(s) with demand are not reachable "
            f"from any Source after orientation — they will show as "
            f"permanently critical regardless of any hazard/disservice: "
            f"{', '.join(unreachable[:5])}" + ("…" if len(unreachable) > 5 else "")
        )

    # --- placement -----------------------------------------------------------
    coords: dict[str, tuple[float, float]] = {}
    for nid in wn.node_name_list:
        xy = _wn_node(wn, nid).coordinates
        if xy is not None:
            coords[nid] = (float(xy[0]), float(xy[1]))
    for mid, link in inline_nodes.items():  # midpoint of the split link
        a, b = coords.get(link.start), coords.get(link.end)
        if a and b:
            coords[mid] = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    placement: PlacementResult = place_nodes(coords, options.source_crs)

    # --- supply capacity ------------------------------------------------------
    incident_caps: dict[str, float] = {}
    for eid, (a, b) in oriented.items():
        cap = edge_capacity.get(eid)
        if cap:
            for endpoint in (a, b):
                incident_caps[endpoint] = incident_caps.get(endpoint, 0.0) + cap

    def _supply_for(source_id: str) -> float:
        # `cap` stays true SI m³/s; only the returned, model-bound value is
        # rescaled (`_flow_units`).
        cap = incident_caps.get(source_id, 0.0)
        if cap <= 0:
            warnings.append(
                f"Source '{source_id}' has no capacitated outgoing pipe — "
                f"supply defaulted to a large constant."
            )
            return UNBOUNDED_SUPPLY_FALLBACK
        return _flow_units(cap)

    # --- nodes ----------------------------------------------------------------
    nodes: dict[str, Node] = {}
    # Ready-made scenario events surfaced in the imported config (ADR-0012).
    # A Tank's finite reserve only ever reaches the engine as a TIME quantity
    # (backup_duration → the countdown Guard 2 starts once its feed is cut,
    # engine/propagation.py) — there is no "current volume remaining" state to
    # preserve, so nothing is lost by Reset that Reset shouldn't clear. What
    # WAS missing is a repeatable way to *start* that countdown directly,
    # without first reconstructing a whole upstream-failure chain. A Disservice
    # (no physical damage — the tank itself is intact, just cut off) that sets
    # functionality_time = backup_duration puts the tank straight into the
    # documented "time-warned" state: fully functional now, critical when the
    # countdown reaches zero.
    events: list[EventDefinition] = []
    # Every tank's reserve countdown lives in ONE shared event, like the
    # blackout Hazard below — a real "the whole system loses its upstream
    # feed" scenario hits every tank's reserve together, not one at a time.
    tank_reserve_mutations: dict[str, Any] = {}

    def _base_props(nid: str) -> dict[str, Any]:
        props: dict[str, Any] = {"inp_id": nid}
        if nid in merged_map and merged_map[nid]:
            props["merged_elements"] = merged_map[nid]
        return props

    for rid in wn.reservoir_name_list:
        reservoir = _wn_node(wn, rid)
        nodes[rid] = Node(
            id=rid, label=rid, functionality=n, node_type="Source",
            node_categories=["water"],
            supply_capacity={"water": _supply_for(rid)},
            position=placement.positions.get(rid), geo=placement.geo.get(rid),
            properties={**_base_props(rid), "kind": "reservoir",
                        "head_m": round(reservoir.base_head, 2)},
        )

    for tid in wn.tank_name_list:
        tank = _wn_node(wn, tid)
        volume = math.pi / 4.0 * tank.diameter**2 * (tank.max_level - tank.min_level)
        drain = _downstream_demand(tid, oriented, demands)
        profile: dict[str, CategoryDependencyProfile] = {}
        if drain > 0 and volume > 0:
            hours = max(1, round(volume / drain / 3600.0))
            profile["water"] = CategoryDependencyProfile(
                dependency_level=n, backup=True, backup_duration=hours
            )
            tank_reserve_mutations[f"{tid}.functionality_time"] = hours
        nodes[tid] = Node(
            id=tid, label=tid, functionality=n, node_type="Source",
            node_categories=["water"],
            supply_capacity={"water": _supply_for(tid)},
            category_dependency_profiles=profile or None,
            position=placement.positions.get(tid), geo=placement.geo.get(tid),
            properties={**_base_props(tid), "kind": "tank",
                        "volume_m3": round(volume, 1),
                        "elevation_m": round(tank.elevation, 2)},
        )

    if tank_reserve_mutations:
        events.append(EventDefinition(
            id=TANK_RESERVE_EVENT_ID,
            label="All Tanks — Running on Reserve",
            type="disservice",
            icon="BatteryWarning",
            attribute_mutations=tank_reserve_mutations,
        ))

    for jid in junction_names:
        junction = _wn_node(wn, jid)
        demand = demands[jid]
        profile = {}
        if demand > 0:
            profile["water"] = CategoryDependencyProfile(
                dependency_level=n, demand=_flow_units(demand),
                priority=priorities.get(jid),
            )
        nodes[jid] = Node(
            id=jid, label=jid, functionality=n,
            node_type="Service" if demand > 0 else "Infrastructure",
            node_categories=["water"],
            category_dependency_profiles=profile or None,
            position=placement.positions.get(jid), geo=placement.geo.get(jid),
            properties={**_base_props(jid),
                        "elevation_m": round(junction.elevation, 2)},
        )

    pump_ids: list[str] = []
    for mid, link in inline_nodes.items():
        is_pump = link.kind == "pump"
        if is_pump:
            pump_ids.append(mid)
        nodes[mid] = Node(
            id=mid, label=f"{link.kind.capitalize()} {link.id}",
            functionality=n if link.open_ else 1,
            node_type="Infrastructure",
            node_categories=["water", "pumping" if is_pump else "valve"],
            # Full vulnerability to the blackout Hazard (below) — every pump is
            # electrically driven, so a blackout takes all of them out equally.
            vulnerability_levels={BLACKOUT_EVENT_ID: n - 1} if is_pump else None,
            position=placement.positions.get(mid), geo=placement.geo.get(mid),
            properties={"inp_id": link.id, "kind": link.kind, **link.properties},
        )

    if pump_ids:
        events.append(EventDefinition(
            id=BLACKOUT_EVENT_ID,
            label="Blackout — Pump Failures",
            type="hazard",
            icon="ZapOff",
            # No per-.inp data distinguishes pump repair times, so one blanket
            # estimate applies to every pump this hazard hits (idiomatic Hazard
            # mechanism: vulnerability_levels on each pump node + this event's
            # default_repair_time — NOT attribute_mutations, which the schema
            # itself says not to use alone for physical damage).
            default_repair_time=BLACKOUT_REPAIR_HOURS,
        ))

    demand_ranked = sorted(
        (jid for jid, d in demands.items() if d > 0),
        key=lambda jid: demands[jid],
        reverse=True,
    )
    if demand_ranked:
        top_n = max(1, round(len(demand_ranked) * 0.10))
        surge_mutations: dict[str, Any] = {}
        for jid in demand_ranked[:top_n]:
            surged_profile: dict[str, Any] = {
                "dependency_level": n,
                "demand": _flow_units(demands[jid] * 2.0),
            }
            if jid in priorities:
                surged_profile["priority"] = priorities[jid]
            surge_mutations[f"{jid}.category_dependency_profiles"] = {"water": surged_profile}
        events.append(EventDefinition(
            id="evt-demand-surge-top10",
            label="Demand Surge — Top 10% Consumers",
            type="disservice",
            icon="TrendingUp",
            attribute_mutations=surge_mutations,
        ))

    # --- edges ------------------------------------------------------------
    edges: dict[str, Edge] = {}
    for eid, (source, target) in oriented.items():
        link = edge_meta[eid]
        cap = edge_capacity.get(eid)
        direction_props = {"direction": edge_direction[eid]} if eid in edge_direction else {}
        edges[eid] = Edge(
            id=eid, source=source, target=target,
            functionality=n if link.open_ else 1,
            capacity=_flow_units(cap) if cap is not None else None,
            properties={"inp_id": link.id, "kind": link.kind, **link.properties, **direction_props},
        )

    # --- canvas / config ----------------------------------------------------
    # A fresh id per import, not a fixed literal — merging two separate
    # imports into one project (frontend "add as extra canvas" mode) must
    # never collide two imported canvases onto the same id.
    canvas = Canvas(
        id=f"canvas-inp-{secrets.token_hex(4)}",
        label=name,
        color="#0ea5e9",
        georeferenced=placement.georeferenced or None,
        geo_anchor=placement.geo_anchor,
        graph=Graph(
            graph_type=GRAPH_TYPE_NAME,
            node_ids=sorted(nodes),
            edge_ids=sorted(edges),
        ),
    )

    project = Project(
        version="2.0",
        meta=ProjectMeta(
            name=name,
            description=f"Imported from EPANET .inp ({wn.num_junctions} junctions, "
                        f"{wn.num_pipes} pipes).",
        ),
        nodes=nodes,
        edges=edges,
        canvases=[canvas],
    )

    config = ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name=f"{name} — imported configuration"),
        functionality_scale=generate_scale(n),
        categories=list(_CATEGORIES),
        events=events,
        graph_types=[GraphTypeConfig(name=GRAPH_TYPE_NAME, heuristics=[])],
    )

    return ProjectBundle(project=project, config=config)
