"""Snapshot figure for the paper's Supplementary: one failure situation on one
network, drawn three ways side by side — the pressure-driven WNTR reference, the
flow module, and the reachability baseline — every junction coloured by its
functionality level.

Mirrors the per-situation setup of `validate_faithfulness.main()` at the
canonical configuration (peak-hour demand, N=3, no priority, uniform design
velocity, exhaustive trunk contingencies), so the counts printed here equal the situation's row in
`final_benchmark.csv`.

    python3 figure_snapshot.py --network Net3 --situation targeted#41 --out fig_net3_snapshot.png
"""
from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import validate_faithfulness as vf  # noqa: E402  (also puts CASCADE-backend on sys.path)
import wntr  # noqa: E402
from core.importers.inp import ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles  # noqa: E402
from engine.flow import _ratio_to_level  # noqa: E402

# Same three colours as the main paper's Fig. 1 legend (cascgreen / cascred),
# plus an amber for the intermediate level.
LEVEL_COLOUR = {1: "#EF4444", 2: "#FBBF24", 3: "#22C55E"}
N_LEVELS = 3


def _situation(wn: wntr.network.WaterNetworkModel, label: str, seed: int) -> vf.Situation:
    graph = vf._build_link_graph(wn)
    pool = (
        vf._cluster_situations(wn, graph, seed)
        + vf._targeted_situations(wn)
        + vf._tank_situations(wn)
        + vf._source_situations(wn)
    )
    for s in pool:
        if s.label == label:
            return s
    raise SystemExit(f"no situation {label!r}; have {[s.label for s in pool][:8]}...")


def _panel(ax, wn, levels: dict[str, int], broken: list[str], title: str) -> None:
    pos = {n: wn.get_node(n).coordinates for n in wn.node_name_list}
    # Line width follows pipe diameter, so the large mains the attack picks from stand out;
    # each closed link gets a halo and a cross at its midpoint (some are short).
    for lid in wn.link_name_list:
        link = wn.get_link(lid)
        (x1, y1), (x2, y2) = pos[link.start_node_name], pos[link.end_node_name]
        width = 0.5 + 2.5 * getattr(link, "diameter", 0.3) ** 0.5 / 1.6
        ax.plot([x1, x2], [y1, y2], color="0.72", lw=width, solid_capstyle="round", zorder=1)
    for lid in broken:
        link = wn.get_link(lid)
        (x1, y1), (x2, y2) = pos[link.start_node_name], pos[link.end_node_name]
        ax.plot([x1, x2], [y1, y2], color="black", lw=2.4, ls=(0, (2, 1.5)), zorder=5)
        ax.scatter((x1 + x2) / 2, (y1 + y2) / 2, s=75, marker="x", c="black", linewidths=2.2, zorder=6)
    for n in wn.junction_name_list:
        if n in levels:
            ax.scatter(*pos[n], s=26, c=LEVEL_COLOUR[levels[n]], edgecolors="0.25", linewidths=0.4, zorder=3)
        else:  # zero-demand junction: not scored
            ax.scatter(*pos[n], s=8, c="0.85", zorder=3)
    for n in wn.reservoir_name_list:
        ax.scatter(*pos[n], s=70, marker="D", c="0.35", zorder=4)
    for n in wn.tank_name_list:
        ax.scatter(*pos[n], s=70, marker="s", c="0.35", zorder=4)
    ax.set_title(title, fontsize=9)
    ax.set_aspect("equal")
    ax.axis("off")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--network", default="Net3")
    ap.add_argument("--situation", required=True, help="label as in final_benchmark.csv, e.g. targeted#41")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    wn = wntr.network.WaterNetworkModel(wntr.library.model_library.get_filepath(args.network))
    demands = compute_junction_demands(wn, "peak_hour")
    bundle = build_bundle(
        wn, name=args.network,
        options=ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS),
        flow_profiles=link_flow_profiles(wn, demands, contingency_samples=20, contingency_exhaustive_trunk=True),
        priorities={},
    )
    link_to_edges, link_to_node = vf._build_link_maps(bundle.project)
    sit = _situation(wn, args.situation, args.seed)

    ratios, _ = vf._solve_served_ratios(wn, demands, sit, 20.0, 0.0)
    truth = {j: _ratio_to_level(r, N_LEVELS) for j, r in ratios.items()}
    module = vf._cascade_levels(bundle.project, bundle.config, sit, link_to_edges, link_to_node, demands)
    severed = vf._severed_junctions(wn, sit)
    reach = {j: (1 if j in severed else N_LEVELS) for j in truth}

    for name, lv in (("WNTR", truth), ("module", module), ("reachability", reach)):
        c = vf._binary_confusion(truth, lv, demands)
        print(f"{name:13s} critical={sum(v == 1 for v in lv.values()):3d}  tp={c.tp} fp={c.fp} fn={c.fn}")

    fig, axes = plt.subplots(1, 3, figsize=(11, 3.9))
    _panel(axes[0], wn, truth, sit.broken_link_ids, "(a) WNTR Pressure-Driven (Reference)")
    _panel(axes[1], wn, module, sit.broken_link_ids, "(b) Flow Module")
    _panel(axes[2], wn, reach, sit.broken_link_ids, "(c) Reachability Baseline")
    handles = [plt.Line2D([], [], marker="o", ls="", mfc=LEVEL_COLOUR[k], mec="0.25", label=l)
               for k, l in ((3, "operational"), (2, "degraded"), (1, "critical"))]
    handles += [plt.Line2D([], [], marker="x", ls="", mec="black", mew=2, ms=8, label="closed by the attack"),
                plt.Line2D([], [], marker="D", ls="", color="0.35", label="reservoir"),
                plt.Line2D([], [], marker="s", ls="", color="0.35", label="tank")]
    fig.legend(handles=handles, loc="lower center", ncol=6, frameon=False, fontsize=8)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    fig.savefig(args.out, dpi=200)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
