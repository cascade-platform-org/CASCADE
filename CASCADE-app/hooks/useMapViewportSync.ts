"use client";

/**
 * useMapViewportSync — keeps a MapLibre background locked to the React Flow
 * viewport for a georeferenced Canvas.
 *
 * This is the seam that used to be tangled inside GeoMapBackground. The whole
 * sync mechanism (fluid per-frame tracking, the on-stop tile reload, the
 * generation-counter that discards stale renders, the cached container dims)
 * lives behind one interface: give it the map, the container, the GeoAnchor,
 * and whether the map is ready — it does the rest.
 *
 * Why CSS transform instead of map.jumpTo() every frame:
 *   jumpTo redraws on the next requestAnimationFrame — one frame behind React
 *   Flow's own viewport transform, so panning shimmers. Instead we mirror React
 *   Flow's transform onto the map container every frame (GPU compositor, zero
 *   lag) and only call jumpTo when the gesture ends, to reload sharp tiles.
 *
 * Why the re-base is seamless:
 *   computeMapTarget (the GeoAnchor projection) is exact Web Mercator, so the
 *   jump lands exactly where the CSS-transformed tiles already are. No drift.
 *
 * Returns { invalidate } — call it before swapping the map style, so a pending
 * tile-reload render callback isn't confused by the style's own render events.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
// maplibre-gl 6 dropped its default export — see geo-map-background.tsx.
import type * as maplibregl from "maplibre-gl";
import { useOnViewportChange, useReactFlow, useViewport } from "@xyflow/react";
import { computeMapTarget } from "@/lib/geo-utils";
import type { GeoAnchor } from "@/lib/schemas/network";

type VisualBase = { flowCX: number; flowCY: number; rfZoom: number };

/**
 * Mirror React Flow's viewport transform onto the map container. The container
 * currently shows flow position (vb.flowCX, vb.flowCY) at its centre; this
 * shifts/scales it to sit under the live viewport. Pure compositor write — no
 * DOM reads — so it stays fluid. transform-origin: center.
 */
function applyCssTransform(
  el: HTMLElement,
  vb: VisualBase,
  vpX: number,
  vpY: number,
  rfZoom: number,
  W: number,
  H: number,
) {
  if (W === 0 || H === 0) return;
  const tx = vb.flowCX * rfZoom + vpX - W / 2;
  const ty = vb.flowCY * rfZoom + vpY - H / 2;
  const s = rfZoom / vb.rfZoom;
  el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  el.style.transformOrigin = "center";
}

interface MapViewportSyncParams {
  mapRef: RefObject<maplibregl.Map | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  anchor: GeoAnchor | null;
  mapReady: boolean;
  /** Optional debug sink — receives a one-line status string each frame. */
  onDebug?: (info: string) => void;
}

export function useMapViewportSync({
  mapRef,
  containerRef,
  anchor,
  mapReady,
  onDebug,
}: MapViewportSyncParams): { invalidate: () => void } {
  const { getViewport } = useReactFlow();
  const { x: vpX, y: vpY, zoom: rfZoom } = useViewport();

  // Stable refs for use inside async / non-reactive callbacks.
  const anchorRef = useRef(anchor);
  const mapReadyRef = useRef(mapReady);
  const rfVpRef = useRef({ x: vpX, y: vpY, zoom: rfZoom });
  const onDebugRef = useRef(onDebug);
  // Latest-value refs, written after render (not during — React forbids render
  // writes). useLayoutEffect keeps them fresh before the browser paints, so
  // the per-frame sync loop and map callbacks always read current values.
  useLayoutEffect(() => {
    anchorRef.current = anchor;
    mapReadyRef.current = mapReady;
    rfVpRef.current = { x: vpX, y: vpY, zoom: rfZoom };
    onDebugRef.current = onDebug;
  });

  // Flow position shown at the map centre after the last completed tile reload.
  // Updated only inside map.once('render'). Default = anchor.flow (the RF
  // viewport centre at anchor time → tx = 0).
  const visualBase = useRef<VisualBase | null>(null);
  // Generation token — bumped per reload (and on invalidate) so stale render
  // callbacks are discarded.
  const reloadGenRef = useRef(0);
  // Cached container dims — never read offsetWidth in the per-frame hot path.
  const dimsRef = useRef({ W: 0, H: 0 });
  const syncCountRef = useRef(0);

  const baseFor = useCallback(
    (a: GeoAnchor): VisualBase =>
      visualBase.current ?? { flowCX: a.flow.x, flowCY: a.flow.y, rfZoom: a.rf_zoom },
    [],
  );

  const invalidate = useCallback(() => {
    reloadGenRef.current += 1;
  }, []);

  // ── Per-frame transform mirror (before paint, zero lag) ───────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    const a = anchorRef.current;
    if (!el || !a) {
      if (el) el.style.transform = "";
      return;
    }
    const vb = baseFor(a);
    const { W, H } = dimsRef.current;
    applyCssTransform(el, vb, vpX, vpY, rfZoom, W, H);

    if (onDebugRef.current) {
      syncCountRef.current += 1;
      const map = mapRef.current;
      const target = map ? computeMapTarget({ x: vpX, y: vpY, zoom: rfZoom }, a, W, H) : null;
      const actual = map?.getCenter();
      onDebugRef.current(
        `syncs:${syncCountRef.current} | ` +
          `vb=(${vb.flowCX.toFixed(1)},${vb.flowCY.toFixed(1)} z=${vb.rfZoom.toFixed(2)}) | ` +
          `tx=${(vb.flowCX * rfZoom + vpX - W / 2).toFixed(1)} ` +
          `ty=${(vb.flowCY * rfZoom + vpY - H / 2).toFixed(1)} ` +
          `s=${(rfZoom / vb.rfZoom).toFixed(3)}` +
          (target && actual ? ` | Δlng=${(actual.lng - target.cLng).toFixed(7)}` : ""),
      );
    }
  }, [vpX, vpY, rfZoom, mapReady, anchor, containerRef, mapRef, baseFor]);

  // ── Quality refresh on gesture end — reload sharp tiles ───────────────────
  // Seamless because computeMapTarget is exact Mercator: the jump lands exactly
  // where the CSS-transformed tiles already are.
  const doQualityRefresh = useCallback(
    (vp: { x: number; y: number; zoom: number }) => {
      const map = mapRef.current;
      const a = anchorRef.current;
      const el = containerRef.current;
      if (!map || !a || !el || !mapReadyRef.current) return;
      const { W, H } = dimsRef.current;
      if (W === 0 || H === 0) return;

      const { cLng, cLat, mlZoom } = computeMapTarget(vp, a, W, H);
      map.jumpTo({ center: [cLng, cLat], zoom: mlZoom });

      reloadGenRef.current += 1;
      const thisGen = reloadGenRef.current;
      const newBase: VisualBase = {
        flowCX: (W / 2 - vp.x) / vp.zoom,
        flowCY: (H / 2 - vp.y) / vp.zoom,
        rfZoom: vp.zoom,
      };

      map.once("render", () => {
        if (thisGen !== reloadGenRef.current) return; // superseded or invalidated
        visualBase.current = newBase;
        const el2 = containerRef.current;
        if (!el2) return;
        const v = rfVpRef.current;
        applyCssTransform(el2, newBase, v.x, v.y, v.zoom, dimsRef.current.W, dimsRef.current.H);
      });
    },
    [mapRef, containerRef],
  );

  useOnViewportChange({ onEnd: doQualityRefresh });

  // ── Settle refresh — the catch-all for every "first render looks wrong until
  // you pan" case. doQualityRefresh otherwise only fires on gesture end, so a
  // viewport that changes WITHOUT a gesture (initial mount, fitView / viewport
  // restore, programmatic setViewport) or a container that had zero size when
  // the initial refresh ran (the W===0 bail-out above) leaves the map on stale
  // or CSS-scaled tiles indefinitely. Trailing timer: reset on every viewport
  // change, fires once the viewport has been still for a beat. During a drag
  // the timer keeps resetting, so it never fights an active gesture; after a
  // gesture it merely re-lands on the target onEnd already reached (a same-spot
  // jumpTo is harmless).
  useEffect(() => {
    if (!mapReady || !anchor) return;
    const t = window.setTimeout(() => doQualityRefresh(rfVpRef.current), 250);
    return () => window.clearTimeout(t);
  }, [vpX, vpY, rfZoom, mapReady, anchor, doQualityRefresh]);

  // ── Cached dims via ResizeObserver — seeds immediately, re-applies on resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      dimsRef.current = { W: el.offsetWidth, H: el.offsetHeight };
      // Sync MapLibre's WebGL canvas to the new container size. Without this the
      // canvas keeps its old pixel width when the layout changes (e.g. the
      // Inspector panel opens) and overflows on top of the panel until the next
      // map render. resize() also re-renders, so the map stays in step.
      mapRef.current?.resize();
      const a = anchorRef.current;
      if (!a) return;
      const v = rfVpRef.current;
      applyCssTransform(el, baseFor(a), v.x, v.y, v.zoom, dimsRef.current.W, dimsRef.current.H);
      // A size change moves the container centre, which changes the map centre
      // computeMapTarget derives from it — re-land the map on the new target.
      // This is also the retry for the zero-size mount race: the initial
      // refresh bails on W===0, and this fires when real dims arrive.
      if (dimsRef.current.W > 0 && dimsRef.current.H > 0 && mapReadyRef.current) {
        doQualityRefresh(v);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, baseFor, mapRef, doQualityRefresh]);

  // Clear cached base whenever the anchor is cleared (including resets that
  // bypass this hook), so a stale base can't leak into the next anchor.
  useEffect(() => {
    if (!anchor) visualBase.current = null;
  }, [anchor]);

  // Initial refresh when the anchor is set or the map finishes loading.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !anchor) return;
    visualBase.current = null;
    doQualityRefresh(getViewport());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, mapReady]);

  return { invalidate };
}
