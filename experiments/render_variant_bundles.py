"""
experiments/render_variant_bundles.py — for each worst-situations kit, bake
the water_network_proportional and water_network_fairshare algorithm results
(algorithm_variants.py) directly into node/edge functionality and write a
loadable, georef-stripped bundle per (kit, algorithm) for screenshotting.

Sweep priority mode only (priority is confirmed irrelevant to fidelity; the
image comparison is about the allocation ALGORITHM, not priority). Baseline
("water_network") is not re-rendered here — its image is the app's own real
Propagate output already captured (2_engine.png).

Output per kit: .render.<algorithm>.json (temp, consumed and deleted by the
capture script) is NOT written here — this script writes the PERMANENT
variant result bundles kit/<algorithm>.bundle.json, which capture_variants.js
loads directly (load-only, no Propagate).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "CASCADE-backend"))

import schemas.results  # noqa: E402,F401 -- rebuilds Project's forward refs
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from algorithm_variants import run_variant  # noqa: E402

KITS_ROOT = Path(__file__).resolve().parent / "worst-situations"
NEW_ALGORITHMS = ["water_network_proportional", "water_network_fairshare"]


def strip_geo(project_dict: dict) -> None:
    for c in project_dict["canvases"]:
        for key in ("georeferenced", "geo_anchor", "map_center", "map_zoom", "map_style", "crs"):
            c.pop(key, None)


def main() -> None:
    for kit in sorted(KITS_ROOT.iterdir()):
        if not kit.is_dir():
            continue
        bundle_path = kit / "scenario.bundle.json"
        if not bundle_path.exists():
            continue
        bundle = json.loads(bundle_path.read_text())
        project = Project.model_validate(bundle["project"])
        config = ModelConfiguration.model_validate(bundle["config"])

        for algorithm in NEW_ALGORITHMS:
            proj, result = run_variant(algorithm, "sweep", project, config)
            by_id = {u.id: u.functionality for u in result.updates}
            for nid, level in by_id.items():
                if nid in proj.nodes:
                    proj.nodes[nid].functionality = level
                elif nid in proj.edges:
                    proj.edges[nid].functionality = level

            out = {
                "project": proj.model_dump(exclude_none=True),
                "config": config.model_dump(exclude_none=True),
            }
            strip_geo(out["project"])
            (kit / f"{algorithm}.bundle.json").write_text(json.dumps(out))
            print(f"{kit.name:32s} {algorithm:28s} updates={len(by_id)}")


if __name__ == "__main__":
    main()
