"""
experiments/priority_modes_fairshare.py — does priority derivation matter for
the NEW tiered fair-share allocation (ADR-0014)?

Earlier priority ablations (E3'/E3‴, ATTEMPTS.md §1) measured ≈0 FMS effect —
but under the priority-greedy LP, and under a harness fair-share that ignored
priority entirely. The shipped tiered_fair_share uses priority as strict
preemption tiers, so the question is genuinely open. Also tests a new,
physics-grounded derivation:

  pressure — priority from each junction's BASELINE pressure margin (one PDD
  solve at nominal demand, no failures): EPANET/PDD sheds service exactly
  where pressure drops below the required head first, so junctions with a
  thin margin are the first hydraulic casualties → low priority (the engine
  abandons them first, emulating physics), fat margin → high priority.
  Deciles over the network map to 1..10, mirroring scarcity_priorities'
  output range.

Runs the REAL engine (no monkeypatch — flow.py's tiered fair-share is the
default now) over each worst-situations kit with the kit's priorities
replaced per mode. Raw FMS (no severed-component correction): the correction
is identical across modes within a kit, so mode DELTAS are unaffected.

Run from the repo root:  python experiments/priority_modes_fairshare.py
"""
from __future__ import annotations

import copy
import csv
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "CASCADE-backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import wntr  # noqa: E402

import schemas.results  # noqa: E402,F401 -- rebuilds Project's forward refs
from core.importers.inp.map import compute_junction_demands  # noqa: E402
from engine.propagation import run as engine_run  # noqa: E402
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

from algorithm_variants import compare  # noqa: E402

KITS_ROOT = Path(__file__).resolve().parent / "worst-situations"
MODES = ["sweep", "none", "pressure"]


def _pressure_margin_priorities(inp_content: str) -> dict[str, int]:
    """inp_id -> 1..10 from one baseline PDD solve's pressure margins."""
    with tempfile.NamedTemporaryFile("w", suffix=".inp", delete=False) as f:
        f.write(inp_content)
        path = f.name
    wn = wntr.network.WaterNetworkModel(path)
    Path(path).unlink()
    demands = compute_junction_demands(wn, "peak")

    model = copy.deepcopy(wn)
    model.options.hydraulic.pattern = None  # see sim._fixed_demand_model
    for jid, demand in demands.items():
        junction = model.get_node(jid)
        junction.demand_timeseries_list.clear()
        junction.demand_timeseries_list.append((demand, None, "fixed"))
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = 20.0
    model.options.hydraulic.minimum_pressure = 0.0
    with tempfile.TemporaryDirectory(prefix="cascade-priomode-") as tmpdir:
        results = wntr.sim.EpanetSimulator(model).run_sim(
            file_prefix=str(Path(tmpdir) / "baseline")
        )
    pressures = results.node["pressure"].iloc[0]

    consumers = sorted(
        (jid for jid, d in demands.items() if d > 0),
        key=lambda jid: float(pressures.get(jid, 0.0)),
    )
    if not consumers:
        return {}
    # thin margin = first hydraulic casualty = low priority; deciles → 1..10
    return {
        jid: 1 + (9 * rank) // max(1, len(consumers) - 1)
        for rank, jid in enumerate(consumers)
    }


def _apply_mode(project: Project, mode: str) -> Project:
    proj = project.model_copy(deep=True)
    if mode == "sweep":
        return proj  # kit priorities as imported
    pressure: dict[str, int] = {}
    if mode == "pressure":
        inp = proj.canvases[0].source_inp_content
        assert inp, "kit bundle lacks embedded .inp"
        pressure = _pressure_margin_priorities(inp)
    for node in proj.nodes.values():
        profile = (node.category_dependency_profiles or {}).get("water")
        if profile is None or not profile.demand:
            continue
        if mode == "none":
            profile.priority = None
        else:
            inp_id = (node.properties or {}).get("inp_id")
            profile.priority = pressure.get(inp_id)
    return proj


def main() -> None:
    rows = []
    for kit in sorted(KITS_ROOT.iterdir()):
        bundle_path = kit / "scenario.bundle.json"
        epanet_path = kit / "epanet_result.json"
        if not kit.is_dir() or not bundle_path.exists():
            continue
        bundle = json.loads(bundle_path.read_text())
        project = Project.model_validate(bundle["project"])
        config = ModelConfiguration.model_validate(bundle["config"])
        epanet_levels = json.loads(epanet_path.read_text())["levels"]

        for mode in MODES:
            proj = _apply_mode(project, mode)
            result = engine_run(PropagationRequest(project=proj, config=config, scope="global"))
            fms, pess, opt, matched = compare(result, proj, epanet_levels)
            rows.append({"kit": kit.name, "mode": mode, "fms": round(fms, 4),
                         "too_pessimistic": pess, "too_optimistic": opt, "matched": matched})
            print(f"{kit.name:28s} prio={mode:9s} FMS={fms:.3f} pess={pess:4d} opt={opt:3d}", flush=True)

    out = Path(__file__).resolve().parent / "priority_modes_fairshare.csv"
    with out.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
