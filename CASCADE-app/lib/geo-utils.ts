import type { GeoAnchor } from "@/lib/schemas/network";

/**
 * geo-utils.ts — the GeoAnchor projection.
 *
 * One deep module owning the flow-space ↔ geography correspondence for a
 * georeferenced Canvas. Every caller that needs to turn a flow position into a
 * `geo` coordinate (or back), or to point the MapLibre camera, crosses this one
 * seam — so node placement and the map background can never use disagreeing
 * projections.
 *
 * The projection is EXACT Web Mercator, the same projection MapLibre uses to
 * draw tiles. The trick that makes it both exact and pure (no live map needed):
 *
 *   flow space  ↔  Mercator WORLD coordinates   is a constant affine map
 *   Mercator world  ↔  lng/lat                  is the standard closed form
 *
 * Mercator world coordinates are the normalised [0, 1] square MapLibre calls
 * MercatorCoordinate: x = (lng + 180) / 360, y derived from latitude via the
 * Gudermannian. There is NO latitude distortion in world space, so the flow↔world
 * scale is a single constant derived from the anchor. All the curvature lives in
 * the world↔lng/lat step, which is exact.
 */

// ---------------------------------------------------------------------------
// Web Mercator world coordinates (normalised [0, 1], MapLibre-compatible)
// ---------------------------------------------------------------------------

/** Convert lng/lat to normalised Mercator world coordinates (each in [0, 1]). */
function lngLatToWorld(geo: { lng: number; lat: number }): { x: number; y: number } {
  const x = (180 + geo.lng) / 360;
  const sinLat = Math.sin((geo.lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

/** Convert normalised Mercator world coordinates back to lng/lat. Exact inverse. */
function worldToLngLat(world: { x: number; y: number }): { lng: number; lat: number } {
  const lng = world.x * 360 - 180;
  const k = Math.exp((0.5 - world.y) * 4 * Math.PI);
  const lat = (Math.asin((k - 1) / (k + 1)) * 180) / Math.PI;
  return { lng, lat };
}

/**
 * World-coordinate units per flow-space unit — the constant scale of the
 * flow↔world affine map. Derived from the anchor's zoom pair:
 *   1 flow unit = rf_zoom screen px (at anchor) = rf_zoom / worldSize world units
 *   worldSize at MapLibre zoom z = 512 · 2^z
 * This value is invariant to the current viewport zoom (that is the whole point
 * of working in world space), so it depends only on the anchor.
 */
function worldPerFlowUnit(anchor: GeoAnchor): number {
  const worldSize = 512 * Math.pow(2, anchor.ml_zoom);
  return anchor.rf_zoom / worldSize;
}

// ---------------------------------------------------------------------------
// The GeoAnchor projection — flow ↔ geo
// ---------------------------------------------------------------------------

/** Convert a flow-space position to geographic coordinates using the anchor. */
export function anchorFlowToGeo(
  flow: { x: number; y: number },
  anchor: GeoAnchor,
): { lng: number; lat: number } {
  const wpf = worldPerFlowUnit(anchor);
  const anchorWorld = lngLatToWorld(anchor.geo);
  // Flow +x → world +x (east), flow +y → world +y (south). Same sign on both
  // axes because MapLibre world-y also increases southward.
  return worldToLngLat({
    x: anchorWorld.x + (flow.x - anchor.flow.x) * wpf,
    y: anchorWorld.y + (flow.y - anchor.flow.y) * wpf,
  });
}

/**
 * Compute the MapLibre camera target (centre + zoom) for a given React Flow
 * viewport, so the geographic point at the RF viewport centre sits at the map
 * centre. Because anchorFlowToGeo is exact Mercator, this target matches what
 * MapLibre itself would place there — the map background tracks the graph with
 * no drift, and the on-stop tile reload is seamless.
 *
 * W, H are the map container pixel dimensions. The RF viewport centre in flow
 * space is (W/2 - vp.x) / vp.zoom.
 */
export function computeMapTarget(
  vp: { x: number; y: number; zoom: number },
  anchor: GeoAnchor,
  W: number,
  H: number,
): { cLng: number; cLat: number; mlZoom: number } {
  const flowCX = (W / 2 - vp.x) / vp.zoom;
  const flowCY = (H / 2 - vp.y) / vp.zoom;
  const { lng, lat } = anchorFlowToGeo({ x: flowCX, y: flowCY }, anchor);
  const mlZoom = anchor.ml_zoom + Math.log2(vp.zoom / anchor.rf_zoom);
  return { cLng: lng, cLat: lat, mlZoom };
}
