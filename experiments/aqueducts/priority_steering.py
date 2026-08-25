#!/usr/bin/env python3
"""How far can shedding priority steer the model, and does that range generalize?

Thesis under test (the paper's real priority claim): priorities are not a
"make-it-better-by-default" knob — we proved that backfires under uniform
capacity (precision 0.68 -> 0.63). They are a STEERING lever. The honest,
strong version of the claim: given a network's 10 worst-scoring scenarios,
does there exist ONE priority vector that drastically recovers them WITHOUT
hurting the rest?

Why one should exist. Our dominant error on the worst scenarios is
over-shedding (false positives): max-min fair share spreads a shortage across
many junctions, while the real hydraulics (WNTR PDD) pressure-concentrate it
onto a few. Priority tiers change exactly this: high-priority junctions are
served first, so raising the priority of the junctions the real hydraulics
protect forces the shortage onto the junctions it actually sheds.

The steering vector (ONE per network, "1 selection for all 10"):
  priority_j = round(1..10 mapping of j's MEAN ground-truth level across the
  10 worst scenarios). Junctions the truth keeps operational -> HIGH priority
  (protected, served first); junctions the truth sheds -> LOW priority (shed
  first). This is an oracle-informed vector: it expresses, as priorities, the
  robustness structure a domain expert would know about their own network. The
  claim it tests is a CAPABILITY claim — does the lever have the dynamic range
  to reach the intended behavior — not "the importer should auto-derive this".

Overfitting guard. The vector is FIT on the 10 worst, then scored on BOTH the
fit set (worst-10) and the held-out remainder, reported separately, so we see
whether steering generalizes or merely trades the tail against the body.

Ground truth (_solve_served_ratios) is independent of priorities, so we solve
it once per situation and only re-run the engine per priority vector.

Two arms, and the paper reports both (Supp. Mat. S2):
  PER-SCENARIO oracle — a vector refit for each situation from that situation's
    own ground truth. This is the EXPRESSIVE-RANGE arm: it measures whether the
    lever can reach a specified target at all, and it is the source of the
    paper's 0.04 -> 0.90 (single worst situation) and worst-decile figures.
  SINGLE per-network vector — one vector for the whole network, fit on the
    worst-K. This measures whether the range GENERALIZES, and the answer is
    network-dependent: Modena +0.32 on the fit set and +0.08 held out, C-Town
    +0.067 and +0.000. An expert-set ordering transfers where the module's
    error is DISTRIBUTIONAL and not where it is a shortage-magnitude error
    (C-Town's pump-fed tanks). Neither vector is derivable by the importer —
    both are fitted from ground truth — which is why the paper presents
    priority as an authoring input, not a fidelity parameter.

Run:  python experiments/aqueducts/priority_steering.py [net.inp ...]
"""
from __future__ import annotations

import os
import statistics
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND = os.path.join(_REPO, "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
)

REQ_P = 20.0
MIN_P = 0.0
N_LEVELS = 3
DEMAND_MODE = "peak_hour"
WORST_K = 10

DEFAULT_NETS = [
    "../raw-networks/aqueducts/CTown.inp",
    "../raw-networks/aqueducts/Modena.inp",
]


# Anonymization (paper hard constraint): never print the real export names.
ALIAS = {"Cassacco_totale": "Aqueduct A", "Tarcento_totale": "Aqueduct B", "Zampis": "Aqueduct C"}


def _resolve(name: str) -> str:
    if "/" in name or name.lower().endswith(".inp"):
        return os.path.join(BACKEND, name) if not os.path.isabs(name) else name
    return wntr.library.model_library.get_filepath(name)


def _label(path: str) -> str:
    stem = os.path.basename(path).replace(".inp", "")
    return ALIAS.get(stem, stem)


def _all_situations(wn, graph, seed: int):
    return (
        vf._cluster_situations(wn, graph, seed)
        + vf._targeted_situations(wn)
        + vf._tank_situations(wn)
        + vf._source_situations(wn)
    )


def _score_all(bundle, situations, truth_levels, demands):
    """Return per-situation (label, fms) and pooled confusion for one priority
    vector, reusing the pre-solved ground-truth levels."""
    link_to_edges, link_to_node = vf._build_link_maps(bundle.project)
    per_sit: list[tuple[str, float]] = []
    confusion = vf.ConfusionCounts()
    for label, situation in situations:
        levels_true = truth_levels[label]
        if not levels_true:
            continue
        levels_cascade = vf._cascade_levels(
            bundle.project, bundle.config, situation, link_to_edges, link_to_node, demands
        )
        score, _ = vf._fms(levels_true, levels_cascade, demands, N_LEVELS)
        per_sit.append((label, score))
        confusion += vf._binary_confusion(levels_true, levels_cascade, demands)
    return per_sit, confusion


def _steering_vector(worst_labels, truth_ratios, demands) -> dict[str, int]:
    """ONE per-network vector: junction -> priority 1..10 from its MEAN
    ground-truth served RATIO across the worst-K scenarios (continuous 0..1,
    not the 3-way quantized level — 10x finer signal). Truth serves it fully
    (ratio ~1) -> HIGH priority (protected, served first); truth sheds it
    (ratio ~0) -> LOW priority (shed first)."""
    acc: dict[str, list[float]] = {}
    for label in worst_labels:
        for jid, ratio in truth_ratios[label].items():
            acc.setdefault(jid, []).append(min(1.0, ratio))
    priorities: dict[str, int] = {}
    for jid, ratios in acc.items():
        mean_ratio = statistics.mean(ratios)  # 0..1
        priorities[jid] = max(1, min(10, round(1 + mean_ratio * 9)))
    return priorities


def _scenario_vector(label: str, truth_ratios) -> dict[str, int]:
    """PER-SCENARIO oracle: the same 1..10 mapping as `_steering_vector`, but
    built from ONE situation's ground truth instead of a mean over the worst-K.
    This is the expressive-range probe — it asks what the lever can reach when
    the target is known, not what a deployable static ordering achieves."""
    return {
        jid: max(1, min(10, round(1 + min(1.0, ratio) * 9)))
        for jid, ratio in truth_ratios[label].items()
    }


def _summary(tag: str, per_sit, confusion):
    fms = statistics.mean(s for _, s in per_sit) if per_sit else float("nan")
    c = confusion
    print(
        f"  {tag:22s} FMS={fms:.3f}  P={c.precision:.3f} R={c.recall:.3f} "
        f"F1={c.f1:.3f}  (TP={c.tp} FP={c.fp} FN={c.fn} TN={c.tn})"
    )
    return fms


def run_network(name: str, seed: int = 1) -> None:
    path = _resolve(name)
    wn = wntr.network.WaterNetworkModel(path)
    graph = vf._build_link_graph(wn)
    demands = compute_junction_demands(wn, DEMAND_MODE)
    flow_profiles = link_flow_profiles(wn, demands, contingency_exhaustive_trunk=True)

    situations = [(s.label, s) for s in _all_situations(wn, graph, seed)]

    # Ground truth once (priority-independent): keep both the continuous ratio
    # (to build the steering vector) and the quantized level (to score FMS).
    truth_levels: dict[str, dict[str, int]] = {}
    truth_ratios: dict[str, dict[str, float]] = {}
    for label, situation in situations:
        ratios, _ = vf._solve_served_ratios(wn, demands, situation, REQ_P, MIN_P)
        truth_ratios[label] = ratios or {}
        truth_levels[label] = (
            {jid: vf._ratio_to_level(r, N_LEVELS) for jid, r in ratios.items()} if ratios else {}
        )
    situations = [(lb, s) for (lb, s) in situations if truth_levels[lb]]

    print(f"\n=== {_label(path)} ({len(demands)} junctions, {len(situations)} situations) ===")

    opts = ImportOptions(demand_mode=DEMAND_MODE, n_levels=N_LEVELS)

    # Baseline: uniform capacity, no priority.
    base_bundle = build_bundle(wn, name=_label(path), options=opts, flow_profiles=flow_profiles, priorities={})
    base_sits, base_conf = _score_all(base_bundle, situations, truth_levels, demands)

    worst = sorted(base_sits, key=lambda t: t[1])[:WORST_K]
    worst_labels = {lb for lb, _ in worst}
    print("  worst scenarios (baseline):",
          ", ".join(f"{lb}={s:.2f}" for lb, s in worst))

    # Steering vector fit on the worst-K.
    priorities = _steering_vector(worst_labels, truth_ratios, demands)
    steer_bundle = build_bundle(wn, name=_label(path), options=opts, flow_profiles=flow_profiles, priorities=priorities)
    steer_sits, steer_conf = _score_all(steer_bundle, situations, truth_levels, demands)

    base_by = dict(base_sits)
    steer_by = dict(steer_sits)

    def split(labels_pred, sit_map):
        return [(lb, sit_map[lb]) for lb in labels_pred if lb in sit_map]

    all_labels = [lb for lb, _ in base_sits]
    held = [lb for lb in all_labels if lb not in worst_labels]

    print("  -- ALL situations --")
    _summary("baseline (none)", base_sits, base_conf)
    _summary("steered (1 vector)", steer_sits, steer_conf)
    print("  -- WORST-10 (fit set) --")
    b = statistics.mean(base_by[lb] for lb in worst_labels)
    s = statistics.mean(steer_by[lb] for lb in worst_labels)
    print(f"  {'baseline':22s} FMS={b:.3f}")
    print(f"  {'steered':22s} FMS={s:.3f}   (delta {s - b:+.3f})")
    print("  -- HELD-OUT (rest) --")
    bh = statistics.mean(base_by[lb] for lb in held)
    sh = statistics.mean(steer_by[lb] for lb in held)
    print(f"  {'baseline':22s} FMS={bh:.3f}")
    print(f"  {'steered':22s} FMS={sh:.3f}   (delta {sh - bh:+.3f})")

    # --- PER-SCENARIO oracle: expressive range, one vector refit per situation.
    # Each situation is rebuilt and rescored on its own; this is the arm the
    # paper quotes for the lever's range, and it is deliberately NOT deployable.
    print("  -- PER-SCENARIO oracle (expressive range, worst-K) --")
    per_scenario: list[tuple[str, float, float]] = []
    for label in sorted(worst_labels):
        situation = dict(situations)[label]
        vec = _scenario_vector(label, truth_ratios)
        one_bundle = build_bundle(
            wn, name=_label(path), options=opts, flow_profiles=flow_profiles, priorities=vec
        )
        sits, _ = _score_all(one_bundle, [(label, situation)], truth_levels, demands)
        if sits:
            per_scenario.append((label, base_by[label], sits[0][1]))
    for label, before, after in sorted(per_scenario, key=lambda t: t[1]):
        print(f"  {label:22s} {before:.3f} -> {after:.3f}   ({after - before:+.3f})")
    if per_scenario:
        mb = statistics.mean(b for _, b, _ in per_scenario)
        ma = statistics.mean(a for _, _, a in per_scenario)
        print(f"  {'worst-K mean':22s} {mb:.3f} -> {ma:.3f}   ({ma - mb:+.3f})")


def main() -> None:
    nets = sys.argv[1:] or DEFAULT_NETS
    for name in nets:
        run_network(name)


if __name__ == "__main__":
    main()
