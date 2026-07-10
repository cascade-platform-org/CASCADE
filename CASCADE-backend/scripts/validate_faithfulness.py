"""
scripts/validate_faithfulness.py — how closely does CASCADE's engine output
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

    python scripts/validate_faithfulness.py
    python scripts/validate_faithfulness.py --networks Net1,Net3 --situations 30 --seed 1
    python scripts/validate_faithfulness.py --n-levels 5
    python scripts/validate_faithfulness.py --required-pressure 15 --minimum-pressure 5
"""
from __future__ import annotations

import argparse
import copy
import random
import statistics
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# Allow `python scripts/validate_faithfulness.py` from CASCADE-backend/ by
# putting the backend package root on sys.path (same pattern as
# scripts/export_json_schema.py / scripts/benchmark_engine.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import networkx as nx  # noqa: E402
import wntr  # noqa: E402

from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
)
from core.importers.inp.sim import _check_converged  # noqa: E402 — see module docstring
from engine.flow import _ratio_to_level  # noqa: E402 — see module docstring
from engine.propagation import run as propagate  # noqa: E402
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

_KINDS = ["break", "hot", "both", "cluster", "targeted"]
# "tank" is deliberately not in _KINDS: that list drives `_random_situation`'s
# rng.choice, and the tank family is exhaustive (`_tank_situations`), not
# sampled — it's added separately in main()/reported alongside _KINDS in
# _ALL_KINDS instead.
_ALL_KINDS = [*_KINDS, "tank"]

# Cluster attack: how many topological hops from a random epicenter link
# count as "in the blast radius," and how many of the breakable links found
# there actually get closed (never more than exist).
_CLUSTER_RADIUS_HOPS = 2
_CLUSTER_MAX_BREAKS = 6

# Targeted attack: the pool is the top `_TARGET_TOP_FRACTION` of pipes by
# diameter (the model's own proxy for trunk-main capacity) plus every pump
# (a pump is a structural bottleneck regardless of diameter) — `k` of that
# pool are closed per situation.
_TARGET_TOP_FRACTION = 0.10
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


def _tank_situations(wn: wntr.network.WaterNetworkModel) -> list[Situation]:
    """One Situation per Tank — ALL of its connecting links closed. Tanks
    aren't links themselves (WNTR has no "close this Tank" flag), so the
    closest a t=0 steady solve can get to "this tank contributes zero water"
    is closing every link touching it (`wn.get_links_for_node`), covering
    whatever mix of pipes/pumps/valves connects it in this particular file.
    `_cascade_levels`/`_solve_served_ratios` already know how to apply
    `broken_link_ids` to both sides identically — no new mechanism needed.
    Exhaustive over every tank, not sampled: see the module docstring."""
    situations: list[Situation] = []
    for i, tid in enumerate(sorted(wn.tank_name_list)):
        links = sorted(wn.get_links_for_node(tid))
        situations.append(Situation(label=f"tank#{i}", broken_link_ids=links))
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


def _solve_served_ratios(
    wn: wntr.network.WaterNetworkModel,
    demands: dict[str, float],
    situation: Situation,
    required_pressure_m: float,
    minimum_pressure_m: float,
) -> dict[str, float]:
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
            return {}  # a pathological or non-converging situation — no ground truth this round
    delivered = results.node["demand"].iloc[0]

    ratios: dict[str, float] = {}
    for jid, expected in demands.items():
        if expected <= 0:
            continue
        got = float(delivered.get(jid, 0.0))
        ratios[jid] = max(0.0, got / expected)
    return ratios


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
    parser.add_argument("--situations", type=int, default=20, help="Random situations per network.")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--n-levels", type=int, default=3)
    parser.add_argument("--demand-mode", default="peak", choices=["peak", "base", "avg"])
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
    args = parser.parse_args()

    rng = random.Random(args.seed)  # nosec B311 — deterministic test-scenario generation, not security
    all_scores: list[float] = []
    all_confusion = ConfusionCounts()
    scores_by_kind: dict[str, list[float]] = {kind: [] for kind in _ALL_KINDS}

    for name in (n.strip() for n in args.networks.split(",")):
        # A bare name (Net1, Net3, ...) resolves against wntr's bundled
        # example networks; anything that looks like a path (has a slash or
        # a .inp suffix) is loaded directly, e.g. a real aqueduct export
        # under raw-networks/aqueducts/ that ships with neither wntr nor
        # this repo's own fixtures.
        path = name if ("/" in name or name.lower().endswith(".inp")) else wntr.library.model_library.get_filepath(name)
        wn = wntr.network.WaterNetworkModel(path)
        graph = _build_link_graph(wn)  # for _clustered_break's hop search
        demands = compute_junction_demands(wn, args.demand_mode)
        flow_profiles = link_flow_profiles(wn, demands)
        bundle = build_bundle(
            wn, name=name,
            options=ImportOptions(demand_mode=args.demand_mode, n_levels=args.n_levels),
            flow_profiles=flow_profiles,
        )
        link_to_edges, link_to_node = _build_link_maps(bundle.project)

        print(f"\n=== {name} ({len(demands)} junctions, n_levels={args.n_levels}) ===")
        network_scores: list[float] = []
        network_confusion = ConfusionCounts()
        # The `args.situations` random draws (break/hot/both/cluster/targeted)
        # plus every tank's complete-disservice situation, exhaustively — see
        # `_tank_situations` / the module docstring's "tank" family.
        situations = [_random_situation(wn, graph, rng, i) for i in range(args.situations)]
        situations += _tank_situations(wn)
        for situation in situations:
            ratios = _solve_served_ratios(wn, demands, situation, args.required_pressure, args.minimum_pressure)
            if not ratios:
                continue
            levels_true = {jid: _ratio_to_level(ratio, args.n_levels) for jid, ratio in ratios.items()}
            levels_cascade = _cascade_levels(bundle.project, bundle.config, situation, link_to_edges, link_to_node, demands)
            score, n_compared = _fms(levels_true, levels_cascade, demands, args.n_levels)
            network_scores.append(score)
            scores_by_kind[situation.label.split("#")[0]].append(score)
            network_confusion += _binary_confusion(levels_true, levels_cascade, demands)
            detail = f"breaks={situation.broken_link_ids or '-'} hot={situation.hot_junction_ids or '-'}"
            print(f"  {situation.label:10s} FMS={score:.3f}  (n={n_compared:3d})  {detail}")

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
                print(f"  {kind:10s} mean FMS = {statistics.mean(scores):.3f}  (n={len(scores)} situations)")
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


if __name__ == "__main__":
    main()
