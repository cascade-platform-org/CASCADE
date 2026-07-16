"""
experiments/physical_capacity_variants.py — can pipe capacity be derived from
PHYSICAL pipe properties (diameter, roughness) instead of a simulated
velocity sweep?

First-principles motivation: the shipped capacity
(core.importers.inp.map._pipe_capacity = pi/4*d^2*v_sweep*MARGIN) needs a
WNTR hydraulic sweep at import time to get v_sweep. A pure Hazen-Williams
design-flow formula needs only diameter + roughness (both already imported,
no simulation):

    Q_HW(D, C, S) = 0.278 * C * D^2.63 * S^0.54      (SI: m, m3/s)

D = pipe diameter, C = Hazen-Williams roughness coefficient (already stored
as edge properties["roughness"]), S = allowable head-loss gradient (m
head-loss per m length) — the one free design parameter, normally chosen by
engineering convention (AWWA distribution-main practice: ~2-10 m/km).

Stage 0 (this file's main point): does Q_HW correlate with the
SIMULATED capacity CASCADE currently ships, across every pipe in the
worst-10 kits, for a range of S? If yes for some S, that S is a candidate
capacity source requiring zero simulation. If no, the sweep is doing real
work and this is a dead end — report and stop, don't waste a benchmark run
on an uncorrelated variant.

Stage 1 (only if stage 0 says yes): plug the best-correlated Q_HW(S) in as
an edge-capacity variant (replacing the sweep-derived value entirely, same
CAPACITY_MARGIN and full-duplex-split treatment) and run it through the
existing worst-10 FMS harness (algorithm_variants.run_variant/compare) to
see whether it actually helps or hurts fidelity.

Run from the repo root:
  python experiments/physical_capacity_variants.py corr        # stage 0 only
  python experiments/physical_capacity_variants.py bench 0.005  # stage 1 at S=0.005
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "CASCADE-backend"))

from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402

from algorithm_variants import compare, run_variant  # noqa: E402
from importer_variants import _recompute_supplies, _source_disconnected  # noqa: E402

KITS_ROOT = Path(__file__).resolve().parent / "worst-situations"
HW_COEFF = 0.278  # metric Hazen-Williams design-flow coefficient (Q in m3/s, D in m, S in m/m)


def _hw_flow(diameter_m: float, roughness_c: float, slope: float) -> float:
    return HW_COEFF * roughness_c * diameter_m**2.63 * slope**0.54


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


def _pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return 0.0
    return cov / math.sqrt(vx * vy)


# --- stage 0: correlation ----------------------------------------------------

def stage0_correlation() -> None:
    kits = _load_kits()
    # one row per PHYSICAL pipe (dedupe __fwd/__rev splits by inp_id — same
    # pipe, same diameter/roughness, would otherwise double-count)
    rows: dict[str, tuple[float, float, float]] = {}  # inp_id -> (D, C, shipped_capacity_summed)
    for _, project, _, _ in kits:
        totals: dict[str, float] = {}
        dc: dict[str, tuple[float, float]] = {}
        for e in project.edges.values():
            props = e.properties or {}
            if props.get("kind") != "pipe" or e.capacity is None:
                continue
            inp_id = props.get("inp_id")
            d = props.get("diameter_m")
            c = props.get("roughness")
            if not inp_id or not d or not c:
                continue
            totals[inp_id] = totals.get(inp_id, 0.0) + e.capacity
            dc[inp_id] = (d, c)
        for inp_id, cap in totals.items():
            d, c = dc[inp_id]
            rows[f"{id(project)}:{inp_id}"] = (d, c, cap)

    diam = [d for d, _, _ in rows.values()]
    rough = [c for _, c, _ in rows.values()]
    shipped = [cap for _, _, cap in rows.values()]
    log_shipped = [math.log(cap) for cap in shipped]

    print(f"pipes pooled across {len(kits)} kits: {len(rows)}")
    print(f"diameter range: {min(diam):.3f}-{max(diam):.3f} m, roughness range: {min(rough):.0f}-{max(rough):.0f}")
    print()
    print(f"{'S (m/m)':>10} {'pearson r (log-log)':>22} {'best-fit scale a (Qhw*a=~Qship)':>34}")
    for slope in (0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05):
        log_hw = [math.log(_hw_flow(d, c, slope)) for d, c in zip(diam, rough)]
        r = _pearson(log_hw, log_shipped)
        # best-fit multiplicative scale in log space: mean(log_ship - log_hw)
        a = math.exp(sum(ls - lh for ls, lh in zip(log_shipped, log_hw)) / len(log_hw))
        print(f"{slope:>10.4f} {r:>22.3f} {a:>34.3f}")
    print()
    print("Also checking whether diameter ALONE (dropping roughness/HW form) explains it:")
    log_d = [math.log(d) for d in diam]
    print(f"  pearson r(log D, log shipped_capacity) = {_pearson(log_d, log_shipped):.3f}")


# --- stage 1: benchmark the best candidate -----------------------------------

def _v_physical_hw(slope: float, scale: float):
    """Replace every pipe/valve edge's capacity with the Hazen-Williams
    design flow at head-loss gradient `slope`, scaled by `scale` (the
    stage-0 best-fit multiplier) so the two are on the same footing instead
    of comparing an uncalibrated formula to a calibrated one."""
    def apply(proj: Project) -> None:
        for e in proj.edges.values():
            props = e.properties or {}
            if props.get("kind") not in ("pipe", "valve") or e.capacity is None:
                continue
            d = props.get("diameter_m")
            c = props.get("roughness")
            if not d or not c:
                continue
            e.capacity = _hw_flow(d, c, slope) * scale
        _recompute_supplies(proj)
    return apply


def stage1_benchmark(slope: float, scale: float) -> None:
    kits = _load_kits()
    variant = _v_physical_hw(slope, scale)
    print(f"variant: Hazen-Williams @ S={slope}, scale={scale:.3f}")
    print(f"{'kit':<28} {'control FMS':>12} {'physical FMS':>14}")
    ctrl_scores, phys_scores = [], []
    for name, project, config, epanet_levels in kits:
        corrected = _source_disconnected(project)
        adj_levels = dict(epanet_levels)
        for jid in corrected:
            adj_levels[jid] = 1

        ctrl_proj = project.model_copy(deep=True)
        _, ctrl_result = run_variant("water_network_fairshare", "sweep", ctrl_proj, config)
        ctrl_fms, *_ = compare(ctrl_result, ctrl_proj, adj_levels)

        phys_proj = project.model_copy(deep=True)
        variant(phys_proj)
        _, phys_result = run_variant("water_network_fairshare", "sweep", phys_proj, config)
        phys_fms, *_ = compare(phys_result, phys_proj, adj_levels)

        ctrl_scores.append(ctrl_fms)
        phys_scores.append(phys_fms)
        print(f"{name:<28} {ctrl_fms:>12.3f} {phys_fms:>14.3f}")

    print()
    print(f"{'MEAN':<28} {sum(ctrl_scores)/len(ctrl_scores):>12.3f} {sum(phys_scores)/len(phys_scores):>14.3f}")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] == "corr":
        stage0_correlation()
    elif sys.argv[1] == "bench":
        slope = float(sys.argv[2]) if len(sys.argv) > 2 else 0.005
        scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
        stage1_benchmark(slope, scale)
    else:
        print(__doc__)
