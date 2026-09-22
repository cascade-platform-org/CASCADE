"""
experiments/aqueducts/validate_faithfulness.py — how closely does CASCADE's engine output
match real WNTR hydraulics, for randomly generated stress situations?

For each situation (a random combination of structural failures and/or a
hot-period demand increase — see `_KINDS` below), this script:
  1. Runs the SAME intervention on the real WNTR model (closes the same
     links, scales the same junctions' demand) and solves a real PDD steady
     state — the "ground truth" delivered/expected ratio per junction.
  2. Converts that ratio into a CASCADE functionality level using the
     engine's OWN quantization rule (`engine.flow._ratio_to_level`), so the
     comparison isn't confounded by two different rounding schemes.
  3. Applies the identical intervention to the imported CASCADE Project
     (edge/node functionality = 1 for a break, scaled demand for a hot
     period) and runs the real engine (`engine.propagation.run`) to get
     CASCADE's own resulting level per junction.
  4. Compares the two per junction and reduces it to ONE number per
     situation: a demand-weighted "Functionality Match Score" (FMS) —
     1 − weighted_mean(|level_true − level_cascade|) / (N−1), in [0, 1].

The aggregate across every situation/network is the single "how faithful is
the importer + engine's flow heuristic to real hydraulics" number.

Four failure/stress families, each isolating a different question about
generalization beyond independent random component loss (`_KINDS`):
  - "break"    — 1-3 uniformly random pipe/pump closures. The baseline case:
                 does the model track hydraulics under ordinary, spatially
                 unrelated component loss?
  - "hot"      — a network-wide, moderate demand increase (a hot/dry spell:
                 more lawn watering, more cooling-system draw, general
                 elevated consumption across many households at once, not a
                 single hydrant draw) — a broad random subset of junctions,
                 not just the heaviest consumers, so the scenario isn't
                 tailored to any one demand-shedding assumption.
  - "both"     — a random break plus a hot period together.
  - "cluster"  — several breaks concentrated in one topological
                 neighbourhood (`_clustered_break`) — a stand-in for a
                 localized physical hazard (trench collapse, small
                 earthquake, contractor dig-in) that a uniformly random
                 sample of components across the whole network essentially
                 never produces, and which is harder to route around because
                 nearby alternate paths are damaged too.
  - "targeted" — breaks concentrated on the highest-diameter trunk mains and
                 pumps (`_targeted_break`) — the standard contrast to random
                 failure in the network-robustness literature (Albert-Jeong-
                 Barabási, Motter-Lai): does fidelity hold when the failure
                 hits the components a random sample rarely reaches but that
                 carry disproportionate flow?

A fifth, separate family runs alongside the five above, exhaustively rather
than sampled — every tank in the network, one at a time (`_tank_situations`):
  - "tank"     — one situation per Tank, ALL of its connecting links closed —
                 the closest a t=0 steady solve can get to "this tank
                 contributes zero water" (contamination, structural failure,
                 anything that takes the tank fully out of service NOW, not a
                 slow-draining reserve — see the Tank Reserve note below).
                 Reuses the exact same `broken_link_ids` mechanism as
                 break/cluster/targeted, deliberately: the CASCADE side then
                 closes the identical edges the WNTR side closes, rather than
                 mutating the Source node's own functionality and depending on
                 the engine's internal (protected, not this harness's
                 business) source-capacity scaling rule to happen to reach
                 zero. Exhaustive, not random-sampled, because a network
                 typically has few tanks (0-3 on the networks this harness
                 uses, except Net6's 32) and each one going fully out of
                 service is a materially different, individually-interesting
                 failure mode worth checking on every one of them, not a
                 population to subsample.

This is a dev-only validation harness, not shipped product code — the same
category as scripts/benchmark_engine.py, which is why it shares that
script's import-linter carve-out (pyproject.toml) to import engine.* directly:
we need the engine's REAL propagation call and its REAL ratio→level rule, not
a reimplementation of either (a second, slightly-different quantization rule
would make this script measure its own drift, not the engine's).

Out of scope on purpose: Tank Reserve (the *other* tank scenario — distinct
from the "tank" family above). It is a time-warning (`functionality_time`
countdown), not a hydraulic state change at the moment it is applied — the
tank is still fully supplying right after the event, so there is nothing for
a t=0 WNTR solve to disagree with CASCADE about. The "tank" family above is
not that event — it is a full, immediate outage of the tank itself.

The `--required-pressure`/`--minimum-pressure` flags exist to check how much
the aggregate FMS depends on the specific PDD service-pressure assumption the
ground-truth solve uses (20m/0m by default) — that threshold alone decides
which junctions WNTR calls "critical," so a fidelity claim that only holds at
one arbitrary pressure choice would be a weaker claim than it looks.

    python experiments/aqueducts/validate_faithfulness.py
    python experiments/aqueducts/validate_faithfulness.py --networks Net1,Net3 --seed 1
    python experiments/aqueducts/validate_faithfulness.py --n-levels 5
    python experiments/aqueducts/validate_faithfulness.py --required-pressure 15 --minimum-pressure 5
"""
from __future__ import annotations

import argparse
import copy
import csv
import itertools
import math
import random
import statistics
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

# This harness lives outside the backend (it never runs in production, and
# keeping it out is what lets the import-linter contract drop its carve-out),
# so it puts the backend package root on sys.path itself — the same thing
# CASCADE-backend/scripts/* do, one directory further up.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "CASCADE-backend"))

import networkx as nx  # noqa: E402
import wntr  # noqa: E402

from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    contingency_priorities,
    link_flow_profiles,
    scarcity_priorities,
)
from core.importers.inp.skeleton import (  # noqa: E402
    SkeletonError,
    skeletonize_to_target,
)
from core.importers.inp.sim import _check_converged  # noqa: E402 — see module docstring
from engine.flow import _ratio_to_level  # noqa: E402 — see module docstring
from engine.propagation import run as propagate  # noqa: E402
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

# Scored families (2026-07-22): dropped break/hot/both (uninformative — see
# benchmark-protocol.md §5). Each family is capped ~60 situations. `cluster` is
# random (uses seeds); `targeted`/`tank`/`source` are DETERMINISTIC combinatorial
# families — 10 singles + 20 pairs + 30 triplets of the consequential units.
_ALL_KINDS = ["cluster", "targeted", "tank", "source"]
# `_random_situation`'s legacy kind list (still used by margin_sweep.py and the
# diag scripts; NOT used by the benchmark's family generation below).
_KINDS = ["break", "hot", "both", "cluster", "targeted"]

# Combinatorial family caps (singles / pairs / triplets per network).
_FAMILY_SINGLES, _FAMILY_PAIRS, _FAMILY_TRIPLETS = 10, 20, 30
# Cluster family: random situations, `_CLUSTER_PER_SEED` per seed over
# `_CLUSTER_SEEDS` seeds (~60 total).
_CLUSTER_PER_SEED, _CLUSTER_SEEDS = 20, 3

# Cluster attack: how many topological hops from a random epicenter link
# count as "in the blast radius," and how many of the breakable links found
# there actually get closed (never more than exist).
_CLUSTER_RADIUS_HOPS = 2
_CLUSTER_MAX_BREAKS = 6

# Targeted attack: the pool is the top `_TARGET_TOP_FRACTION` of pipes by
# diameter (the model's own proxy for trunk-main capacity) plus every pump
# (a pump is a structural bottleneck regardless of diameter) — `k` of that
# pool are closed per situation.
_TARGET_TOP_FRACTION = 0.20
_TARGET_BREAKS = 3

# Hot period: a broad (not just top-consumer) random subset of junctions see
# a moderate, sustained demand increase together.
_HOT_JUNCTION_FRACTION_RANGE = (0.15, 0.4)
_HOT_FACTOR_RANGE = (1.2, 1.8)


@dataclass
class Situation:
    label: str
    broken_link_ids: list[str] = field(default_factory=list)   # WNTR pipe/pump ids
    hot_junction_ids: list[str] = field(default_factory=list)
    hot_factor: float = 1.0


def _build_link_graph(wn: wntr.network.WaterNetworkModel) -> nx.MultiGraph:
    """An undirected multigraph over node ids, one edge per pipe/pump keyed by
    its link id — used only for `_clustered_break`'s hop search. Built
    directly (not via `wn.to_graph()` + a directed→undirected conversion)
    because that conversion collapses parallel edges and drops the WNTR link
    id as the edge key, which `_clustered_break` needs to map "nodes within N
    hops" back to "breakable link ids"."""
    graph: nx.MultiGraph = nx.MultiGraph()
    for link_id in list(wn.pipe_name_list) + list(wn.pump_name_list):
        link = wn.get_link(link_id)
        graph.add_edge(link.start_node_name, link.end_node_name, key=link_id)
    return graph


def _clustered_break(
    wn: wntr.network.WaterNetworkModel, graph: nx.MultiGraph, rng: random.Random
) -> list[str]:
    """A localized-hazard failure: pick a random breakable link as the
    epicenter, then close a bounded sample of the breakable links whose BOTH
    endpoints lie within `_CLUSTER_RADIUS_HOPS` topological hops of it — a
    stand-in for damage that hits a neighbourhood together (trench collapse,
    small earthquake) rather than components scattered independently across
    the whole network, the one failure mode uniformly random sampling
    (`kind="break"`) essentially never produces on a network of any size."""
    # Sorted, not a bare set→list: Python's set iteration order for strings
    # depends on the per-process hash seed, not just insertion order — an
    # unsorted list here would make rng.choice pick a different epicenter on
    # every run even with an identical --seed, silently breaking the
    # reproducibility --seed promises.
    breakable = sorted(set(wn.pipe_name_list) | set(wn.pump_name_list))
    if not breakable:
        return []
    epicenter = rng.choice(breakable)
    epicenter_node = wn.get_link(epicenter).start_node_name
    if epicenter_node not in graph:
        return [epicenter]
    nearby_nodes = set(nx.single_source_shortest_path_length(graph, epicenter_node, cutoff=_CLUSTER_RADIUS_HOPS))
    nearby_links = {
        link_id
        for u, v, link_id in graph.edges(keys=True)
        if u in nearby_nodes and v in nearby_nodes and link_id in breakable
    }
    if not nearby_links:
        return [epicenter]
    pool = sorted(nearby_links)
    k = min(_CLUSTER_MAX_BREAKS, len(pool))
    return rng.sample(pool, k)


def _targeted_break(wn: wntr.network.WaterNetworkModel, rng: random.Random) -> list[str]:
    """A capacity-biased failure: sample from the highest-diameter pipes plus
    every pump — the components a uniformly random sample of size 1-3 rarely
    reaches on a network of hundreds of links, but that carry disproportionate
    flow. The standard contrast to random failure in network-robustness
    studies (Albert-Jeong-Barabási, Motter-Lai): a model whose fidelity holds
    only under random loss and degrades under targeted loss would be a
    materially weaker result than the aggregate FMS alone suggests."""
    pipes_by_diameter = sorted(wn.pipe_name_list, key=lambda pid: wn.get_link(pid).diameter, reverse=True)
    pool_size = max(1, round(len(pipes_by_diameter) * _TARGET_TOP_FRACTION))
    pool = pipes_by_diameter[:pool_size] + list(wn.pump_name_list)
    if not pool:
        return []
    k = min(_TARGET_BREAKS, len(pool))
    return rng.sample(pool, k)


def _combo_situations(
    units: list[str],
    prefix: str,
    links_for: Callable[[str], list[str]],
) -> list[Situation]:
    """Deterministic combinatorial family: `_FAMILY_SINGLES` single units, then
    `_FAMILY_PAIRS` pairs, then `_FAMILY_TRIPLETS` triplets. `units` is pre-sorted
    by importance, so `itertools.combinations` (lexicographic over that order)
    yields the highest-impact combos first — no randomness, fully reproducible.
    `links_for(unit)` maps a unit (a link id, a tank id, a reservoir id) to the
    link ids that closing it entails; a situation closes the union over its combo.
    Combos that resolve to no links (e.g. a source with no pipe outlet) are skipped."""
    combos = (
        [(u,) for u in units[:_FAMILY_SINGLES]]
        + list(itertools.islice(itertools.combinations(units, 2), _FAMILY_PAIRS))
        + list(itertools.islice(itertools.combinations(units, 3), _FAMILY_TRIPLETS))
    )
    situations: list[Situation] = []
    idx = 0
    for combo in combos:
        broken = sorted({lid for unit in combo for lid in links_for(unit)})
        if not broken:
            continue
        situations.append(Situation(label=f"{prefix}#{idx}", broken_link_ids=broken))
        idx += 1
    return situations


def _targeted_situations(wn: wntr.network.WaterNetworkModel) -> list[Situation]:
    """Capacity-targeted attack: 1/2/3-link closures among the top-20%-diameter
    pipes plus every pump (the model's proxy for consequential trunk mains),
    largest first."""
    pipes = sorted(wn.pipe_name_list, key=lambda p: wn.get_link(p).diameter, reverse=True)
    pool = pipes[: max(1, round(len(pipes) * _TARGET_TOP_FRACTION))] + list(wn.pump_name_list)
    return _combo_situations(pool, "targeted", lambda lid: [lid])


def _tank_situations(wn: wntr.network.WaterNetworkModel) -> list[Situation]:
    """Tank loss: 1/2/3 tanks isolated together. A tank isn't a link (WNTR has
    no "close this tank" flag), so isolating it = closing every link touching it
    (`get_links_for_node`). Combinatorial, replacing the old exhaustive-per-tank."""
    tanks = sorted(wn.tank_name_list)
    return _combo_situations(tanks, "tank", lambda tid: list(wn.get_links_for_node(tid)))


def _source_situations(wn: wntr.network.WaterNetworkModel) -> list[Situation]:
    """Source (reservoir) failure: 1/2/3 reservoirs cut together by closing their
    outlet link(s). Reachability removes a source cut this way (it becomes
    topologically isolated), so junctions with no path to a surviving source are
    flagged — a fair, concentrated comparison (benchmark-protocol.md §6)."""
    reservoirs = sorted(wn.reservoir_name_list)
    return _combo_situations(reservoirs, "source", lambda rid: list(wn.get_links_for_node(rid)))


def _cluster_situations(
    wn: wntr.network.WaterNetworkModel, graph: nx.MultiGraph, base_seed: int
) -> list[Situation]:
    """Localized hazard: `_CLUSTER_PER_SEED` random clustered breaks per seed over
    `_CLUSTER_SEEDS` seeds (~60), the only random family — seeds give it variance
    the deterministic families don't need."""
    situations: list[Situation] = []
    idx = 0
    for s in range(base_seed, base_seed + _CLUSTER_SEEDS):
        rng = random.Random(s * 7919 + 1)  # nosec B311 — deterministic scenarios
        for _ in range(_CLUSTER_PER_SEED):
            broken = _clustered_break(wn, graph, rng)
            if broken:
                situations.append(Situation(label=f"cluster#{idx}", broken_link_ids=broken))
                idx += 1
    return situations


def _random_situation(
    wn: wntr.network.WaterNetworkModel, graph: nx.MultiGraph, rng: random.Random, index: int
) -> Situation:
    """One of `_KINDS`, uniformly chosen — see the module docstring for what
    each family tests."""
    kind = rng.choice(_KINDS)
    breakable = list(wn.pipe_name_list) + list(wn.pump_name_list)
    demanding = [j for j in wn.junction_name_list if wn.get_node(j).demand_timeseries_list]

    broken: list[str] = []
    hot: list[str] = []
    factor = 1.0
    if kind in ("break", "both") and breakable:
        k = rng.randint(1, min(3, len(breakable)))
        broken = rng.sample(breakable, k)
    elif kind == "cluster":
        broken = _clustered_break(wn, graph, rng)
    elif kind == "targeted":
        broken = _targeted_break(wn, rng)
    if kind in ("hot", "both") and demanding:
        frac = rng.uniform(*_HOT_JUNCTION_FRACTION_RANGE)
        k = max(1, round(len(demanding) * frac))
        hot = rng.sample(demanding, min(k, len(demanding)))
        factor = rng.uniform(*_HOT_FACTOR_RANGE)
    return Situation(label=f"{kind}#{index}", broken_link_ids=broken, hot_junction_ids=hot, hot_factor=factor)


# Physical max design velocity for water mains (m/s). Above this, EPANET is
# delivering through pipes at speeds real hydraulics would not sustain (surge/
# erosion). Loose default; used flag-only on the ground truth for now — the
# same threshold will seed the overload criterion (see the roadmap).
V_MAX_DESIGN_MS = 3.0


@dataclass
class VelocityFlag:
    """Per-situation record of where the ground-truth EPANET solve relied on
    unphysically fast pipes (velocity > V_MAX_DESIGN_MS). Flag-only: recorded,
    never acted on. See docs/project/overload-cascade-extension-roadmap.md."""
    n_pipes: int
    n_over: int
    max_v: float
    frac_flow_over: float


def _solve_served_ratios(
    wn: wntr.network.WaterNetworkModel,
    demands: dict[str, float],
    situation: Situation,
    required_pressure_m: float,
    minimum_pressure_m: float,
) -> tuple[dict[str, float], "VelocityFlag | None"]:
    """Ground truth: a steady-state PDD solve of `wn` under `situation`'s
    interventions, every junction fixed to its `demands` value (the same
    demand_mode value CASCADE was imported with) except the ones in a hot
    period, scaled by `situation.hot_factor`. Returns junction id →
    delivered/expected ratio (clamped at 0, since WNTR can report a tiny
    negative residual under PDD at zero pressure).

    `required_pressure_m`/`minimum_pressure_m` are exposed to the caller (not
    hardcoded) so a sensitivity sweep can check how much the aggregate FMS
    depends on this one service-pressure assumption — it alone decides which
    junctions WNTR calls "critical" for every situation."""
    model = copy.deepcopy(wn)
    # A Demand entry's pattern_name=None does NOT mean "constant" to WNTR — it
    # falls back to the model's GLOBAL default pattern (wn.options.hydraulic.
    # pattern) if the .inp file sets one. Net6 does, and its first multiplier
    # is 0.1 — every "fixed" demand below would otherwise be silently cut to a
    # tenth of its value (core.importers.inp.sim._fixed_demand_model has the
    # same fix, for the same reason).
    model.options.hydraulic.pattern = None
    for jid, demand in demands.items():
        factor = situation.hot_factor if jid in situation.hot_junction_ids else 1.0
        junction = model.get_node(jid)
        junction.demand_timeseries_list.clear()
        junction.demand_timeseries_list.append((demand * factor, None, "validation_fixed"))
    # Ground truth for CASCADE's "working condition" baseline: every pump an
    # operator CAN run is operational (core.importers.inp.map._collect_links),
    # not whatever the .inp file's scheduled t=0 status happens to be — so the
    # ground truth solve has to open every pump too, or it would be comparing
    # CASCADE's "fully capable" baseline against WNTR's "mid-schedule, several
    # pumps not started yet" snapshot, an apples-to-oranges mismatch that gets
    # WORSE, not better, once the importer stops reflecting that schedule.
    for pump_id in wn.pump_name_list:
        model.get_link(pump_id).initial_status = "Open"
    for link_id in situation.broken_link_ids:
        model.get_link(link_id).initial_status = "Closed"

    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = required_pressure_m
    model.options.hydraulic.minimum_pressure = minimum_pressure_m

    with tempfile.TemporaryDirectory(prefix="cascade-validate-") as tmpdir:
        prefix = str(Path(tmpdir) / "validate")
        try:
            results = wntr.sim.EpanetSimulator(model).run_sim(file_prefix=prefix)
            # EpanetSimulator does not raise when EPANET fails to converge
            # ("System unbalanced") — it returns SimulationResults built from
            # whatever the last, non-converged iteration computed. Observed
            # directly on a real tank-disservice situation (Tarcento,
            # Segnacco): pressures around -470,000 m, and a "ground truth"
            # that called 288/424 junctions critical when the actual network
            # topology still had two other sources reaching them — the FMS
            # penalty in that case was measuring the solver's non-convergence,
            # not CASCADE's fidelity. Same fix as core.importers.inp.sim's
            # sweeps (`_check_converged`) — this is the one ground-truth call
            # site in this file, so it isn't threaded through `_run_sweep_step`.
            _check_converged(prefix)
        except Exception:
            return {}, None  # a pathological or non-converging situation — no ground truth this round
    delivered = results.node["demand"].iloc[0]

    # SINGULAR-PDD CORRECTION (found 2026-07-14 debugging the worst-divergence
    # kits, see experiments/aqueducts/ATTEMPTS.md §6 and ADR-0013's addendum): when the
    # broken links sever a whole component from EVERY source, the PDD system
    # for that component is singular and EPANET converges — without any
    # "unbalanced" warning — to an arbitrary internal circulation whose
    # per-junction delivered demands read as fully served while summing to
    # ~0. Physically every junction there receives nothing. Verified on
    # Cassacco: a 160-node severed component reported ~124 junctions "fully
    # served" with zero net inflow, charging CASCADE's (correct) all-critical
    # answer a 124-junction FMS penalty. Any demand junction with no
    # UNDIRECTED path to a source through in-service links is therefore
    # forced to ratio 0 before quantization.
    severed = _severed_junctions(wn, situation)

    ratios: dict[str, float] = {}
    for jid, expected in demands.items():
        if expected <= 0:
            continue
        if jid in severed:
            ratios[jid] = 0.0
            continue
        got = float(delivered.get(jid, 0.0))
        ratios[jid] = max(0.0, got / expected)

    # VELOCITY-EXCEEDANCE FLAG (flag-only, physical-realism check on the ground
    # truth): EPANET imposes no velocity cap, so it will "deliver" water through
    # pipes at unphysical speeds. We record, but do NOT act on, where the
    # ground-truth solve relies on velocity > V_MAX_DESIGN_MS. This is the seed
    # of the (future) steady-state overload oracle — see
    # docs/project/overload-cascade-extension-roadmap.md.
    vel = results.link["velocity"].iloc[0]
    flow = results.link["flowrate"].iloc[0]
    per_pipe = [
        (v, abs(float(flow.get(pid, 0.0))))
        for pid in wn.pipe_name_list
        if math.isfinite(v := abs(float(vel.get(pid, 0.0))))
    ]
    total_flow = sum(f for _, f in per_pipe) or 1.0
    over = [(v, f) for v, f in per_pipe if v > V_MAX_DESIGN_MS]
    vstats = VelocityFlag(
        n_pipes=len(per_pipe),
        n_over=len(over),
        max_v=max((v for v, _ in per_pipe), default=0.0),
        frac_flow_over=sum(f for _, f in over) / total_flow,
    )
    return ratios, vstats


def _severed_junctions(
    wn: wntr.network.WaterNetworkModel, situation: Situation
) -> set[str]:
    """Junctions with no undirected path to any source (reservoir, tank, or
    negative-demand injection-well junction) through links that are neither
    broken by `situation` nor closed at t=0 in the .inp itself. See the
    singular-PDD comment at the call site."""
    graph = nx.Graph()
    graph.add_nodes_from(wn.node_name_list)
    for lid, link in wn.links():
        if lid in situation.broken_link_ids:
            continue
        if lid not in wn.pump_name_list and str(link.initial_status) in ("Closed", "CLOSED", "0"):
            continue  # pumps are force-opened by the ground-truth solve above
        graph.add_edge(link.start_node_name, link.end_node_name)

    sources = set(wn.reservoir_name_list) | set(wn.tank_name_list)
    for jid in wn.junction_name_list:
        base = sum(
            ts.base_value or 0.0
            for ts in wn.get_node(jid).demand_timeseries_list
        )
        if base < 0:
            sources.add(jid)  # EPANET well/inflow idiom (ADR-0012)

    reachable: set[str] = set()
    for source in sources:
        if source in graph.nodes and source not in reachable:
            reachable |= nx.node_connected_component(graph, source)
    return {jid for jid in wn.junction_name_list if jid not in reachable}


def _build_link_maps(project: Project) -> tuple[dict[str, list[str]], dict[str, str]]:
    """inp link id → the edge id(s) representing it (two for a bidirectional
    pipe, see core.importers.inp.map) and inp link id → the inline node id
    representing a pump/valve (may differ from the raw id on a name
    collision, `core.importers.inp.map._fresh`)."""
    link_to_edges: dict[str, list[str]] = {}
    for eid, edge in project.edges.items():
        props = edge.properties or {}
        if props.get("kind") == "pipe" and props.get("inp_id"):
            link_to_edges.setdefault(props["inp_id"], []).append(eid)

    link_to_node: dict[str, str] = {}
    for nid, node in project.nodes.items():
        props = node.properties or {}
        if props.get("kind") in ("pump", "valve") and props.get("inp_id"):
            link_to_node[props["inp_id"]] = nid
    return link_to_edges, link_to_node


def _cascade_levels(
    bundle_project: Project,
    config: ModelConfiguration,
    situation: Situation,
    link_to_edges: dict[str, list[str]],
    link_to_node: dict[str, str],
    demands: dict[str, float],
) -> dict[str, int]:
    """Apply `situation` to a fresh copy of the imported Project exactly the
    way an Event would (edge/node functionality → 1 for a break, demand
    scaled for a hot period), run the real engine, and return junction id →
    resulting functionality level for every demand-bearing junction."""
    project = bundle_project.model_copy(deep=True)

    for link_id in situation.broken_link_ids:
        for eid in link_to_edges.get(link_id, []):
            project.edges[eid].functionality = 1
        node_id = link_to_node.get(link_id)
        if node_id is not None:
            project.nodes[node_id].functionality = 1

    for jid in situation.hot_junction_ids:
        node = project.nodes.get(jid)
        profile = (node.category_dependency_profiles or {}).get("water") if node else None
        if profile is not None and profile.demand:
            profile.demand = profile.demand * situation.hot_factor

    result = propagate(PropagationRequest(project=project, config=config, scope="global"))
    updated = {u.id: u.functionality for u in result.updates}

    levels: dict[str, int] = {}
    for jid in demands:
        node = project.nodes.get(jid)
        if node is None:
            continue
        profile = (node.category_dependency_profiles or {}).get("water") if node else None
        if not profile or not profile.demand:
            continue
        levels[jid] = updated.get(jid, node.functionality)
    return levels


def _fms(
    levels_true: dict[str, int],
    levels_cascade: dict[str, int],
    demands: dict[str, float],
    n_levels: int,
) -> tuple[float, int]:
    """Demand-weighted Functionality Match Score for one situation:
    1 − weighted_mean(|level_true − level_cascade|) / (N−1), in [0, 1].
    A junction absent from either side (no ground truth solved, or not a
    demand-bearing node) is excluded, not scored as a miss."""
    common = [jid for jid in levels_true if jid in levels_cascade and demands.get(jid, 0.0) > 0]
    if not common:
        return 1.0, 0
    total_demand = sum(demands[jid] for jid in common)
    weights = (
        {jid: demands[jid] / total_demand for jid in common}
        if total_demand > 0
        else {jid: 1.0 / len(common) for jid in common}
    )
    weighted_error = sum(weights[jid] * abs(levels_true[jid] - levels_cascade[jid]) for jid in common)
    return 1.0 - weighted_error / max(1, n_levels - 1), len(common)


@dataclass
class ConfusionCounts:
    """Binary confusion matrix over 'critical' (level == 1, i.e. no service)
    vs 'operational' (level > 1) — the coarsest functionality read an
    operator actually acts on (dispatch a crew now vs not), independent of
    the N-level quantization FMS scores against. Ground truth (WNTR) is the
    positive class definition: TP/FN are "true is critical", FP/TN are "true
    is operational". One junction (from the FMS junction set: demand-bearing,
    present in both sides) = one sample, unweighted — a confusion matrix is a
    count of classification instances, not a demand-weighted residual."""

    tp: int = 0  # true critical, predicted critical
    fp: int = 0  # true operational, predicted critical
    fn: int = 0  # true critical, predicted operational
    tn: int = 0  # true operational, predicted operational

    def __iadd__(self, other: "ConfusionCounts") -> "ConfusionCounts":
        self.tp += other.tp
        self.fp += other.fp
        self.fn += other.fn
        self.tn += other.tn
        return self

    @property
    def total(self) -> int:
        return self.tp + self.fp + self.fn + self.tn

    @property
    def accuracy(self) -> float:
        return (self.tp + self.tn) / self.total if self.total else 1.0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if (self.tp + self.fp) else 1.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if (self.tp + self.fn) else 1.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if (p + r) else 0.0


def _binary_confusion(
    levels_true: dict[str, int],
    levels_cascade: dict[str, int],
    demands: dict[str, float],
) -> ConfusionCounts:
    """Same junction set as `_fms` (demand-bearing, present on both sides),
    thresholded to critical (level 1) vs operational (level > 1)."""
    counts = ConfusionCounts()
    for jid in levels_true:
        if jid not in levels_cascade or demands.get(jid, 0.0) <= 0:
            continue
        true_critical = levels_true[jid] == 1
        pred_critical = levels_cascade[jid] == 1
        if true_critical and pred_critical:
            counts.tp += 1
        elif not true_critical and pred_critical:
            counts.fp += 1
        elif true_critical and not pred_critical:
            counts.fn += 1
        else:
            counts.tn += 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--networks", default="Net1,Net3", help="Comma-separated wntr.library.model_library names.")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--n-levels", type=int, default=3)
    parser.add_argument("--demand-mode", default="peak_hour", choices=["peak", "peak_hour", "base", "avg"])
    parser.add_argument(
        "--required-pressure", type=float, default=20.0,
        help="WNTR PDD required_pressure (m) for the ground-truth solve — the pressure at/above which a "
             "junction is considered fully served. Vary this to check how much aggregate FMS depends on "
             "this one service-level assumption.",
    )
    parser.add_argument(
        "--minimum-pressure", type=float, default=0.0,
        help="WNTR PDD minimum_pressure (m) for the ground-truth solve — the pressure at/below which a "
             "junction is considered to receive zero service.",
    )
    parser.add_argument(
        "--csv", type=Path, default=None,
        help="Append one row per situation (network, seed, kind, fms, n_compared, tp, fp, fn, tn) to this "
             "path — header written once, on first creation. Appending (not overwriting) lets a multi-seed "
             "E1 sweep be several invocations of this script sharing one CSV (E1/T1).",
    )
    parser.add_argument(
        "--no-priority-sweep", action="store_true",
        help="Alias for --priority-mode none (kept for earlier E3' runs' command-line compatibility).",
    )
    parser.add_argument(
        "--priority-mode", choices=["sweep", "contingency", "none"], default="contingency",
        help="How junction priorities are derived. 'contingency' (DEFAULT, 2026-07-22) = "
             "contingency_priorities' deterministic cycle-aware severity ranking (demand-weighted "
             "unmet-service deficit over cycle-trunk singles/pairs/triplets) — cuts false positives "
             "~44%%, precision ~+48%% over 'none' at a small recall cost; 'sweep' = scarcity_priorities' "
             "demand-multiplier failure order (legacy, ablated ~null on FMS); 'none' = engine default "
             "priority everywhere (fast baseline, precision ~0.34 on the new setup).",
    )
    parser.add_argument(
        "--contingency-bias", type=float, default=0.0,
        help="Fraction of contingency_samples drawn from the top-10%%-diameter-pipes-plus-pumps pool "
             "instead of uniformly over all links (E3''). Diagnoses/fixes the targeted/clustered-attack "
             "precision gap: see link_flow_profiles' contingency_bias_fraction docstring.",
    )
    parser.add_argument(
        "--contingency-multiplier", type=float, default=1.0,
        help="Demand multiplier applied DURING contingency solves (default 1.0 = nominal "
             "demand, orthogonal topology-only reroute). >1 sizes backup pipes from the flow "
             "they carry when a link closure and a demand surge coincide. See "
             "link_flow_profiles' contingency_multiplier docstring.",
    )
    parser.add_argument(
        "--capacity-drill", action="store_true",
        help="CAPACITY ABLATION (ATTEMPTS.md §12, experiments §S2): size pipe "
             "capacity from the per-pipe hydraulic SWEEP (area x min(v_peak x "
             "margin, max_v)) instead of the shipped uniform design velocity. "
             "This is the pre-2026-07-27 method, retained only to reproduce the "
             "ablation showing it buys nothing over the constant. Sets "
             "ImportOptions.capacity_velocity=None.",
    )
    parser.add_argument(
        "--capacity-velocity", type=float, default=None,
        help="Override the uniform design velocity (m/s) pipe capacity is sized "
             "at (area x V). Default None = the importer default "
             "(DEFAULT_DESIGN_VELOCITY_MS, 2.5). Ignored under --capacity-drill.",
    )
    parser.add_argument(
        "--contingency-samples", type=int, default=20,
        help="Number of single-link contingency solves for capacity discovery (default 20, the importer's "
             "own default). More samples = more backup-capacity coverage at one extra PDD solve each.",
    )
    parser.add_argument(
        "--contingency-exhaustive-trunk", action="store_true",
        help="Close EVERY top-10%%-diameter pipe and pump once (no sampling luck for the consequential "
             "links), plus --contingency-samples uniform picks on top. Overrides --contingency-bias.",
    )
    parser.add_argument(
        "--contingency-trunk-pairs", type=int, default=0,
        help="Additionally close this many random PAIRS of trunk links simultaneously (E3‴): single-link "
             "closures never stress the backup path only a double trunk failure forces into service.",
    )
    parser.add_argument(
        "--target-nodes", type=int, default=None,
        help="Skeletonize each network to at most this many nodes BEFORE both the "
             "import and the ground-truth solve (both sides use the same reduced "
             "network, so the comparison stays consistent). Lets large .inp files "
             "run rapidly. Omit to import the full network.",
    )
    args = parser.parse_args()

    all_scores: list[float] = []
    all_confusion = ConfusionCounts()
    scores_by_kind: dict[str, list[float]] = {kind: [] for kind in _ALL_KINDS}
    # Two reference predictors scored per situation, against the same ground
    # truth and junction set, to give the paper's FMS numbers a floor:
    #  - "null": every junction predicted fully operational (level N). Its FMS
    #    is the agreement a model earns for free when a situation barely
    #    perturbs the network (ceiling effect) — the flow module's margin over
    #    THIS number, not its absolute FMS, is the evidence it adds value.
    #  - "reach": pure topological reachability — a junction is critical
    #    (level 1) iff it has no undirected path to any source through
    #    in-service links (`_severed_junctions`), else fully operational.
    #    The field-standard connectivity abstraction; quantity-blind by
    #    construction (predicts nothing under demand stress).
    null_by_kind: dict[str, list[float]] = {kind: [] for kind in _ALL_KINDS}
    reach_by_kind: dict[str, list[float]] = {kind: [] for kind in _ALL_KINDS}
    reach_confusion = ConfusionCounts()

    csv_writer = None
    csv_file = None
    if args.csv is not None:
        # priority_mode (a string, was boolean priority_sweep) + the new
        # contingency_bias column changed the row layout — appending
        # new-format rows to an old-format file would silently shift every
        # column after `seed`, so refuse rather than corrupt.
        header = ["network", "seed", "priority_mode", "contingency_bias", "required_pressure", "minimum_pressure",
                  "n_levels", "kind", "situation", "fms", "n_compared", "tp", "fp", "fn", "tn",
                  "fms_null", "fms_reach", "reach_tp", "reach_fp", "reach_fn", "reach_tn",
                  "gt_pipes", "gt_pipes_over_vmax", "gt_max_velocity", "gt_frac_flow_over_vmax"]
        is_new = not args.csv.exists()
        if not is_new:
            with args.csv.open(newline="") as existing:
                existing_header = next(csv.reader(existing), None)
            if existing_header != header:
                raise SystemExit(
                    f"{args.csv} has a different column layout ({existing_header}); "
                    f"appending would misalign rows — pass a fresh --csv path."
                )
        csv_file = args.csv.open("a", newline="")
        csv_writer = csv.writer(csv_file)
        if is_new:
            csv_writer.writerow(header)

    for name in (n.strip() for n in args.networks.split(",")):
        # A bare name (Net1, Net3, ...) resolves against wntr's bundled
        # example networks; anything that looks like a path (has a slash or
        # a .inp suffix) is loaded directly, e.g. a real aqueduct export
        # under raw-networks/aqueducts/ that ships with neither wntr nor
        # this repo's own fixtures.
        path = name if ("/" in name or name.lower().endswith(".inp")) else wntr.library.model_library.get_filepath(name)
        wn = wntr.network.WaterNetworkModel(path)
        if args.target_nodes is not None:
            # Skeletonize BOTH sides identically: the import and the ground-truth
            # solve then run on the same reduced network, keeping the comparison
            # consistent (see docs/project ... skeleton benchmark note).
            try:
                wn, _skmap, _thr = skeletonize_to_target(wn, args.target_nodes)
                print(f"  skeletonized to {len(wn.junction_name_list)} junctions "
                      f"(threshold {_thr})")
            except SkeletonError as exc:
                print(f"  SKIP {name}: skeletonize failed — {exc}")
                continue
        graph = _build_link_graph(wn)  # for _clustered_break's hop search
        demands = compute_junction_demands(wn, args.demand_mode)
        flow_profiles = link_flow_profiles(
            wn, demands,
            contingency_samples=args.contingency_samples,
            contingency_bias_fraction=args.contingency_bias,
            contingency_exhaustive_trunk=args.contingency_exhaustive_trunk,
            contingency_trunk_pairs=args.contingency_trunk_pairs,
            contingency_multiplier=args.contingency_multiplier,
        )
        priority_mode = "none" if args.no_priority_sweep else args.priority_mode
        if priority_mode == "sweep":
            priorities = scarcity_priorities(wn, demands)
        elif priority_mode == "contingency":
            priorities = contingency_priorities(wn, demands)
        else:
            priorities = {}
        # Default = shipped uniform design velocity (ImportOptions.capacity_velocity
        # default 2.5). --capacity-drill reverts pipe capacity to the hydraulic
        # sweep (the S2 ablation); --capacity-velocity overrides the constant.
        opt_kwargs = dict(demand_mode=args.demand_mode, n_levels=args.n_levels)
        if args.capacity_drill:
            opt_kwargs["capacity_velocity"] = None
        elif args.capacity_velocity is not None:
            opt_kwargs["capacity_velocity"] = args.capacity_velocity
        bundle = build_bundle(
            wn, name=name,
            options=ImportOptions(**opt_kwargs),
            flow_profiles=flow_profiles,
            priorities=priorities,
        )
        link_to_edges, link_to_node = _build_link_maps(bundle.project)

        print(f"\n=== {name} ({len(demands)} junctions, n_levels={args.n_levels}) ===")
        network_scores: list[float] = []
        network_confusion = ConfusionCounts()
        # Four families (benchmark-protocol.md §5), ~60 situations each:
        # cluster (random, seeded), targeted/tank/source (deterministic combos).
        situations = (
            _cluster_situations(wn, graph, args.seed)
            + _targeted_situations(wn)
            + _tank_situations(wn)
            + _source_situations(wn)
        )
        for situation in situations:
            ratios, vflag = _solve_served_ratios(wn, demands, situation, args.required_pressure, args.minimum_pressure)
            if not ratios:
                continue
            # Disconnected junctions already arrive at ratio 0 (the singular-PDD
            # correction in `_solve_served_ratios`) → level 1, so the served-ratio
            # quantization below is the sole mapping needed.
            levels_true = {jid: _ratio_to_level(ratio, args.n_levels) for jid, ratio in ratios.items()}
            levels_cascade = _cascade_levels(bundle.project, bundle.config, situation, link_to_edges, link_to_node, demands)
            score, n_compared = _fms(levels_true, levels_cascade, demands, args.n_levels)
            network_scores.append(score)
            kind = situation.label.split("#")[0]
            scores_by_kind[kind].append(score)
            confusion = _binary_confusion(levels_true, levels_cascade, demands)
            network_confusion += confusion
            # Reference predictors (see the comment where their accumulators
            # are declared): the all-operational null model and the
            # source-reachability model, scored on the identical junction set.
            severed = _severed_junctions(wn, situation)
            levels_null = {jid: args.n_levels for jid in levels_true}
            levels_reach = {
                jid: (1 if jid in severed else args.n_levels) for jid in levels_true
            }
            fms_null, _ = _fms(levels_true, levels_null, demands, args.n_levels)
            fms_reach, _ = _fms(levels_true, levels_reach, demands, args.n_levels)
            null_by_kind[kind].append(fms_null)
            reach_by_kind[kind].append(fms_reach)
            r_conf = _binary_confusion(levels_true, levels_reach, demands)
            reach_confusion += r_conf
            detail = f"breaks={situation.broken_link_ids or '-'} hot={situation.hot_junction_ids or '-'}"
            vtag = f" v>{V_MAX_DESIGN_MS:g}:{vflag.n_over}/{vflag.n_pipes}(max{vflag.max_v:.1f})" if vflag else ""
            print(f"  {situation.label:10s} FMS={score:.3f} (null={fms_null:.3f} reach={fms_reach:.3f}, n={n_compared:3d})  {detail}{vtag}")
            if csv_writer is not None:
                csv_writer.writerow([
                    name, args.seed, priority_mode, args.contingency_bias,
                    args.required_pressure, args.minimum_pressure, args.n_levels,
                    kind, situation.label,
                    f"{score:.6f}", n_compared, confusion.tp, confusion.fp, confusion.fn, confusion.tn,
                    f"{fms_null:.6f}", f"{fms_reach:.6f}",
                    r_conf.tp, r_conf.fp, r_conf.fn, r_conf.tn,
                    vflag.n_pipes if vflag else "",
                    vflag.n_over if vflag else "",
                    f"{vflag.max_v:.3f}" if vflag else "",
                    f"{vflag.frac_flow_over:.6f}" if vflag else "",
                ])

        if network_scores:
            print(f"  -> {name} mean FMS = {statistics.mean(network_scores):.3f} over {len(network_scores)} situations")
            c = network_confusion
            print(
                f"  -> {name} binary (critical=level 1 vs operational): "
                f"TP={c.tp} FP={c.fp} FN={c.fn} TN={c.tn}  "
                f"accuracy={c.accuracy:.3f} precision={c.precision:.3f} recall={c.recall:.3f} f1={c.f1:.3f}"
            )
            all_scores.extend(network_scores)
            all_confusion += network_confusion

    if all_scores:
        print(f"\nAGGREGATE FMS across {len(all_scores)} situations: {statistics.mean(all_scores):.3f}")
        print("AGGREGATE FMS by scenario kind (does fidelity hold outside independent random failure?):")
        for kind in _ALL_KINDS:
            scores = scores_by_kind[kind]
            if scores:
                print(
                    f"  {kind:10s} mean FMS = {statistics.mean(scores):.3f}  "
                    f"(null={statistics.mean(null_by_kind[kind]):.3f} "
                    f"reach={statistics.mean(reach_by_kind[kind]):.3f}, "
                    f"n={len(scores)} situations)"
                )
        rc = reach_confusion
        print(
            f"REACHABILITY-BASELINE binary confusion, n={rc.total}: "
            f"TP={rc.tp} FP={rc.fp} FN={rc.fn} TN={rc.tn}  "
            f"precision={rc.precision:.3f} recall={rc.recall:.3f}"
        )
        c = all_confusion
        print(
            f"AGGREGATE binary confusion (critical=level 1 vs operational), n={c.total}:\n"
            f"                  pred critical   pred operational\n"
            f"  true critical   {c.tp:>13d}   {c.fn:>17d}\n"
            f"  true operational{c.fp:>13d}   {c.tn:>17d}\n"
            f"  accuracy={c.accuracy:.3f}  precision={c.precision:.3f}  recall={c.recall:.3f}  f1={c.f1:.3f}"
        )
    else:
        print("\nNo comparable situations produced a result.")

    if csv_file is not None:
        csv_file.close()


if __name__ == "__main__":
    main()
