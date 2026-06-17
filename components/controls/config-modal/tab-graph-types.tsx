"use client";

import { useEffect } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { useShallow } from "zustand/react/shallow";
import { TextInput, ColBtn } from "./primitives";

export function TabGraphTypes() {
  const graphTypes = useConfigStore(useShallow((s) => s.draft.graph_types));
  const engineAlgorithms = useConfigStore((s) => s.engineAlgorithms);
  const engineAlgorithmsStatus = useConfigStore((s) => s.engineAlgorithmsStatus);
  const fetchEngineAlgorithms = useConfigStore((s) => s.fetchEngineAlgorithms);
  const addGraphType = useConfigStore((s) => s.addGraphType);
  const removeGraphType = useConfigStore((s) => s.removeGraphType);
  const addAlgorithm = useConfigStore((s) => s.addAlgorithm);
  const removeAlgorithm = useConfigStore((s) => s.removeAlgorithm);
  const updateAlgorithm = useConfigStore((s) => s.updateAlgorithm);

  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const setGraphType = useCanvasStore((s) => s.setGraphType);
  const globalGraphType = useCanvasStore((s) => s.projectMeta.global_graph_type);
  const setGlobalGraphType = useCanvasStore((s) => s.setGlobalGraphType);

  useEffect(() => {
    fetchEngineAlgorithms();
  }, [fetchEngineAlgorithms]);

  const availableHeuristics = engineAlgorithms?.heuristics ?? [];

  return (
    <div>
      {engineAlgorithmsStatus === "error" && (
        <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          Server unreachable — algorithm list unavailable. You can still type heuristic IDs manually.
        </div>
      )}

      {graphTypes.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No graph types defined yet.</p>
      )}

      <div className="space-y-4">
        {graphTypes.map((gt) => (
          <div key={gt.name} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between gap-2">
              <TextInput
                value={gt.name}
                onChange={() => {}}
                className="flex-1 font-semibold"
                placeholder="graph type name"
              />
              <ColBtn variant="danger" onClick={() => removeGraphType(gt.name)}>
                <Trash2 size={12} />
              </ColBtn>
            </div>

            <div className="space-y-1">
              {gt.heuristics.map((h) => (
                <div key={h.id} className="flex items-center gap-2">
                  <GripVertical size={12} className="text-zinc-300" />
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e) =>
                      updateAlgorithm(gt.name, h.id, { enabled: e.target.checked })
                    }
                    className="accent-blue-500"
                  />
                  <span className="flex-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {h.id}
                  </span>
                  <ColBtn variant="danger" onClick={() => removeAlgorithm(gt.name, h.id)}>
                    <Trash2 size={12} />
                  </ColBtn>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2">
              {availableHeuristics.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    addAlgorithm(gt.name, { id: e.target.value, enabled: true });
                  }}
                  className="flex-1 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="">+ add heuristic…</option>
                  {availableHeuristics.map((h) => (
                    <option key={h.id} value={h.id}>{h.id}</option>
                  ))}
                </select>
              ) : (
                <button
                  onClick={() =>
                    addAlgorithm(gt.name, { id: "new-heuristic", enabled: true })
                  }
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                >
                  <Plus size={10} /> Add heuristic
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => addGraphType(`graph_type_${graphTypes.length + 1}`)}
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add graph type
      </button>

      {canvases.length > 0 && (
        <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
            Canvas assignments
          </p>
          <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">
            Assign a graph type to each canvas. Changes apply immediately — they are not part of the config draft.
          </p>
          <div className="space-y-1.5">
            {canvases.map((canvas) => (
              <div key={canvas.id} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: canvas.color ?? "#71717a" }}
                />
                <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                  {canvas.label ?? canvas.id}
                </span>
                <select
                  value={canvas.graph.graph_type ?? ""}
                  onChange={(e) => setGraphType(e.target.value || "", canvas.id)}
                  className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="">— none —</option>
                  {graphTypes.map((gt) => (
                    <option key={gt.name} value={gt.name}>{gt.name}</option>
                  ))}
                </select>
              </div>
            ))}

            <div className="flex items-center gap-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
              <span className="h-2 w-2 rounded-full shrink-0 bg-zinc-400" />
              <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400 italic">
                Global view (all canvases)
              </span>
              <select
                value={globalGraphType ?? ""}
                onChange={(e) => setGlobalGraphType(e.target.value || null)}
                className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value="">— none —</option>
                {graphTypes.map((gt) => (
                  <option key={gt.name} value={gt.name}>{gt.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
