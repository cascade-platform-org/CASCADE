import type { GeoAnchor } from "@/lib/schemas/network";

/**
 * Metres of ground per flow-space pixel at the given anchor.
 * Derived from the Web Mercator ground resolution formula with cosLat correction.
 */
export function metersPerFlowPixel(anchor: GeoAnchor): number {
  const cosLat = Math.cos(anchor.geo.lat * (Math.PI / 180));
  return (anchor.rf_zoom * 156_543.03392 * cosLat) / Math.pow(2, anchor.ml_zoom);
}

/**
 * Convert a flow-space position to geographic coordinates using the anchor.
 */
export function anchorFlowToGeo(
  flow: { x: number; y: number },
  anchor: GeoAnchor,
): { lng: number; lat: number } {
  const m = metersPerFlowPixel(anchor);
  const cosLat = Math.cos(anchor.geo.lat * (Math.PI / 180));
  const dfx = flow.x - anchor.flow.x;
  const dfy = flow.y - anchor.flow.y;
  return {
    lng: anchor.geo.lng + (dfx * m) / (cosLat * 111_320),
    lat: anchor.geo.lat - (dfy * m) / 111_320,
  };
}

/**
 * Compute the MapLibre camera target (centre + zoom) for a given React Flow
 * viewport, so the geographic point at the RF viewport centre stays in sync
 * with the anchor correspondence.
 *
 * W, H are the map container pixel dimensions. The RF viewport centre in
 * flow space is (W/2 - vp.x) / vp.zoom — that flow point must sit at the map
 * centre, so its geo coordinate (via anchorFlowToGeo) is the camera centre.
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

/**
 * Convert geographic coordinates to a flow-space position using the anchor.
 * Exact inverse of anchorFlowToGeo.
 */
export function anchorGeoToFlow(
  geo: { lng: number; lat: number },
  anchor: GeoAnchor,
): { x: number; y: number } {
  const m = metersPerFlowPixel(anchor);
  const cosLat = Math.cos(anchor.geo.lat * (Math.PI / 180));
  const dLng = geo.lng - anchor.geo.lng;
  const dLat = geo.lat - anchor.geo.lat;
  return {
    x: anchor.flow.x + (dLng * cosLat * 111_320) / m,
    y: anchor.flow.y - (dLat * 111_320) / m,
  };
}
