"use client";

/**
 * geo-map-background.tsx — MapLibre map as a background layer behind React Flow.
 *
 * Two modes:
 *   SETUP  (geo_anchor absent): fully interactive map (drag/scroll like OSM).
 *   SYNCED (geo_anchor present): interaction disabled, map follows RF viewport.
 *
 * Sync strategy — CSS transform, NOT map.jumpTo() on every viewport change:
 *
 *   map.jumpTo() updates MapLibre's camera state synchronously, but the WebGL
 *   canvas only redraws on the NEXT requestAnimationFrame. Even with
 *   useSyncExternalStore, React flushes SyncLane at the event-handler boundary
 *   (not inside store.setState). useLayoutEffect therefore fires AFTER the event
 *   handler returns, and jumpTo's rAF fires in the NEXT frame — 1 frame behind
 *   React's CSS transform on .react-flow__viewport.
 *
 *   Fix: apply a CSS transform to the map container div in useLayoutEffect.
 *   The GPU compositor applies it in the same compositing pass as React Flow's
 *   own .react-flow__viewport transform. No rAF, no lag, zero shimmer.
 *
 *   map.jumpTo() is still called — but only when panning stops (onEnd), to
 *   reload sharp tiles for the current viewport. The CSS transform bridges the
 *   gap between quality refreshes.
 *
 *   Why v3 (CSS transform) broke: anchor.flow was the node centroid, which
 *   puts anchor.geo far from the RF viewport center, producing large tx values
 *   that slide the map container off-screen. Fix: anchor.flow is always the
 *   RF viewport center at anchor-set time, guaranteeing tx=0 at that moment.
 *
 *   visualBase: the flow position shown at the map center after the last
 *   completed tile reload. Updated ONLY inside map.once('render') — never
 *   immediately after jumpTo. Default (until first reload) = anchor.flow,
 *   which is the RF viewport center → initial tx = 0.
 *
 * Debug overlay: add ?geoDebug=1 to the URL.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useOnViewportChange, useReactFlow, useViewport } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvas-store";
import { computeMapTarget } from "@/lib/geo-utils";
import type { GeoAnchor } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Tile style catalogue
// ---------------------------------------------------------------------------

const TILE_STYLES: Record<string, string> = {
  liberty:  "https://tiles.openfreemap.org/styles/liberty",
  bright:   "https://tiles.openfreemap.org/styles/bright",
  positron: "https://tiles.openfreemap.org/styles/positron",
};

const STYLE_OPTIONS = [
  { id: "liberty",  label: "Liberty" },
  { id: "bright",   label: "Bright" },
  { id: "positron", label: "Positron" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enableMapInteraction(map: maplibregl.Map) {
  map.dragPan.enable();
  map.scrollZoom.enable();
  map.doubleClickZoom.enable();
  map.dragRotate.enable();
  map.keyboard.enable();
  map.touchZoomRotate.enable();
}

function disableMapInteraction(map: maplibregl.Map) {
  map.dragPan.disable();
  map.scrollZoom.disable();
  map.doubleClickZoom.disable();
  map.dragRotate.disable();
  map.keyboard.disable();
  map.touchZoomRotate.disable();
}

type VisualBase = { flowCX: number; flowCY: number; rfZoom: number };

/**
 * Apply CSS transform to `el` so that the map container — which currently
 * renders flow position (vb.flowCX, vb.flowCY) at its screen centre — is
 * repositioned to match the current RF viewport.
 *
 * transform-origin: center (50% 50%)
 *   → scale(s) keeps the element centre fixed, then translate(tx, ty) moves it
 *   → element centre ends up at the screen position of (vb.flowCX, vb.flowCY)
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
  const s  = rfZoom / vb.rfZoom;
  el.style.transform       = `translate(${tx}px, ${ty}px) scale(${s})`;
  el.style.transformOrigin = "center";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GeoMapBackgroundProps {
  canvasId: string;
}

export function GeoMapBackground({ canvasId }: GeoMapBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [debugMode] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("geoDebug") === "1",
  );
  const [debugInfo, setDebugInfo] = useState("");
  const syncCountRef = useRef(0);

  const canvas           = useCanvasStore((s) => s.canvases[canvasId]);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);

  const geoAnchor  = canvas?.geo_anchor ?? null;
  const tileStyleId = canvas?.map_style ?? "liberty";
  const isSetup    = !geoAnchor;

  const { getViewport } = useReactFlow();
  const { x: vpX, y: vpY, zoom: rfZoom } = useViewport();

  // Stable refs for use inside async callbacks.
  const geoAnchorRef = useRef(geoAnchor);
  geoAnchorRef.current = geoAnchor;
  const mapReadyRef = useRef(mapReady);
  mapReadyRef.current = mapReady;
  const rfVpRef = useRef({ x: vpX, y: vpY, zoom: rfZoom });
  rfVpRef.current = { x: vpX, y: vpY, zoom: rfZoom };

  // The flow position shown at the map centre after the last completed tile
  // reload. Updated ONLY inside map.once('render'). Default = anchor.flow,
  // which equals the RF viewport centre at anchor-set time → initial tx = 0.
  const visualBase  = useRef<VisualBase | null>(null);
  // Cancellation token — incremented per reload to discard stale callbacks.
  const reloadGenRef = useRef(0);

  // Cached container dimensions. Reading offsetWidth/offsetHeight forces a
  // synchronous layout reflow; doing it every pan frame is what makes panning
  // janky. A ResizeObserver keeps these current without touching the DOM in
  // the hot path, so the per-frame effect only WRITES style.transform.
  const dimsRef = useRef({ W: 0, H: 0 });

  // ── CSS transform sync (before-paint, zero visual lag) ────────────────────
  useLayoutEffect(() => {
    const anchor = geoAnchorRef.current;
    const el     = containerRef.current;
    if (!el || !anchor) {
      if (el) el.style.transform = "";
      return;
    }
    // Default base: anchor.flow == RF viewport centre at anchor time → tx = 0.
    const vb = visualBase.current ?? {
      flowCX: anchor.flow.x,
      flowCY: anchor.flow.y,
      rfZoom: anchor.rf_zoom,
    };
    // Use cached dims — no offsetWidth read in the hot path, so this effect is
    // a pure compositor write and the pan stays fluid.
    const { W, H } = dimsRef.current;
    applyCssTransform(el, vb, vpX, vpY, rfZoom, W, H);

    if (debugMode) {
      syncCountRef.current += 1;
      const map = mapRef.current;
      const target = map ? computeMapTarget({ x: vpX, y: vpY, zoom: rfZoom }, anchor, W, H) : null;
      const actual = map?.getCenter();
      setDebugInfo(
        `css-syncs:${syncCountRef.current} | ` +
          `vb=(${vb.flowCX.toFixed(1)},${vb.flowCY.toFixed(1)} z=${vb.rfZoom.toFixed(2)}) | ` +
          `tx=${(vb.flowCX * rfZoom + vpX - W / 2).toFixed(1)} ` +
          `ty=${(vb.flowCY * rfZoom + vpY - H / 2).toFixed(1)} ` +
          `s=${(rfZoom / vb.rfZoom).toFixed(3)}` +
          (target && actual
            ? ` | Δlng=${(actual.lng - target.cLng).toFixed(7)}`
            : ""),
      );
    }
  }, [vpX, vpY, rfZoom, debugMode]);

  // ── Quality refresh (onEnd) ────────────────────────────────────────────────
  // Reloads sharp tiles for the current viewport. visualBase is updated only
  // inside map.once('render'), after WebGL has actually drawn the new tiles.
  //
  // SEAMLESS re-base: the jump target is computed via map.unproject — MapLibre's
  // OWN Web Mercator projection — NOT our linear formula. We find the screen
  // point the CSS transform currently maps to the viewport centre, ask the map
  // what geo is really there, and jump exactly to it. Because the same
  // projection that drew the tiles also picks the target, the tiles don't shift
  // relative to the graph when the CSS transform resets. No flat-earth error.
  const doQualityRefresh = useCallback(
    (vp: { x: number; y: number; zoom: number }) => {
      const map    = mapRef.current;
      const anchor = geoAnchorRef.current;
      const el     = containerRef.current;
      if (!map || !anchor || !el || !mapReadyRef.current) return;
      const { W, H } = dimsRef.current;
      if (W === 0 || H === 0) return;

      // Current CSS transform (built from the active base + this end viewport).
      const vbOld = visualBase.current ?? {
        flowCX: anchor.flow.x,
        flowCY: anchor.flow.y,
        rfZoom: anchor.rf_zoom,
      };
      const sOld  = vp.zoom / vbOld.rfZoom;
      const txOld = vbOld.flowCX * vp.zoom + vp.x - W / 2;
      const tyOld = vbOld.flowCY * vp.zoom + vp.y - H / 2;

      // Pre-transform screen point that the transform maps to the viewport
      // centre (W/2, H/2). Inverting translate+scale about transform-origin
      // centre: p = c - t / s.
      const px = W / 2 - txOld / sOld;
      const py = H / 2 - tyOld / sOld;

      // Ask the map (current camera) what geo is actually there — exact Mercator.
      const geoCenter = map.unproject([px, py]);
      const mlZoom    = anchor.ml_zoom + Math.log2(vp.zoom / anchor.rf_zoom);
      map.jumpTo({ center: geoCenter, zoom: mlZoom });

      reloadGenRef.current += 1;
      const thisGen = reloadGenRef.current;

      // The new base: after this reload completes, the map centre shows the
      // flow position corresponding to the RF viewport centre at `vp`.
      const newBase: VisualBase = {
        flowCX: (W / 2 - vp.x) / vp.zoom,
        flowCY: (H / 2 - vp.y) / vp.zoom,
        rfZoom: vp.zoom,
      };

      map.once("render", () => {
        if (thisGen !== reloadGenRef.current) return;
        visualBase.current = newBase;
        // Apply CSS transform for whatever the RF viewport is NOW (user may
        // have panned slightly since onEnd fired). Re-read dims — the container
        // may have resized between jumpTo and this async render callback.
        const el2 = containerRef.current;
        if (!el2) return;
        const v = rfVpRef.current;
        applyCssTransform(el2, newBase, v.x, v.y, v.zoom, dimsRef.current.W, dimsRef.current.H);
      });
    },
    [],
  );

  useOnViewportChange({ onEnd: doQualityRefresh });

  // ── MapLibre initialisation ────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const styleUrl   = TILE_STYLES[tileStyleId] ?? TILE_STYLES.liberty;
    const savedCenter = canvas?.map_center;
    const savedZoom  = canvas?.map_zoom ?? 5;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: savedCenter ? [savedCenter.lng, savedCenter.lat] : [12.5, 44.0],
      zoom: savedZoom,
      interactive: false,
      // Pre-load tiles 2 widths outside the viewport on each side.
      maxTileCacheSize: 400,
    });

    map.on("load", () => { setMapReady(true); map.resize(); });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      visualBase.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (mapReady) mapRef.current?.resize();
  }, [mapReady]);

  // Keep cached dims current via ResizeObserver — never read offsetWidth in the
  // per-frame sync. Seed immediately and re-apply the transform on resize so
  // the map doesn't drift when the container changes size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      dimsRef.current = { W: el.offsetWidth, H: el.offsetHeight };
      const anchor = geoAnchorRef.current;
      if (!anchor) return;
      const vb = visualBase.current ?? {
        flowCX: anchor.flow.x,
        flowCY: anchor.flow.y,
        rfZoom: anchor.rf_zoom,
      };
      const v = rfVpRef.current;
      applyCssTransform(el, vb, v.x, v.y, v.zoom, dimsRef.current.W, dimsRef.current.H);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (isSetup) enableMapInteraction(mapRef.current);
    else         disableMapInteraction(mapRef.current);
  }, [isSetup, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    // Invalidate any pending quality-refresh render callback: a style swap
    // fires its own 'render' events, which must not be mistaken for the tile
    // reload a doQualityRefresh was waiting on.
    reloadGenRef.current += 1;
    mapRef.current.setStyle(TILE_STYLES[tileStyleId] ?? TILE_STYLES.liberty);
  }, [tileStyleId, mapReady]);

  // Clear the cached visual base whenever the anchor is cleared — including
  // resets that bypass handleResetAnchor (e.g. the inspector's reset button) —
  // so a stale base can't leak into the next anchor.
  useEffect(() => {
    if (!geoAnchor) visualBase.current = null;
  }, [geoAnchor]);

  // Initial quality refresh when anchor is set or map finishes loading.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !geoAnchor) return;
    visualBase.current = null;
    doQualityRefresh(getViewport());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoAnchor, mapReady]);

  // ── Set / reset anchor ─────────────────────────────────────────────────────
  // anchor.flow = RF viewport centre at anchor-set time.
  // This guarantees tx = 0 at anchor time (map stays exactly where it was in
  // setup mode — no jump). anchor.geo = MapLibre map centre at that moment.
  function handleSetAnchor() {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const mlCenter = map.getCenter();
    const mlZoom   = map.getZoom();
    const rfVp     = getViewport();
    const el       = containerRef.current;
    const W        = el?.offsetWidth  ?? 800;
    const H        = el?.offsetHeight ?? 600;

    const anchor: GeoAnchor = {
      flow: { x: (W / 2 - rfVp.x) / rfVp.zoom, y: (H / 2 - rfVp.y) / rfVp.zoom },
      geo:  { lng: mlCenter.lng, lat: mlCenter.lat },
      rf_zoom: rfVp.zoom,
      ml_zoom: mlZoom,
    };
    visualBase.current = null;
    updateCanvasMeta(canvasId, {
      geo_anchor: anchor,
      map_center: { lng: mlCenter.lng, lat: mlCenter.lat },
      map_zoom:   mlZoom,
    });
  }

  function handleResetAnchor() {
    const map = mapRef.current;
    visualBase.current = null;
    if (map) {
      const c = map.getCenter();
      updateCanvasMeta(canvasId, {
        geo_anchor: null,
        map_center: { lng: c.lng, lat: c.lat },
        map_zoom:   map.getZoom(),
      });
    } else {
      updateCanvasMeta(canvasId, { geo_anchor: null });
    }
  }

  // ── Anchor crosshair (screen-space) ───────────────────────────────────────
  const anchorScreenX = geoAnchor ? geoAnchor.flow.x * rfZoom + vpX : null;
  const anchorScreenY = geoAnchor ? geoAnchor.flow.y * rfZoom + vpY : null;

  // ── Map container ──────────────────────────────────────────────────────────
  const mapContainer = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: isSetup ? 5 : 0,
        pointerEvents: isSetup ? "auto" : "none",
      }}
    >
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0, willChange: "transform" }}
      />
    </div>
  );

  // ── Setup mode ─────────────────────────────────────────────────────────────
  if (isSetup) {
    return (
      <>
        {mapContainer}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            pointerEvents: "auto",
          }}
        >
          <div
            className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-800/95"
            style={{ minWidth: 340 }}
          >
            <div className="flex-1">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                Navigate to your network area
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Drag to pan · Scroll to zoom · Then set the anchor
              </p>
            </div>
            <select
              value={tileStyleId}
              onChange={(e) => updateCanvasMeta(canvasId, { map_style: e.target.value })}
              className="shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
            >
              {STYLE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <button
              onClick={handleSetAnchor}
              disabled={!mapReady}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Set anchor
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Synced mode ────────────────────────────────────────────────────────────
  return (
    <>
      {mapContainer}

      {/* Anchor crosshair — marks the anchor correspondence point */}
      {anchorScreenX !== null && anchorScreenY !== null && (
        <div
          style={{
            position: "absolute",
            left: anchorScreenX,
            top: anchorScreenY,
            transform: "translate(-50%, -50%)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <line x1="12" y1="2" x2="12" y2="22" stroke="#ef4444" strokeWidth="2" />
            <line x1="2" y1="12" x2="22" y2="12" stroke="#ef4444" strokeWidth="2" />
            <circle cx="12" cy="12" r="3" fill="#ef4444" />
          </svg>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          bottom: 56,
          right: 10,
          zIndex: 20,
          pointerEvents: "auto",
        }}
      >
        <button
          onClick={handleResetAnchor}
          title="Reset geo anchor — re-enter setup mode"
          className="rounded bg-white/90 px-2.5 py-1 text-xs text-zinc-600 shadow hover:bg-white dark:bg-zinc-800/90 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset anchor
        </button>
      </div>

      {/* Debug panel — ?geoDebug=1 */}
      {debugMode && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            zIndex: 30,
            pointerEvents: "none",
            fontFamily: "monospace",
            fontSize: 11,
            lineHeight: 1.6,
            background: "rgba(0,0,0,0.80)",
            color: "#0f0",
            padding: "8px 10px",
            borderRadius: 6,
            maxWidth: 560,
            whiteSpace: "pre",
          }}
        >
          <span style={{ color: "#ff0", fontWeight: "bold" }}>GeoSync v5 — CSS transform (GPU compositor){"\n"}</span>
          {debugInfo}
          {"\n"}
          <span style={{ color: "#aaa" }}>tx/ty/s = CSS transform values · Δlng = map centre error (should be ~0 after reload)</span>
        </div>
      )}
    </>
  );
}
