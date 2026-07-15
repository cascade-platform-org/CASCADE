"use client";

/**
 * inspector/canvas-meta.tsx — Inspector panels shown when nothing is selected.
 *
 * CanvasMeta     — active Canvas metadata (label, colour, graph type, geo toggle).
 * AllCanvasesMeta — global view summary (shown when global view is active).
 */

import { useCanvasStore, selectActiveCanvas, selectOrderedCanvases } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useShallow } from "zustand/react/shallow";
import { cn, Field, TextInput, Toggle } from "./primitives";
import { CANVAS_PALETTE } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Colour palette for Canvas colour picker
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CanvasMeta — active Canvas (nothing selected)
// ---------------------------------------------------------------------------

export function CanvasMeta() {
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);
  const setGraphType = useCanvasStore((s) => s.setGraphType);
  const graphTypes = useConfigStore(useShallow((s) => s.config.graph_types));

  if (!activeCanvas) return null;

  const nodeCount = activeCanvas.graph.node_ids.length;
  const edgeCount = activeCanvas.graph.edge_ids.length;

  return (
    <div className="p-3">
      <Field label="Canvas name">
        <TextInput
          value={activeCanvas.label ?? ""}
          onChange={(v) => updateCanvasMeta(activeCanvas.id, { label: v })}
        />
      </Field>

      <Field label="Color">
        <div className="flex flex-wrap gap-1.5">
          {CANVAS_PALETTE.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => updateCanvasMeta(activeCanvas.id, { color: c })}
              className={cn(
                "h-5 w-5 rounded-full border-2 transition-transform hover:scale-110",
                activeCanvas.color === c
                  ? "scale-110 border-zinc-900 dark:border-white"
                  : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>

      <Field label="Graph type">
        <select
          value={activeCanvas.graph.graph_type ?? ""}
          onChange={(e) => setGraphType(e.target.value, activeCanvas.id)}
          className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <option value="">— none —</option>
          {graphTypes.map((gt) => (
            <option key={gt.name} value={gt.name}>
              {gt.name}
            </option>
          ))}
          {/* Reserved value, not a configured GraphTypeConfig entry — the
              backend special-cases it to run a live EPANET solve instead of
              the normal engine (services/propagation_service.py). Requires
              this canvas's source_inp_content (embedded at import time). */}
          <option value="epanet">epanet (live WNTR comparison)</option>
        </select>
      </Field>
      {activeCanvas.graph.graph_type === "epanet" && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest">
            EPANET mode
          </p>
          <p>
            Propagation on this canvas runs a live WNTR/EPANET solve against
            the original .inp file instead of the CASCADE engine. Canvas
            edits (added/removed elements, edited capacities) are not
            reflected in that solve — only breaking an imported
            pipe/pump/valve/junction below full functionality is.
          </p>
          {!activeCanvas.source_inp_content && (
            <p className="mt-1 font-medium">
              No embedded .inp source on this canvas (it predates this
              feature) — propagation will fail until you re-import it from
              its .inp file.
            </p>
          )}
        </div>
      )}

      <div className="mb-2">
        <Toggle
          value={activeCanvas.georeferenced ?? false}
          onChange={(v) => updateCanvasMeta(activeCanvas.id, { georeferenced: v })}
          label="Georeferenced canvas"
        />
      </div>

      {activeCanvas.georeferenced && (
        <div className="mb-3 rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
          {activeCanvas.geo_anchor ? (
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">Anchor set</span>
                <div className="mt-0.5 text-zinc-400">
                  {activeCanvas.geo_anchor.geo.lat.toFixed(5)}°,{" "}
                  {activeCanvas.geo_anchor.geo.lng.toFixed(5)}°
                </div>
              </div>
              <button
                onClick={() => updateCanvasMeta(activeCanvas.id, { geo_anchor: null })}
                className="shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
              >
                Reset
              </button>
            </div>
          ) : (
            <span className="text-zinc-400">
              No anchor — enable the map background to set one.
            </span>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{nodeCount}</div>
          <div className="text-xs text-zinc-400">nodes</div>
        </div>
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{edgeCount}</div>
          <div className="text-xs text-zinc-400">edges</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AllCanvasesMeta — global view (all Canvases, nothing selected)
// ---------------------------------------------------------------------------

export function AllCanvasesMeta() {
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);
  const globalViewLayout = useUiStore((s) => s.globalViewLayout);
  const setGlobalViewLayout = useUiStore((s) => s.setGlobalViewLayout);

  const totalNodes = new Set(canvases.flatMap((c) => c.graph.node_ids)).size;
  const totalEdges = new Set(canvases.flatMap((c) => c.graph.edge_ids)).size;

  return (
    <div className="p-3">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{totalNodes}</div>
          <div className="text-xs text-zinc-400">total nodes</div>
        </div>
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{totalEdges}</div>
          <div className="text-xs text-zinc-400">total edges</div>
        </div>
      </div>

      <Field label="View mode">
        <div className="flex gap-1">
          {(["merged", "grouped"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setGlobalViewLayout(mode)}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs capitalize transition-colors",
                globalViewLayout === mode
                  ? "border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-2 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Canvases
        </div>
        {canvases.map((c) => {
          const nodeCount = new Set(c.graph.node_ids.filter((id) => allNodes[id])).size;
          const edgeCount = new Set(c.graph.edge_ids.filter((id) => allEdges[id])).size;
          return (
            <div
              key={c.id}
              className="rounded-md border border-zinc-100 px-2 py-2 dark:border-zinc-800"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color ?? "#94a3b8" }}
                  />
                  <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {c.label ?? c.id}
                  </span>
                </div>
                <span className="ml-2 shrink-0 text-[11px] text-zinc-400">
                  {nodeCount}n · {edgeCount}e
                </span>
              </div>

              {/* Geo toggle only available in merged mode */}
              {globalViewLayout === "merged" && (
                <>
                  <Toggle
                    value={c.georeferenced ?? false}
                    onChange={(v) => updateCanvasMeta(c.id, { georeferenced: v })}
                    label="Georeferenced canvas"
                  />
                  {c.georeferenced && (
                    <div className="mt-1 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700">
                      {c.geo_anchor ? (
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-medium text-zinc-700 dark:text-zinc-200">
                              Anchor set
                            </span>
                            <div className="mt-0.5 text-zinc-400">
                              {c.geo_anchor.geo.lat.toFixed(5)}°,{" "}
                              {c.geo_anchor.geo.lng.toFixed(5)}°
                            </div>
                          </div>
                          <button
                            onClick={() => updateCanvasMeta(c.id, { geo_anchor: null })}
                            className="shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                          >
                            Reset
                          </button>
                        </div>
                      ) : (
                        <span className="text-zinc-400">
                          No anchor — enable the map background to set one.
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
