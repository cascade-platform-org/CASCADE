"use client";

/**
 * CanvasContextMenu — shared right-click menu for all ReactFlow canvas views.
 *
 * Must be rendered inside a ReactFlowProvider because it calls useReactFlow().
 * Both FlowCanvas and MergedViewCanvas render it; any new canvas view should too.
 */

import { useCallback } from "react";
import { useReactFlow, getNodesBounds } from "@xyflow/react";
import { Waypoints, FileCode, ImageDown, BoxSelect, Spline } from "lucide-react";
import { nanoid } from "nanoid";

import { useCanvasStore } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useHistoryStore } from "@/store/history-store";
import { useUiStore } from "@/store/ui-store";
import { pickHandles } from "@/lib/edge-routing";
import type { Edge as CascadeEdge } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasContextMenuProps {
  x: number;
  y: number;
  /** All node IDs visible in this canvas view — used for Select all nodes. */
  nodeIds: string[];
  /** All edge IDs visible in this canvas view — used for Select all edges and Edge Layout. */
  edgeIds: string[];
  /** Filename stem used for downloads (no extension). */
  filename?: string;
  onClose: () => void;
  /** Ref to the canvas wrapper div — scopes viewport querySelector to this RF instance. */
  containerRef?: React.RefObject<HTMLElement | null>;
}

// ---------------------------------------------------------------------------
// Shared menu button style
// ---------------------------------------------------------------------------

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CanvasContextMenu({
  x, y, nodeIds, edgeIds, filename = "canvas", onClose, containerRef,
}: CanvasContextMenuProps) {
  const { getNodes, getNode } = useReactFlow();

  const allEdges = useCanvasStore((s) => s.edges);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const toGraphSnapshot = useCanvasStore((s) => s.toGraphSnapshot);
  const pushToast = useUiStore((s) => s.pushToast);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);

  // --- Canvas section -------------------------------------------------------

  const applyEdgeLayout = useCallback(() => {
    onClose();
    const before = toGraphSnapshot();
    let count = 0;
    for (const eid of edgeIds) {
      const edge = allEdges[eid] as CascadeEdge | undefined;
      if (!edge) continue;
      const srcRF = getNode(edge.source);
      const tgtRF = getNode(edge.target);
      if (!srcRF || !tgtRF) continue;
      const { sourceHandle, targetHandle } = pickHandles(srcRF, tgtRF);
      updateEdge(eid, { sourceHandle, targetHandle });
      count++;
    }
    if (count > 0) {
      useHistoryStore.getState().pushUpdateEntry({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        update_type: "graph_update",
        label: "Edge layout",
        before,
        after: toGraphSnapshot(),
      });
      pushToast({ message: `Laid out ${count} edge${count !== 1 ? "s" : ""}`, variant: "success", durationMs: 3000 });
    }
  }, [edgeIds, allEdges, getNode, updateEdge, toGraphSnapshot, pushToast, onClose]);

  const selectAllNodes = useCallback(() => {
    onClose();
    useNetworkStore.getState().selectAll(nodeIds, []);
    setInspectorOpen(true);
  }, [nodeIds, onClose, setInspectorOpen]);

  const selectAllEdges = useCallback(() => {
    onClose();
    useNetworkStore.getState().selectAll([], edgeIds);
    setInspectorOpen(true);
  }, [edgeIds, onClose, setInspectorOpen]);

  // --- Export section -------------------------------------------------------

  const downloadPng = useCallback(async () => {
    onClose();
    const captureFn = useUiStore.getState().captureCanvasFn;
    if (!captureFn) return;
    const dataUrl = await captureFn();
    if (!dataUrl) {
      pushToast({ message: "Failed to capture canvas", variant: "error", durationMs: 3000 });
      return;
    }
    const link = document.createElement("a");
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
  }, [filename, pushToast, onClose]);

  const downloadSvg = useCallback(async () => {
    onClose();
    try {
      const { toSvg } = await import("html-to-image");
      const nodes = getNodes();
      const viewport =
        containerRef?.current?.querySelector<HTMLElement>(".react-flow__viewport") ??
        document.querySelector<HTMLElement>(".react-flow__viewport");
      if (!viewport || nodes.length === 0) {
        pushToast({ message: "Nothing to export", variant: "info", durationMs: 2000 });
        return;
      }
      const bounds = getNodesBounds(nodes);
      const PADDING = 48;
      const TARGET_MAX = 1600;
      const zoom = Math.min(2, Math.max(0.15, Math.min(TARGET_MAX / bounds.width, TARGET_MAX / bounds.height)));
      const captureW = Math.max(
        Math.ceil(Math.max(0, bounds.x) + bounds.width) + PADDING,
        Math.round(bounds.width * zoom + 2 * PADDING),
      );
      const captureH = Math.max(
        Math.ceil(Math.max(0, bounds.y) + bounds.height) + PADDING,
        Math.round(bounds.height * zoom + 2 * PADDING),
      );
      const dataUrl = await toSvg(viewport, {
        backgroundColor: "#f4f4f5",
        width: captureW,
        height: captureH,
        style: {
          width: `${captureW}px`,
          height: `${captureH}px`,
          transform: `translate(${PADDING - bounds.x * zoom}px, ${PADDING - bounds.y * zoom}px) scale(${zoom})`,
          transformOrigin: "0 0",
        },
      });
      const link = document.createElement("a");
      link.download = `${filename}.svg`;
      link.href = dataUrl;
      link.click();
    } catch {
      pushToast({ message: "SVG export failed — try PNG instead", variant: "error", durationMs: 3000 });
    }
  }, [getNodes, filename, pushToast, onClose]);

  // ---------------------------------------------------------------------------

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        style={{ left: x, top: y }}
      >
        <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Canvas</p>
        <MenuItem onClick={applyEdgeLayout}>
          <Waypoints size={14} className="shrink-0 text-zinc-500" />
          Edge Layout
        </MenuItem>
        <MenuItem onClick={selectAllNodes}>
          <BoxSelect size={14} className="shrink-0 text-zinc-500" />
          Select all nodes
        </MenuItem>
        <MenuItem onClick={selectAllEdges}>
          <Spline size={14} className="shrink-0 text-zinc-500" />
          Select all edges
        </MenuItem>
        <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
        <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Export</p>
        <MenuItem onClick={downloadSvg}>
          <FileCode size={14} className="shrink-0 text-zinc-500" />
          Download SVG
        </MenuItem>
        <MenuItem onClick={downloadPng}>
          <ImageDown size={14} className="shrink-0 text-zinc-500" />
          Download PNG
        </MenuItem>
      </div>
    </>
  );
}
