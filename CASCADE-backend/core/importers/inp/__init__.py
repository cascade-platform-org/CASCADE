"""
core/importers/inp/ — EPANET .inp water-network importer (ADR-0012).

Pipeline: parse (parse.py) → hydraulic priority sweep + flow-direction/
velocity sweep (sim.py) → skeletonize (skeleton.py) → orient/map (map.py) →
place (geo.py). See map.py's module docstring for the full mapping rules.

Re-exports the public surface so callers can do
`from core.importers.inp import build_bundle, load_inp, ...` instead of
reaching into each submodule individually.
"""

from core.importers.inp.geo import GeoTransformError, PlacementResult, place_nodes
from core.importers.inp.map import (
    BLACKOUT_EVENT_ID,
    BLACKOUT_REPAIR_HOURS,
    DEFAULT_N_LEVELS,
    FLOW_UNIT_SCALE,
    TANK_RESERVE_EVENT_ID,
    UNBOUNDED_SUPPLY_FALLBACK,
    DemandMode,
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    generate_scale,
)
from core.importers.inp.parse import InpParseError, load_inp
from core.importers.inp.sim import (
    DECISIVE_VELOCITY_MS,
    FALLBACK_VELOCITY_MS,
    NEGLIGIBLE_VELOCITY_MS,
    LinkFlowProfile,
    link_flow_profiles,
    contingency_priorities,
    scarcity_priorities,
    transfer_priorities,
)
from core.importers.inp.skeleton import SkeletonError, skeletonize_to_target

__all__ = [
    "GeoTransformError",
    "PlacementResult",
    "place_nodes",
    "BLACKOUT_EVENT_ID",
    "BLACKOUT_REPAIR_HOURS",
    "DEFAULT_N_LEVELS",
    "FLOW_UNIT_SCALE",
    "TANK_RESERVE_EVENT_ID",
    "UNBOUNDED_SUPPLY_FALLBACK",
    "DemandMode",
    "ImportOptions",
    "build_bundle",
    "compute_junction_demands",
    "generate_scale",
    "InpParseError",
    "load_inp",
    "DECISIVE_VELOCITY_MS",
    "FALLBACK_VELOCITY_MS",
    "NEGLIGIBLE_VELOCITY_MS",
    "LinkFlowProfile",
    "link_flow_profiles",
    "contingency_priorities",
    "scarcity_priorities",
    "transfer_priorities",
    "SkeletonError",
    "skeletonize_to_target",
]
