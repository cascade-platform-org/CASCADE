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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
// maplibre-gl 6 dropped its default export (named exports only) — a namespace
// import keeps every `maplibregl.X` reference in this file unchanged.
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvas-store";
import { useMapViewportSync } from "@/hooks/useMapViewportSync";
import type { GeoAnchor } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Ghost graph overlay — shows node/edge positions in setup mode
// ---------------------------------------------------------------------------

interface GhostGraphOverlayProps {
  canvasId: string;
  /** React Flow viewport — used to convert flow positions to screen positions. */
  vpX: number;
  vpY: number;
  rfZoom: number;
}

function GhostGraphOverlay({ canvasId, vpX, vpY, rfZoom }: GhostGraphOverlayProps) {
  const canvas = useCanvasStore((s) => s.canvases[canvasId]);
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);

  const nodeIds: string[] = canvas?.graph.node_ids ?? [];
  const edgeIds: string[] = canvas?.graph.edge_ids ?? [];

  // Identity keys: memos depend on the *set* of ids, not array identity.
  const nodeIdsKey = nodeIds.join(",");
  const edgeIdsKey = edgeIds.join(",");

  const nodes = useMemo(
    () => nodeIds.map((id) => allNodes[id]).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIdsKey, allNodes],
  );

  const edges = useMemo(
    () => edgeIds.map((id) => allEdges[id]).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edgeIdsKey, allEdges],
  );

  // Map from node id → screen {x, y}
  const screenPos = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      if (!n.position) continue;
      map[n.id] = {
        x: n.position.x * rfZoom + vpX,
        y: n.position.y * rfZoom + vpY,
      };
    }
    return map;
  }, [nodes, vpX, vpY, rfZoom]);

  if (nodes.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 15,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Edge lines */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
      >
        {edges.map((e) => {
          const s = screenPos[e.source];
          const t = screenPos[e.target];
          if (!s || !t) return null;
          return (
            <line
              key={e.id}
              x1={s.x} y1={s.y}
              x2={t.x} y2={t.y}
              stroke="rgba(59,130,246,0.45)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          );
        })}
      </svg>

      {/* Node dots + labels */}
      {nodes.map((n) => {
        const s = screenPos[n.id];
        if (!s) return null;
        return (
          <React.Fragment key={n.id}>
            {/* Dot centred exactly on the node's screen position */}
            <div
              style={{
                position: "absolute",
                left: s.x,
                top: s.y,
                transform: "translate(-50%, -50%)",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "rgba(59,130,246,0.75)",
                border: "1.5px solid rgba(255,255,255,0.85)",
                boxShadow: "0 0 4px rgba(0,0,0,0.3)",
              }}
            />
            {/* Label anchored just above the dot */}
            {n.label && (
              <span
                style={{
                  position: "absolute",
                  left: s.x,
                  top: s.y - 8,
                  transform: "translate(-50%, -100%)",
                  fontSize: 10,
                  fontWeight: 500,
                  color: "rgba(30,30,30,0.9)",
                  background: "rgba(255,255,255,0.8)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  whiteSpace: "nowrap",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  backdropFilter: "blur(2px)",
                }}
              >
                {n.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

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
  const [applyToAll, setApplyToAll] = useState(false);

  const canvas           = useCanvasStore((s) => s.canvases[canvasId]);
  const canvasOrder      = useCanvasStore((s) => s.canvasOrder);
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
      // Keep the last rendered frame in the WebGL buffer so html-to-image can
      // read it when the user exports PNG/SVG on a georeferenced canvas.
      canvasContextAttributes: { preserveDrawingBuffer: true },
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

    const targets = applyToAll ? canvasOrder : [canvasId];
    for (const id of targets) {
      updateCanvasMeta(id, {
        geo_anchor: anchor,
        map_center: { lng: mlCenter.lng, lat: mlCenter.lat },
        map_zoom:   mlZoom,
      });
    }
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

        {/* Ghost graph: nodes and edges at their React Flow screen positions */}
        <GhostGraphOverlay
          canvasId={canvasId}
          vpX={vpX}
          vpY={vpY}
          rfZoom={rfZoom}
        />

        {/* Center crosshair — this flow point will be tied to the map center */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 16,
            pointerEvents: "none",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <line x1="16" y1="2" x2="16" y2="30" stroke="rgba(59,130,246,0.8)" strokeWidth="1.5" />
            <line x1="2" y1="16" x2="30" y2="16" stroke="rgba(59,130,246,0.8)" strokeWidth="1.5" />
            <circle cx="16" cy="16" r="3.5" fill="rgba(59,130,246,0.9)" stroke="white" strokeWidth="1.5" />
          </svg>
        </div>

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
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-800/95"
            style={{ minWidth: 380 }}
          >
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  Navigate to your network area
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Graph preview shown · Pan &amp; zoom to position it · Set anchor to confirm
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
            {canvasOrder.length > 1 && (
              <label className="flex cursor-pointer items-center gap-2 self-end text-[11px] text-zinc-500 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-blue-600"
                />
                Apply this anchor to all canvases ({canvasOrder.length})
              </label>
            )}
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
          data-export-ignore
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
        data-export-ignore
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
          data-export-ignore
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
