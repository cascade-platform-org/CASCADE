"""
experiments/collect_worst_situations.py — find the situations where CASCADE's
engine diverges most from real EPANET hydraulics, and export each one as a
self-contained investigation kit.

For every (network, seed, situation) in the sweep, computes the FMS the same
way scripts/validate_faithfulness.py does (same situation generation, same
ground-truth solve, same quantization). Then, for the WORST N situations,
writes a folder containing:

  scenario.bundle.json   — {project, config} exactly as the CASCADE app loads
                           it (File I/O panel → Load), with the situation
                           already applied (broken elements at functionality 1,
                           hot demands scaled) and source_inp_content embedded,
                           so graph_type can be flipped to "epanet" in the UI.
  engine_result.json     — PropagationResult from the real engine run.
  epanet_result.json     — per-junction ground-truth levels from the WNTR PDD
                           solve (the same solve the "epanet" graph_type runs).
  comparison.md          — per-junction mismatch table (engine vs epanet level,
                           demand weight), situation metadata, FMS.

Output: experiments/worst-situations/<rank>_<network>_<situation>/
(gitignored — the aqueduct scenarios contain real network data; never commit).

Run from CASCADE-backend/:  python experiments/collect_worst_situations.py
"""
from __future__ import annotations

import json
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wntr  # noqa: E402

from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
    scarcity_priorities,
)
from engine.flow import _ratio_to_level  # noqa: E402
from engine.propagation import run as engine_run  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402
from scripts.validate_faithfulness import (  # noqa: E402
    Situation,
    _build_link_graph,
    _build_link_maps,
    _cascade_levels,
    _fms,
    _random_situation,
    _solve_served_ratios,
    _tank_situations,
)

# Frozen headline config (complenet_todos.md E3'''): exhaustive trunk + 30
# N-2 pairs + 20 uniform contingencies, hydraulic priority sweep on.
N_LEVELS = 3
SEEDS = [1, 2]
SITUATIONS_PER_NETWORK = 30
WORST_N = 10
NETWORKS = {
    "Net1": None,  # resolved via wntr model library
    "Net3": None,
    "Cassacco": "../raw-networks/aqueducts/Cassacco_totale.inp",
    "Tarcento": "../raw-networks/aqueducts/Tarcento_totale.inp",
    "Zampis": "../raw-networks/aqueducts/Zampis.inp",
    # Net6 skipped on purpose: too slow for iteration (owner instruction).
}

OUT = Path(__file__).resolve().parent / "worst-situations"


def _apply_situation(project, situation, link_to_edges, link_to_node):
    """The same mutation _cascade_levels applies internally, on a deep copy we
    keep: broken links -> functionality 1 on their edges/inline nodes, hot
    junctions -> scaled water demand."""
    scenario = project.model_copy(deep=True)
    for link_id in situation.broken_link_ids:
        for eid in link_to_edges.get(link_id, []):
            scenario.edges[eid].functionality = 1
        node_id = link_to_node.get(link_id)
        if node_id is not None:
            scenario.nodes[node_id].functionality = 1
    for jid in situation.hot_junction_ids:
        node = scenario.nodes.get(jid)
        profile = (node.category_dependency_profiles or {}).get("water") if node else None
        if profile is not None and profile.demand:
            profile.demand = profile.demand * situation.hot_factor
    return scenario


def main() -> None:
    rows = []  # (fms, network, situation, context dict)

    for name, path in NETWORKS.items():
        inp_path = path or wntr.library.model_library.get_filepath(name)
        inp_content = Path(inp_path).read_text()
        wn = wntr.network.WaterNetworkModel(inp_path)
        graph = _build_link_graph(wn)
        demands = compute_junction_demands(wn, "peak")
        flow_profiles = link_flow_profiles(
            wn, demands,
            contingency_samples=20,
            contingency_exhaustive_trunk=True,
            contingency_trunk_pairs=30,
        )
        priorities = scarcity_priorities(wn, demands)
        bundle = build_bundle(
            wn, name=name,
            options=ImportOptions(demand_mode="peak", n_levels=N_LEVELS),
            flow_profiles=flow_profiles, priorities=priorities,
        )
        link_to_edges, link_to_node = _build_link_maps(bundle.project)

        situations: list[Situation] = []
        for seed in SEEDS:
            rng = random.Random(seed)  # nosec B311 — deterministic scenario generation
            situations += [
                _random_situation(wn, graph, rng, i) for i in range(SITUATIONS_PER_NETWORK)
            ]
        situations += _tank_situations(wn)

        for situation in situations:
            ratios = _solve_served_ratios(wn, demands, situation, 20.0, 0.0)
            if not ratios:
                continue
            levels_true = {j: _ratio_to_level(r, N_LEVELS) for j, r in ratios.items()}
            levels_cascade = _cascade_levels(
                bundle.project, bundle.config, situation, link_to_edges, link_to_node, demands
            )
            score, n_compared = _fms(levels_true, levels_cascade, demands, N_LEVELS)
            rows.append((
                score, name, situation,
                dict(
                    bundle=bundle, wn=wn, demands=demands, inp_content=inp_content,
                    link_to_edges=link_to_edges, link_to_node=link_to_node,
                    levels_true=levels_true, levels_cascade=levels_cascade,
                    n_compared=n_compared,
                ),
            ))
        print(f"{name}: {len(situations)} situations swept")

    rows.sort(key=lambda r: r[0])
    worst = rows[:WORST_N]

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    index_lines = [
        "# Worst situations — engine vs EPANET investigation kits",
        "",
        "Config: exhaustive-trunk + 30 N-2 pairs + 20 uniform contingencies,",
        f"priority sweep ON, n_levels={N_LEVELS}, seeds={SEEDS},",
        f"{SITUATIONS_PER_NETWORK} sampled situations/seed + exhaustive tanks, Net6 skipped.",
        "",
        "Load `scenario.bundle.json` in the app (File I/O → Load); the situation is",
        "already applied. Propagate for the engine's view; flip the canvas graph",
        "type to `epanet` for the live WNTR view. NEVER COMMIT the aqueduct kits.",
        "",
        "| rank | network | situation | FMS | broken links | hot |",
        "|---|---|---|---|---|---|",
    ]

    for rank, (score, name, situation, ctx) in enumerate(worst, start=1):
        kit = OUT / f"{rank:02d}_{name}_{situation.label.replace('#', '-')}"
        kit.mkdir()
        bundle = ctx["bundle"]

        scenario = _apply_situation(
            bundle.project, situation, ctx["link_to_edges"], ctx["link_to_node"]
        )
        for canvas in scenario.canvases:
            canvas.source_inp_content = ctx["inp_content"]
            canvas.source_inp_demand_mode = "peak"
        (kit / "scenario.bundle.json").write_text(json.dumps(
            {
                "project": scenario.model_dump(exclude_none=True),
                "config": bundle.config.model_dump(exclude_none=True),
            },
            indent=1,
        ))

        engine_result = engine_run(PropagationRequest(
            project=scenario, config=bundle.config, scope="global"
        ))
        (kit / "engine_result.json").write_text(
            engine_result.model_dump_json(indent=1, exclude_none=True)
        )

        (kit / "epanet_result.json").write_text(json.dumps(
            {
                "levels": ctx["levels_true"],
                "note": "Ground-truth WNTR PDD levels per junction inp_id — the same "
                        "solve graph_type='epanet' runs live.",
            },
            indent=1,
        ))

        lt, lc, demands = ctx["levels_true"], ctx["levels_cascade"], ctx["demands"]
        mismatches = sorted(
            (j for j in lt if j in lc and lt[j] != lc[j]),
            key=lambda j: -demands.get(j, 0.0),
        )
        lines = [
            f"# {name} / {situation.label} — FMS {score:.3f}",
            "",
            f"- broken links: `{situation.broken_link_ids or '-'}`",
            f"- hot junctions (x{situation.hot_factor:.2f}): `{situation.hot_junction_ids or '-'}`",
            f"- junctions compared: {ctx['n_compared']}, mismatched: {len(mismatches)}",
            "",
            "| junction | epanet level | engine level | demand (m3/s) |",
            "|---|---|---|---|",
            *(
                f"| {j} | {lt[j]} | {lc[j]} | {demands.get(j, 0.0):.5f} |"
                for j in mismatches
            ),
        ]
        (kit / "comparison.md").write_text("\n".join(lines) + "\n")

        index_lines.append(
            f"| {rank} | {name} | {situation.label} | {score:.3f} "
            f"| {len(situation.broken_link_ids)} | {'yes' if situation.hot_junction_ids else 'no'} |"
        )
        print(f"  kit {kit.name}: FMS={score:.3f} mismatches={len(mismatches)}")

    (OUT / "README.md").write_text("\n".join(index_lines) + "\n")
    print(f"\nDone: {len(worst)} kits in {OUT}")


if __name__ == "__main__":
    main()
