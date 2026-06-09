"use client";

/**
 * geo-map-background.tsx — MapLibre map as a background layer behind React Flow.
 *
 * Two modes:
 *   SETUP  (geo_anchor absent): fully interactive map (drag/scroll like OSM).
 *   SYNCED (geo_anchor present): interaction disabled, map follows RF viewport.
 *
 * This component owns only the MapLibre lifecycle (init, style, interaction
 * toggle, resize) and the setup/synced UI. The viewport-sync machinery — the
 * per-frame CSS-transform mirror, the on-stop tile reload, the GeoAnchor
 * projection — lives behind the useMapViewportSync seam.
 *
 * Debug overlay: add ?geoDebug=1 to the URL.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvas-store";
import { useMapViewportSync } from "@/hooks/useMapViewportSync";
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

  const canvas           = useCanvasStore((s) => s.canvases[canvasId]);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);

  const geoAnchor  = canvas?.geo_anchor ?? null;
  const tileStyleId = canvas?.map_style ?? "liberty";
  const isSetup    = !geoAnchor;

  const { getViewport } = useReactFlow();
  const { x: vpX, y: vpY, zoom: rfZoom } = useViewport();

  // ── Viewport sync seam ─────────────────────────────────────────────────────
  // All the per-frame tracking, on-stop tile reload, and GeoAnchor projection
  // live behind this hook. invalidate() cancels a pending reload's render
  // callback (used before a style swap fires its own render events).
  const { invalidate } = useMapViewportSync({
    mapRef,
    containerRef,
    anchor: geoAnchor,
    mapReady,
    onDebug: debugMode ? setDebugInfo : undefined,
  });

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (mapReady) mapRef.current?.resize();
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (isSetup) enableMapInteraction(mapRef.current);
    else         disableMapInteraction(mapRef.current);
  }, [isSetup, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    // Invalidate any pending tile-reload render callback: a style swap fires its
    // own 'render' events, which must not be mistaken for that reload.
    invalidate();
    mapRef.current.setStyle(TILE_STYLES[tileStyleId] ?? TILE_STYLES.liberty);
  }, [tileStyleId, mapReady, invalidate]);

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
    updateCanvasMeta(canvasId, {
      geo_anchor: anchor,
      map_center: { lng: mlCenter.lng, lat: mlCenter.lat },
      map_zoom:   mlZoom,
    });
  }

  function handleResetAnchor() {
    const map = mapRef.current;
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
          <span style={{ color: "#ff0", fontWeight: "bold" }}>GeoSync — useMapViewportSync · exact Mercator{"\n"}</span>
          {debugInfo}
          {"\n"}
          <span style={{ color: "#aaa" }}>tx/ty/s = CSS transform values · Δlng = map centre error (should be ~0 after reload)</span>
        </div>
      )}
    </>
  );
}
