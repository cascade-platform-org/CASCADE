"use client";

/**
 * InterCanvasEdgeDialog — guides the user through connecting a node on one
 * canvas to a node on another canvas.
 *
 * Flow:
 *   1. Source is pre-selected (the node the user right-clicked or "connect" on).
 *   2. User picks the target canvas from a list of other canvases.
 *   3. User picks the target node from that canvas (searchable list).
 *   4. User optionally sets edge attributes (capacity, vulnerability levels).
 *   5. On confirm, the caller adds the InterCanvasEdge to the store.
 *
 * The dialog is intentionally stateless about the store — it calls onConfirm
 * with the two canvas/node IDs and lets the caller (canvas-manager or a hook)
 * do the actual write, so this component stays testable without store setup.
 *
 */

import { useState, useMemo } from "react";
import type { Canvas, Node } from "../../lib/schemas/network";

type Step = "target-canvas" | "target-node" | "confirm";

interface InterCanvasEdgeDialogProps {
  tailCanvas: Canvas;
  tailNode: Node;
  allCanvases: Canvas[];
  /** Global node registry — used to resolve node_ids in any Canvas. */
  nodeRegistry: Record<string, Node>;
  /** Existing inter-canvas edges — used to prevent duplicates. */
  existingEdges?: Array<{ source: string; target: string }>;
  onConfirm: (targetCanvasId: string, targetNodeId: string) => void;
  onCancel: () => void;
}

export function InterCanvasEdgeDialog({
  tailCanvas,
  tailNode,
  allCanvases,
  nodeRegistry,
  existingEdges = [],
  onConfirm,
  onCancel,
}: InterCanvasEdgeDialogProps) {
  const [step, setStep] = useState<Step>("target-canvas");
  const [targetCanvasId, setTargetCanvasId] = useState<string | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);

  const targetNode = targetNodeId ? nodeRegistry[targetNodeId] : null;

  const validationError = useMemo(() => {
    if (!targetNodeId) return null;
    if (targetNodeId === tailNode.id) return "Cannot connect a node to itself.";
    const duplicate = existingEdges.some(
      (e) =>
        (e.source === tailNode.id && e.target === targetNodeId) ||
        (e.source === targetNodeId && e.target === tailNode.id),
    );
    if (duplicate) return "An edge between these nodes already exists.";
    return null;
  }, [targetNodeId, tailNode.id, existingEdges]);

  const otherCanvases = allCanvases.filter((c) => c.id !== tailCanvas.id);

  const canAdvance =
    (step === "target-canvas" && targetCanvasId !== null) ||
    (step === "target-node" && targetNodeId !== null && validationError === null) ||
    step === "confirm";

  function advance() {
    if (step === "target-canvas") setStep("target-node");
    else if (step === "target-node") setStep("confirm");
    else if (targetCanvasId && targetNodeId) onConfirm(targetCanvasId, targetNodeId);
  }

  function retreat() {
    if (step === "target-node") setStep("target-canvas");
    else if (step === "confirm") setStep("target-node");
  }

  const stepLabels: Record<Step, string> = {
    "target-canvas": "1. Pick target canvas",
    "target-node": "2. Pick target node",
    "confirm": "3. Confirm",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        {/* Header */}
        <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Add inter-canvas edge
        </h2>
        <p className="mb-1 text-sm text-zinc-500">
          From{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {tailNode.label ?? tailNode.id}
          </span>{" "}
          on{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {tailCanvas.label ?? tailCanvas.id}
          </span>
        </p>
        <p className="mb-6 text-xs text-zinc-400">{stepLabels[step]}</p>

        {/* Step body */}
        <div className="mb-6 min-h-[120px] rounded-xl border-2 border-dashed border-zinc-200 p-4 dark:border-zinc-700">
          {step === "target-canvas" && (
            <CanvasPicker
              canvases={otherCanvases}
              selected={targetCanvasId}
              onSelect={(id) => setTargetCanvasId(id)}
            />
          )}
          {step === "target-node" && targetCanvasId && (
            <>
              <NodePicker
                canvas={allCanvases.find((c) => c.id === targetCanvasId)!}
                nodes={allCanvases
                  .find((c) => c.id === targetCanvasId)
                  ?.graph.node_ids.flatMap((id) =>
                    nodeRegistry[id] ? [nodeRegistry[id]] : [],
                  ) ?? []}
                selected={targetNodeId}
                onSelect={(id) => setTargetNodeId(id)}
              />
              {validationError && (
                <p className="mt-2 text-xs text-red-500">{validationError}</p>
              )}
            </>
          )}
          {step === "confirm" && (
            <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">From</span>
                <span>{tailNode.label ?? tailNode.id}</span>
                <span className="text-zinc-400">on</span>
                <span>{tailCanvas.label ?? tailCanvas.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">To</span>
                <span>{targetNode?.label ?? targetNodeId}</span>
                <span className="text-zinc-400">on</span>
                <span>{allCanvases.find((c) => c.id === targetCanvasId)?.label ?? targetCanvasId}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <button
            onClick={onCancel}
            className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step !== "target-canvas" && (
              <button
                onClick={retreat}
                className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700"
              >
                Back
              </button>
            )}
            <button
              disabled={!canAdvance}
              onClick={advance}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {step === "confirm" ? "Add edge" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step sub-components
// ---------------------------------------------------------------------------

function CanvasPicker({
  canvases,
  selected,
  onSelect,
}: {
  canvases: Canvas[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (canvases.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No other canvases available. Add a second canvas first.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {canvases.map((c) => (
        <li key={c.id}>
          <button
            onClick={() => onSelect(c.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              selected === c.id
                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
            }`}
          >
            {c.label ?? c.id}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NodePicker({
  canvas,
  nodes,
  selected,
  onSelect,
}: {
  canvas: Canvas;
  nodes: Node[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No nodes on canvas &ldquo;{canvas.label ?? canvas.id}&rdquo;.
      </p>
    );
  }

  const filtered = query.trim()
    ? nodes.filter((n) =>
        (n.label ?? n.id).toLowerCase().includes(query.toLowerCase()),
      )
    : nodes;

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search nodes…"
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-400">No nodes match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {filtered.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => onSelect(n.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selected === n.id
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {n.label ?? n.id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
