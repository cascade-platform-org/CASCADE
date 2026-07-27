#!/usr/bin/env python3
"""END-TO-END: does the redesigned drill actually SCORE better?

Compares two ways of producing a bundle's capacities + priorities, then scores
each against WNTR ground truth with validate_faithfulness's own functions
(precision / recall / FMS), on the four failure families.

  A = PRODUCTION (current final_benchmark.csv basis):
      capacity  = demand sweep + exhaustive-top-10%-trunk + 20 random singles
      priority  = contingency_priorities (cycle-trunk top-20%, 40 singles/20 pairs/10 triplets)

  B = REDESIGN:
      capacity  = demand sweep + BATCH-5-cover-2 over source-contracted non-bridges
      priority  = flow-ranked top-15% SINGLE closures over source-contracted non-bridges

Ground truth (_solve_served_ratios) depends only on (wn, situation), so it is
computed ONCE per situation and shared; only the module prediction differs.

Situations capped per family (--cap) to keep this a quick comparison; A and B
see the IDENTICAL situation set, so the comparison is apples-to-apples.

Run:  python experiments/diag_drill_endtoend.py [net.inp ...]
"""
from __future__ import annotations

import math
import os
import random
import statistics
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import networkx as nx  # noqa: E402
import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import (  # noqa: E402
    ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles,
    contingency_priorities,
)
from core.importers.inp.map import FLOW_UNIT_SCALE  # noqa: E402
from core.importers.inp.sim import (  # noqa: E402
    _accumulate_profiles, _fixed_demand_model, _run_sweep_step,
    _REQUIRED_PRESSURE_M, _MINIMUM_PRESSURE_M, LinkFlowProfile,
)

UNIFORM_VELOCITY = 2.5  # m/s design velocity for the geometric baseline (method C)

N_LEVELS = 3
REQ_P, MIN_P = 20.0, 0.0


# ---- shared: source-contracted non-bridge candidates, flow-ranked -----------
def _base_model(wn, demands):
    m = _fixed_demand_model(wn, demands)
    m.options.time.duration = 0
    m.options.hydraulic.demand_model = "PDD"
    m.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    m.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M
    return m


def _nominal_flows(wn, demands):
    m = _base_model(wn, demands)
    with tempfile.TemporaryDirectory(prefix="cascade-e2e-") as td:
        fr = _run_sweep_step(m, 1.0, str(Path(td) / "f")).link["flowrate"].iloc[0]
    return {lid: abs(float(fr.get(lid, 0.0)))
            for lid in set(wn.pipe_name_list) | set(wn.valve_name_list) | set(wn.pump_name_list)}


def _candidates(wn, flows):
    sources = set(wn.reservoir_name_list) | set(wn.tank_name_list)
    g = nx.Graph()
    pair = {}
    for lid in list(wn.pipe_name_list) + list(wn.valve_name_list) + list(wn.pump_name_list):
        lk = wn.get_link(lid)
        a = "S" if lk.start_node_name in sources else lk.start_node_name
        b = "S" if lk.end_node_name in sources else lk.end_node_name
        pair[lid] = (a, b)
        if a != b:
            g.add_edge(a, b)
    cnt = Counter(frozenset(p) for p in pair.values() if p[0] != p[1])
    br = {frozenset(e) for e in nx.bridges(g)} if g.number_of_edges() else set()
    cand = [lid for lid, (a, b) in pair.items()
            if a != b and not (frozenset((a, b)) in br and cnt[frozenset((a, b))] == 1)]
    return sorted(cand, key=lambda l: flows.get(l, 0.0), reverse=True)


def _merge(*pds):
    out = {}
    for pd in pds:
        for lid, p in pd.items():
            m = out.setdefault(lid, LinkFlowProfile())
            m.velocity_fwd = max(m.velocity_fwd, p.velocity_fwd)
            m.velocity_rev = max(m.velocity_rev, p.velocity_rev)
    return out


def _run_groups(wn, demands, link_ids, groups):
    prof = {}
    m = _base_model(wn, demands)
    with tempfile.TemporaryDirectory(prefix="cascade-e2e-") as td:
        px = str(Path(td) / "g")
        for i, grp in enumerate(groups):
            links = [m.get_link(x) for x in grp]
            orig = [x.initial_status for x in links]
            for x in links:
                x.initial_status = "Closed"
            try:
                r = _run_sweep_step(m, 1.0, f"{px}-{i}")
            except Exception:
                continue
            finally:
                for x, s in zip(links, orig):
                    x.initial_status = s
            _accumulate_profiles(prof, link_ids, r.link["velocity"].iloc[0],
                                 r.link["flowrate"].iloc[0], exclude=frozenset(grp))
    return prof


def _batch_capacity(wn, demands, cand, k=5, passes=2, seed=1):
    link_ids = set(wn.pipe_name_list) | set(wn.valve_name_list)
    rng = random.Random(seed)
    groups = []
    for _ in range(passes):
        sh = cand[:]
        rng.shuffle(sh)
        groups += [tuple(sh[j:j + k]) for j in range(0, len(sh), k)]
    return _run_groups(wn, demands, link_ids, groups)


def _flowranked_single_priority(wn, demands, cand, frac=0.15):
    junctions = [j for j, d in demands.items() if d > 0]
    b = max(1, round(len(cand) * frac))
    deficit = dict.fromkeys(junctions, 0.0)
    m = _base_model(wn, demands)
    with tempfile.TemporaryDirectory(prefix="cascade-e2e-") as td:
        px = str(Path(td) / "p")
        for i, lid in enumerate(cand[:b]):
            link = m.get_link(lid)
            orig = link.initial_status
            link.initial_status = "Closed"
            try:
                r = _run_sweep_step(m, 1.0, f"{px}-{i}")
            except Exception:
                continue
            finally:
                link.initial_status = orig
            delivered = r.node["demand"].iloc[0]
            for j in junctions:
                exp = demands[j]
                got = float(delivered.get(j, 0.0))
                ratio = got / exp if exp > 0 else 1.0
                if math.isfinite(ratio):
                    deficit[j] += exp * max(0.0, 1.0 - ratio)
    worst = max(deficit.values()) if deficit else 0.0
    if worst <= 0:
        return {}
    return {j: max(1, min(10, 10 - round(9 * d / worst))) for j, d in deficit.items()}


def _bundleAC_profiles(wn, demands):
    """Shared drill for A and C (identical) — run the sim once."""
    prof = link_flow_profiles(wn, demands, contingency_samples=20,
                              contingency_exhaustive_trunk=True, contingency_multiplier=1.0)
    prio = contingency_priorities(wn, demands)
    return prof, prio


def _build_from(wn, demands, name, prof, prio):
    return build_bundle(wn, name=name, options=ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS),
                        flow_profiles=prof, priorities=prio)


def _uniform_override(bundle, wn):
    """Method C: overwrite every PIPE-derived edge's capacity with the
    design-velocity formula area x UNIFORM_VELOCITY, keeping the sim-derived
    orientation/duplex structure and priorities untouched (pumps/valves keep
    their curve/geometry capacity)."""
    diam = {pid: wn.get_link(pid).diameter for pid in wn.pipe_name_list}
    pipes = set(wn.pipe_name_list)
    for eid, edge in bundle.project.edges.items():
        base = eid[2:] if eid.startswith("e_") else eid
        for suf in ("__fwd", "__rev", "__in", "__out"):
            if base.endswith(suf):
                base = base[: -len(suf)]
        if base in pipes:
            d = diam[base]
            edge.capacity = math.pi / 4.0 * d * d * UNIFORM_VELOCITY * FLOW_UNIT_SCALE
    return bundle


def _bundle_B(wn, demands, name, cand):
    sweep = link_flow_profiles(wn, demands, contingency_samples=0)  # demand sweep only
    batch = _batch_capacity(wn, demands, cand)
    prio = _flowranked_single_priority(wn, demands, cand)
    return build_bundle(wn, name=name, options=ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS),
                        flow_profiles=_merge(sweep, batch), priorities=prio)


def _score(bundle, situations, wn, demands, gt_cache):
    l2e, l2n = vf._build_link_maps(bundle.project)
    conf = vf.ConfusionCounts()
    fms_by_fam = defaultdict(list)
    conf_by_fam = defaultdict(vf.ConfusionCounts)
    for s in situations:
        lt = gt_cache[s.label]
        if lt is None:
            continue
        lc = vf._cascade_levels(bundle.project, bundle.config, s, l2e, l2n, demands)
        fms, _ = vf._fms(lt, lc, demands, N_LEVELS)
        c = vf._binary_confusion(lt, lc, demands)
        conf += c
        fam = s.label.split("#")[0]
        fms_by_fam[fam].append(fms)
        conf_by_fam[fam] += c
    return conf, fms_by_fam, conf_by_fam


def analyse(path, cap=12, seed=1):
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    flows = _nominal_flows(wn, demands)
    cand = _candidates(wn, flows)
    print(f"\n=== {name} | {len(cand)} candidates | cap {cap}/family ===")

    graph = vf._build_link_graph(wn)
    sits = (vf._cluster_situations(wn, graph, seed)[:cap] + vf._targeted_situations(wn)[:cap]
            + vf._tank_situations(wn)[:cap] + vf._source_situations(wn)[:cap])

    # ground truth once per situation
    gt = {}
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        gt[s.label] = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()} if ratios else None
    sits = [s for s in sits if gt[s.label] is not None]
    print(f"  {len(sits)} situations with valid ground truth")

    prof_ac, prio_ac = _bundleAC_profiles(wn, demands)
    bA = _build_from(wn, demands, name, prof_ac, prio_ac)
    bC = _uniform_override(_build_from(wn, demands, name, prof_ac, prio_ac), wn)
    bB = _bundle_B(wn, demands, name, cand)
    cA, fA, cfA = _score(bA, sits, wn, demands, gt)
    cB, fB, cfB = _score(bB, sits, wn, demands, gt)
    cC, fC, cfC = _score(bC, sits, wn, demands, gt)

    def line(tag, c, fbyfam):
        allf = [x for v in fbyfam.values() for x in v]
        fms = statistics.mean(allf) if allf else float("nan")
        print(f"  {tag:22s} FMS={fms:.3f}  P={c.precision:.3f} R={c.recall:.3f} F1={c.f1:.3f}  "
              f"(TP={c.tp} FP={c.fp} FN={c.fn})")
    print("  --- overall ---")
    line("A production drill", cA, fA)
    line("B redesign (batch)", cB, fB)
    line("C uniform 2.5 m/s", cC, fC)
    print("  --- per family (FMS | prec / rec) ---")
    for fam in ("cluster", "targeted", "tank", "source"):
        if fam in fA or fam in fB or fam in fC:
            def cell(fbf, cbf):
                f = statistics.mean(fbf[fam]) if fbf[fam] else float("nan")
                c = cbf[fam]
                return f"{f:.3f} {c.precision:.2f}/{c.recall:.2f}"
            print(f"    {fam:9s} A: {cell(fA, cfA)}   B: {cell(fB, cfB)}   C: {cell(fC, cfC)}")


NETWORKS = ["../raw-networks/aqueducts/Net3.inp", "../raw-networks/aqueducts/CTown.inp"]

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.isdigit()]
    for p in args or NETWORKS:
        analyse(p)
