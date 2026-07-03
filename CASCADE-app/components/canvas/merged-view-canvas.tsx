"use client";

/**
 * MergedViewCanvas — editable flat view of all canvases combined.
 *
 * All nodes from every canvas are shown at their stored positions in a single
 * ReactFlow instance. Drag, select, lasso, and Inspector work exactly as in
 * single-canvas mode. Position updates are written back to the global node
 * registry so they are reflected when switching to any individual canvas.
 *
 * Geo map background is shown when any canvas has `georeferenced = true`
 * (same mechanism as single-canvas mode — no separate global flag).
 */

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  MarkerType,
  ConnectionMode,
  useReactFlow,
  getNodesBounds,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { runWithHistory } from "@/lib/run-with-history";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { nodeTypes, toRFNode } from "./cascade-node";
import { edgeTypes } from "./cascade-edge";
import { NodeSearch } from "./node-search";
import { Lasso } from "./lasso";
import { ZoomSlider } from "./zoom-slider";
import { GeoMapBackground } from "@/components/geo/geo-map-background";
import type { Node as CascadeNode, Edge as CascadeEdge } from "@/lib/schemas/network";

const PAN_ON_DRAG_MIDDLE: number[] = [1];
import { anchorFlowToGeo } from "@/lib/geo-utils";
import { CanvasContextMenu } from "./canvas-context-menu";
import { levelColor } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRFEdge(edge: CascadeEdge, isInterCanvas: boolean): RFEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    type: "cascadeEdge",
    data: { ...edge, isInterCanvas },
  };
}

// ---------------------------------------------------------------------------
// Main component (must live inside ReactFlowProvider for useReactFlow)
// ---------------------------------------------------------------------------

function MergedViewCanvas() {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const updateNode = useCanvasStore((s) => s.updateNode);

  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const toggleNode = useNetworkStore((s) => s.toggleNode);
  const toggleEdge = useNetworkStore((s) => s.toggleEdge);
  const selectAll = useNetworkStore((s) => s.selectAll);
  const clearSelection = useNetworkStore((s) => s.clearSelection);

  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));

  const activeTool = useUiStore((s) => s.activeTool);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);

  const { getNodes, fitView } = useReactFlow();

  // Geo: show background when any canvas is georeferenced (same as single-canvas mode).
  const geoCanvasId = useMemo(
    () => canvases.find((c) => c.georeferenced)?.id ?? null,
    [canvases],
  );

  // Per-node geo anchor map — used to compute geo coords on drag.
  const geoAnchorByNodeId = useMemo(() => {
    const map = new Map<string, NonNullable<(typeof canvases)[0]["geo_anchor"]>>();
    for (const c of canvases) {
      if (c.geo_anchor) {
        for (const nid of c.graph.node_ids) map.set(nid, c.geo_anchor);
      }
    }
    return map;
  }, [canvases]);

  // Fit on first mount.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (getNodes().length > 0) fitView({ duration: 300 });
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to a node requested from outside the ReactFlow tree (attribute scan panel, etc.)
  const pendingFocusNodeId = useUiStore((s) => s.pendingFocusNodeId);
  useEffect(() => {
    if (!pendingFocusNodeId) return;
    fitView({ nodes: [{ id: pendingFocusNodeId }], duration: 400, padding: 0.5, maxZoom: 1.5 });
    useUiStore.getState().clearFocusNode();
  }, [pendingFocusNodeId, fitView]);

  // Register PNG capture for Scorecard / download button.
  useEffect(() => {
    async function capture(): Promise<string | undefined> {
      try {
        const { toPng } = await import("html-to-image");
        const nodes = getNodes();
        if (nodes.length === 0) return undefined;

        // Georeferenced: capture the full container so map tiles appear.
        const isGeoref = (await import("@/store/canvas-store"))
          .useCanvasStore.getState().canvases;
        const hasGeoref = Object.values(isGeoref).some((c) => c.georeferenced);
        if (hasGeoref && containerRef.current) {
          const el = containerRef.current;
          return await toPng(el, { width: el.offsetWidth, height: el.offsetHeight });
        }

        const viewport =
          containerRef.current?.querySelector<HTMLElement>(".react-flow__viewport") ??
          document.querySelector<HTMLElement>(".react-flow__viewport");
        if (!viewport) return undefined;
        const rawBounds = getNodesBounds(nodes);
        const OVERFLOW = 40;
        const bounds = {
          x: rawBounds.x - OVERFLOW,
          y: rawBounds.y - OVERFLOW,
          width: rawBounds.width + 2 * OVERFLOW,
          height: rawBounds.height + 2 * OVERFLOW,
        };
        const PADDING = 48;
        const TARGET_MAX = 1600;
        const zoom = Math.min(2, Math.max(0.15,
          Math.min(TARGET_MAX / bounds.width, TARGET_MAX / bounds.height),
        ));
        const captureW = Math.max(
          Math.ceil(Math.max(0, bounds.x) + bounds.width) + PADDING,
          Math.round(bounds.width * zoom + 2 * PADDING),
        );
        const captureH = Math.max(
          Math.ceil(Math.max(0, bounds.y) + bounds.height) + PADDING,
          Math.round(bounds.height * zoom + 2 * PADDING),
        );
        const tx = PADDING - bounds.x * zoom;
        const ty = PADDING - bounds.y * zoom;
        return await toPng(viewport, {
          backgroundColor: "#f4f4f5",
          width: captureW,
          height: captureH,
          style: {
            width: `${captureW}px`,
            height: `${captureH}px`,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: "0 0",
          },
        });
      } catch {
        return undefined;
      }
    }
    useUiStore.getState().registerCaptureCanvas(capture);
    return () => useUiStore.getState().registerCaptureCanvas(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Build RF nodes/edges ------------------------------------------------

  const orderedNodeIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const c of canvases) {
      for (const nid of c.graph.node_ids) {
        if (!seen.has(nid)) { seen.add(nid); ids.push(nid); }
      }
    }
    return ids;
  }, [canvases]);

  const mergedNodes = useMemo(
    () => orderedNodeIds.flatMap((id) => allNodes[id] ? [allNodes[id]!] : []),
    [orderedNodeIds, allNodes],
  );

  const rfNodes = useMemo<RFNode[]>(() =>
    orderedNodeIds.flatMap((id) => {
      const node = allNodes[id];
      if (!node) return [];
      return [toRFNode(node, selectedNodeIds.has(id))];
    }),
    [orderedNodeIds, allNodes, selectedNodeIds],
  );

  // Maps nodeId → the first canvas that owns it — used to detect cross-canvas edges.
  const nodeCanvasMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of canvases) {
      for (const nid of c.graph.node_ids) {
        if (!map.has(nid)) map.set(nid, c.id);
      }
    }
    return map;
  }, [canvases]);

  const orderedEdgeIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const c of canvases) {
      for (const eid of c.graph.edge_ids) {
        if (!seen.has(eid)) { seen.add(eid); ids.push(eid); }
      }
    }
    return ids;
  }, [canvases]);

  const rfEdges = useMemo<RFEdge[]>(() =>
    orderedEdgeIds.flatMap((eid) => {
      const edge = allEdges[eid];
      if (!edge) return [];
      const srcCanvas = nodeCanvasMap.get(edge.source);
      const tgtCanvas = nodeCanvasMap.get(edge.target);
      const isInterCanvas = !!(srcCanvas && tgtCanvas && srcCanvas !== tgtCanvas);
      const edgeColor = levelColor(scaleLevels, edge.functionality);
      return [{
        ...toRFEdge(edge, isInterCanvas),
        selected: selectedEdgeIds.has(eid),
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 14, height: 10 },
      }];
    }),
    [orderedEdgeIds, allEdges, nodeCanvasMap, scaleLevels, selectedEdgeIds],
  );

  // --- Handlers ------------------------------------------------------------

  // Guard: Lasso raises this before updating the store so that RF's spurious
  // empty onSelectionChange (fired on drag-end) and the subsequent onPaneClick
  // don't wipe the selection the lasso just committed.
  const containerRef = useRef<HTMLDivElement>(null);
  const lassoActiveRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const panMode = activeTool === "pan";

  const onNodeDragStop = useCallback((_: React.MouseEvent, rfNode: RFNode) => {
    const geoAnchor = geoAnchorByNodeId.get(rfNode.id) ?? null;
    const patch: Partial<CascadeNode> = { position: rfNode.position };
    if (geoAnchor) patch.geo = anchorFlowToGeo(rfNode.position, geoAnchor);
    // canvasId: null — the merged view spans all Canvases, no single owner.
    runWithHistory(() => updateNode(rfNode.id, patch), "Move node", {
      updateType: "graph_update",
      canvasId: null,
    });
  }, [updateNode, geoAnchorByNodeId]);

  const onNodeClick: NodeMouseHandler = useCallback((e, rfNode) => {
    if (e.ctrlKey || e.metaKey) toggleNode(rfNode.id);
    else selectNode(rfNode.id);
    setInspectorOpen(true);
  }, [selectNode, toggleNode, setInspectorOpen]);

  const onEdgeClick = useCallback((e: React.MouseEvent, rfEdge: RFEdge) => {
    if (e.ctrlKey || e.metaKey) toggleEdge(rfEdge.id);
    else selectEdge(rfEdge.id);
    setInspectorOpen(true);
  }, [selectEdge, toggleEdge, setInspectorOpen]);

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    if (lassoActiveRef.current) { lassoActiveRef.current = false; return; }
    clearSelection();
    setInspectorOpen(false);
  }, [clearSelection, setInspectorOpen]);

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes, edges }) => {
    if (lassoActiveRef.current) {
      // Ignore RF's spurious empty-selection event on lasso drag-end.
      if (nodes.length === 0 && edges.length === 0) return;
    }
    const newNodeIds = nodes.map((n) => n.id);
    const newEdgeIds = edges.map((e) => e.id);
    const { selectedNodeIds: curN, selectedEdgeIds: curE } = useNetworkStore.getState();
    if (
      newNodeIds.length === curN.size &&
      newEdgeIds.length === curE.size &&
      newNodeIds.every((id) => curN.has(id)) &&
      newEdgeIds.every((id) => curE.has(id))
    ) return;
    useNetworkStore.getState().selectAll(newNodeIds, newEdgeIds);
    if (newNodeIds.length > 0 || newEdgeIds.length > 0) setInspectorOpen(true);
  }, [setInspectorOpen]);

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY });
  }, []);

  // The merged view is read-only for connections — nodesConnectable=false blocks
  // edge creation silently. Auto-reset add-edge tool and inform the user.
  useEffect(() => {
    if (activeTool === "add-edge") {
      useUiStore.getState().pushToast({
        message: "Edge creation is not available in merged view. Use the inter-canvas edge tool.",
        variant: "info",
        durationMs: 4000,
      });
      useUiStore.getState().setActiveTool("select");
    }
  }, [activeTool]);

  // Ctrl+A: select all
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        selectAll(orderedNodeIds, orderedEdgeIds);
        setInspectorOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orderedNodeIds, orderedEdgeIds, selectAll, setInspectorOpen]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {geoCanvasId && (
        <GeoMapBackground key={geoCanvasId} canvasId={geoCanvasId} />
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        onPaneContextMenu={onPaneContextMenu}
        panOnDrag={panMode ? true : PAN_ON_DRAG_MIDDLE}
        panOnScroll={false}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={false}
        onlyRenderVisibleElements
        fitView
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        {!geoCanvasId && (
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
        )}
        <ZoomSlider />
        <NodeSearch nodes={mergedNodes} />

        {/* Freehand lasso — same as single-canvas FlowCanvas */}
        <Lasso
          active={activeTool === "select"}
          partial
          onSelect={(nodeIds) => {
            // Always raise the guard — even on zero hits — so that RF's spurious
            // empty onSelectionChange and the subsequent onPaneClick don't wipe
            // an existing selection when the user draws a lasso over empty space.
            lassoActiveRef.current = true;
            selectAll(nodeIds, []);
            if (nodeIds.length > 0) setInspectorOpen(true);
          }}
        />
      </ReactFlow>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeIds={orderedNodeIds}
          edgeIds={orderedEdgeIds}
          filename="all-canvases"
          onClose={() => setContextMenu(null)}
          containerRef={containerRef}
        />
      )}
    </div>
  );
}

export function MergedViewCanvasWithProvider() {
  return (
    <ReactFlowProvider>
      <MergedViewCanvas />
    </ReactFlowProvider>
  );
}
