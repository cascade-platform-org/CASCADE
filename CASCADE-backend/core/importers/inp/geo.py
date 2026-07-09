"""
core/importers/inp/geo.py — node positioning for imported EPANET networks.

Two placement regimes, decided by coordinate magnitude:

- **Projected CRS coordinates** (real aqueducts: values in the millions of
  metres) → transform to WGS84 lng/lat via pyproj, and derive React Flow
  `position` values that are *exactly consistent* with the frontend GeoAnchor
  projection (CASCADE-app/lib/geo-utils.ts): flow space ↔ Mercator world is a
  constant affine map, so we compute Mercator world coordinates here with the
  same closed form and invert the affine. The emitted GeoAnchor's zoom pair
  encodes the scale we chose, so the frontend reconstructs the identical
  projection and new nodes placed later line up with imported ones.

- **Abstract coordinates** (EPANET textbook nets: values in the tens) →
  non-georeferenced Canvas; coordinates scaled into a comfortable React Flow
  extent with the y-axis flipped (EPANET y grows up, React Flow y grows down).

The threshold between the regimes is deliberately coarse (10 000): plausible
lng/lat or drawing coordinates never reach it, projected metre coordinates
always do.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from pyproj import Transformer

from schemas.network import GeoAnchor, GeoCoords, Position

# Coordinates whose magnitude exceeds this are treated as projected metres.
PROJECTED_THRESHOLD = 10_000.0

# Target React Flow extent for the longest network axis (flow units).
FLOW_EXTENT = 1_500.0

# React Flow zoom stored in the anchor; ml_zoom is derived from the chosen
# world-per-flow-unit scale so that rf_zoom / (512 · 2^ml_zoom) reproduces it.
ANCHOR_RF_ZOOM = 1.0


class GeoTransformError(ValueError):
    """Raised when the declared source CRS cannot transform the coordinates."""


@dataclass
class PlacementResult:
    """Per-node placement plus the Canvas-level geo metadata."""

    positions: dict[str, Position]
    geo: dict[str, GeoCoords] = field(default_factory=dict)
    georeferenced: bool = False
    geo_anchor: GeoAnchor | None = None


def looks_projected(coords: dict[str, tuple[float, float]]) -> bool:
    """True when the coordinates read as projected CRS metres."""
    return any(
        max(abs(x), abs(y)) > PROJECTED_THRESHOLD for x, y in coords.values()
    )


# --- Web Mercator world coordinates (same closed form as lib/geo-utils.ts) ---

def _lnglat_to_world(lng: float, lat: float) -> tuple[float, float]:
    x = (180.0 + lng) / 360.0
    sin_lat = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)
    return x, y


def place_nodes(
    coords: dict[str, tuple[float, float]],
    source_crs: str,
) -> PlacementResult:
    """Compute `position` (+ `geo`/anchor when projected) for every node."""
    if not coords:
        return PlacementResult(positions={})
    if looks_projected(coords):
        return _place_georeferenced(coords, source_crs)
    return _place_abstract(coords)


def _place_abstract(coords: dict[str, tuple[float, float]]) -> PlacementResult:
    xs = [x for x, _ in coords.values()]
    ys = [y for _, y in coords.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
    scale = FLOW_EXTENT / span
    positions = {
        nid: Position(
            x=(x - min(xs)) * scale,
            # EPANET y grows upward; React Flow y grows downward.
            y=(max(ys) - y) * scale,
        )
        for nid, (x, y) in coords.items()
    }
    return PlacementResult(positions=positions)


def _place_georeferenced(
    coords: dict[str, tuple[float, float]],
    source_crs: str,
) -> PlacementResult:
    try:
        transformer = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    except Exception as exc:
        raise GeoTransformError(f"Unknown source CRS '{source_crs}': {exc}") from exc

    geo: dict[str, GeoCoords] = {}
    world: dict[str, tuple[float, float]] = {}
    for nid, (x, y) in coords.items():
        lng, lat = transformer.transform(x, y)
        if not (math.isfinite(lng) and math.isfinite(lat)) or abs(lat) > 89.9:
            raise GeoTransformError(
                f"CRS '{source_crs}' places node '{nid}' outside the world "
                f"(lng={lng}, lat={lat}). Wrong source CRS?"
            )
        geo[nid] = GeoCoords(lng=lng, lat=lat)
        world[nid] = _lnglat_to_world(lng, lat)

    # Constant affine map world → flow, sized so the longest axis spans
    # FLOW_EXTENT flow units. wpf = world units per flow unit.
    wxs = [w[0] for w in world.values()]
    wys = [w[1] for w in world.values()]
    world_span = max(max(wxs) - min(wxs), max(wys) - min(wys)) or 1e-9
    wpf = world_span / FLOW_EXTENT

    # World y grows southward, flow y grows downward — same sign on both axes
    # (mirrors anchorFlowToGeo in lib/geo-utils.ts).
    positions = {
        nid: Position(x=(wx - min(wxs)) / wpf, y=(wy - min(wys)) / wpf)
        for nid, (wx, wy) in world.items()
    }

    # Anchor at an arbitrary node (the first); zoom pair encodes the scale:
    # wpf = rf_zoom / (512 · 2^ml_zoom)  →  ml_zoom = log2(rf_zoom / (512·wpf)).
    anchor_id = next(iter(coords))
    ml_zoom = math.log2(ANCHOR_RF_ZOOM / (512.0 * wpf))
    anchor = GeoAnchor(
        flow=positions[anchor_id],
        geo=geo[anchor_id],
        rf_zoom=ANCHOR_RF_ZOOM,
        ml_zoom=ml_zoom,
    )
    return PlacementResult(
        positions=positions, geo=geo, georeferenced=True, geo_anchor=anchor
    )
