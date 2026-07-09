"""
scripts/validate_faithfulness.py — how closely does CASCADE's engine output
match real WNTR hydraulics, for randomly generated stress situations?

For each situation (a random set of pipe/pump breaks and/or demand spikes),
this script:
  1. Runs the SAME intervention on the real WNTR model (closes the same
     links, scales the same junctions' demand) and solves a real PDD steady
     state — the "ground truth" delivered/expected ratio per junction.
  2. Converts that ratio into a CASCADE functionality level using the
     engine's OWN quantization rule (`engine.flow._ratio_to_level`), so the
     comparison isn't confounded by two different rounding schemes.
  3. Applies the identical intervention to the imported CASCADE Project
     (edge/node functionality = 1 for a break, doubled-or-more demand for a
     surge) and runs the real engine (`engine.propagation.run`) to get
     CASCADE's own resulting level per junction.
  4. Compares the two per junction and reduces it to ONE number per
     situation: a demand-weighted "Functionality Match Score" (FMS) —
     1 − weighted_mean(|level_true − level_cascade|) / (N−1), in [0, 1].

The aggregate across every situation/network is the single "how faithful is
the importer + engine's flow heuristic to real hydraulics" number.

This is a dev-only validation harness, not shipped product code — the same
category as scripts/benchmark_engine.py, which is why it shares that
script's import-linter carve-out (pyproject.toml) to import engine.* directly:
we need the engine's REAL propagation call and its REAL ratio→level rule, not
a reimplementation of either (a second, slightly-different quantization rule
would make this script measure its own drift, not the engine's).

Out of scope on purpose: Tank Reserve. It is a time-warning
(`functionality_time` countdown), not a hydraulic state change at the moment
it is applied — the tank is still fully supplying right after the event, so
there is nothing for a t=0 WNTR solve to disagree with CASCADE about.

    python scripts/validate_faithfulness.py
    python scripts/validate_faithfulness.py --networks Net1,Net3 --situations 30 --seed 1
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

import wntr  # noqa: E402

from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
)
from engine.flow import _ratio_to_level  # noqa: E402 — see module docstring
from engine.propagation import run as propagate  # noqa: E402
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

_REQUIRED_PRESSURE_M = 20.0
_MINIMUM_PRESSURE_M = 0.0


@dataclass
class Situation:
    label: str
    broken_link_ids: list[str] = field(default_factory=list)   # WNTR pipe/pump ids
    surged_junction_ids: list[str] = field(default_factory=list)
    surge_factor: float = 1.0


def _random_situation(wn: wntr.network.WaterNetworkModel, rng: random.Random, index: int) -> Situation:
    """A random 'break', 'surge', or 'both' — the two scenario families
    requested: pipe/pump breaks and demand spikes."""
    kind = rng.choice(["break", "surge", "both"])
    breakable = list(wn.pipe_name_list) + list(wn.pump_name_list)
    demanding = [j for j in wn.junction_name_list if wn.get_node(j).demand_timeseries_list]

    broken: list[str] = []
    surged: list[str] = []
    factor = 1.0
    if kind in ("break", "both") and breakable:
        k = rng.randint(1, min(3, len(breakable)))
        broken = rng.sample(breakable, k)
    if kind in ("surge", "both") and demanding:
        k = max(1, round(len(demanding) * 0.1))
        surged = rng.sample(demanding, min(k, len(demanding)))
        factor = rng.uniform(1.5, 3.0)
    return Situation(label=f"{kind}#{index}", broken_link_ids=broken, surged_junction_ids=surged, surge_factor=factor)


def _solve_served_ratios(
    wn: wntr.network.WaterNetworkModel,
    demands: dict[str, float],
    situation: Situation,
) -> dict[str, float]:
    """Ground truth: a steady-state PDD solve of `wn` under `situation`'s
    interventions, every junction fixed to its `demands` value (the same
    demand_mode value CASCADE was imported with) except the surged ones,
    scaled by `situation.surge_factor`. Returns junction id → delivered/
    expected ratio (clamped at 0, since WNTR can report a tiny negative
    residual under PDD at zero pressure)."""
    model = copy.deepcopy(wn)
    # A Demand entry's pattern_name=None does NOT mean "constant" to WNTR — it
    # falls back to the model's GLOBAL default pattern (wn.options.hydraulic.
    # pattern) if the .inp file sets one. Net6 does, and its first multiplier
    # is 0.1 — every "fixed" demand below would otherwise be silently cut to a
    # tenth of its value (core.importers.inp.sim._fixed_demand_model has the
    # same fix, for the same reason).
    model.options.hydraulic.pattern = None
    for jid, demand in demands.items():
        factor = situation.surge_factor if jid in situation.surged_junction_ids else 1.0
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
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M

    with tempfile.TemporaryDirectory(prefix="cascade-validate-") as tmpdir:
        prefix = str(Path(tmpdir) / "validate")
        try:
            results = wntr.sim.EpanetSimulator(model).run_sim(file_prefix=prefix)
        except Exception:
            return {}  # a pathological situation (e.g. isolates every source) — no ground truth this round
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
    scaled for a surge), run the real engine, and return junction id →
    resulting functionality level for every demand-bearing junction."""
    project = bundle_project.model_copy(deep=True)

    for link_id in situation.broken_link_ids:
        for eid in link_to_edges.get(link_id, []):
            project.edges[eid].functionality = 1
        node_id = link_to_node.get(link_id)
        if node_id is not None:
            project.nodes[node_id].functionality = 1

    for jid in situation.surged_junction_ids:
        node = project.nodes.get(jid)
        profile = (node.category_dependency_profiles or {}).get("water") if node else None
        if profile is not None and profile.demand:
            profile.demand = profile.demand * situation.surge_factor

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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--networks", default="Net1,Net3", help="Comma-separated wntr.library.model_library names.")
    parser.add_argument("--situations", type=int, default=20, help="Random situations per network.")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--n-levels", type=int, default=3)
    parser.add_argument("--demand-mode", default="peak", choices=["peak", "base", "avg"])
    args = parser.parse_args()

    rng = random.Random(args.seed)  # nosec B311 — deterministic test-scenario generation, not security
    all_scores: list[float] = []

    for name in (n.strip() for n in args.networks.split(",")):
        # A bare name (Net1, Net3, ...) resolves against wntr's bundled
        # example networks; anything that looks like a path (has a slash or
        # a .inp suffix) is loaded directly, e.g. a real aqueduct export
        # under raw-networks/aqueducts/ that ships with neither wntr nor
        # this repo's own fixtures.
        path = name if ("/" in name or name.lower().endswith(".inp")) else wntr.library.model_library.get_filepath(name)
        wn = wntr.network.WaterNetworkModel(path)
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
        for i in range(args.situations):
            situation = _random_situation(wn, rng, i)
            ratios = _solve_served_ratios(wn, demands, situation)
            if not ratios:
                continue
            levels_true = {jid: _ratio_to_level(ratio, args.n_levels) for jid, ratio in ratios.items()}
            levels_cascade = _cascade_levels(bundle.project, bundle.config, situation, link_to_edges, link_to_node, demands)
            score, n_compared = _fms(levels_true, levels_cascade, demands, args.n_levels)
            network_scores.append(score)
            detail = f"breaks={situation.broken_link_ids or '-'} surge={situation.surged_junction_ids or '-'}"
            print(f"  {situation.label:10s} FMS={score:.3f}  (n={n_compared:3d})  {detail}")

        if network_scores:
            print(f"  -> {name} mean FMS = {statistics.mean(network_scores):.3f} over {len(network_scores)} situations")
            all_scores.extend(network_scores)

    if all_scores:
        print(f"\nAGGREGATE FMS across {len(all_scores)} situations: {statistics.mean(all_scores):.3f}")
    else:
        print("\nNo comparable situations produced a result.")


if __name__ == "__main__":
    main()
