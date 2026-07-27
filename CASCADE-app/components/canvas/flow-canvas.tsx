"use client";

/**
 * FlowCanvas — React Flow canvas controller for a single CASCADE Canvas.
 *
 * Owns interaction and state wiring only: drag/connect/paste/delete (each an
 * undoable Any Graph Update via runWithHistory), selection, keyboard
 * shortcuts, context menu, geo background. Rendering lives in the sibling
 * modules: cascade-node.tsx (shapes + node renderer), cascade-edge.tsx
 * (edge renderer), canvas-legend.tsx (legend overlay).
 *
 * Performance: onlyRenderVisibleElements=true; selection in network-store.
 */

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  getNodesBounds,
  ConnectionMode,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { nanoid } from "nanoid";
import { runWithHistory } from "@/lib/run-with-history";
import { useCanvasStore, selectActiveCanvas } from "@/store/canvas-store";
import { NodeSearch } from "./node-search";
import { ZoomSlider } from "./zoom-slider";
import { Lasso } from "./lasso";
import { useNetworkStore } from "@/store/network-store";
import { useClipboardStore } from "@/store/clipboard-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import type { Node as CascadeNode, Edge as CascadeEdge } from "@/lib/schemas/network";
import { pickHandles } from "@/lib/edge-routing";
import { CanvasContextMenu } from "./canvas-context-menu";
import { GeoMapBackground } from "@/components/geo/geo-map-background";
import { anchorFlowToGeo } from "@/lib/geo-utils";
import { nodeTypes, toRFNode, expandBoundsForLabels } from "./cascade-node";
import { edgeTypes, toRFEdge } from "./cascade-edge";
import { CanvasLegend } from "./canvas-legend";


// Stable reference — avoids new array on every render (which causes ReactFlow's
// StoreUpdater to repeatedly call store.setState and trigger an infinite loop).
const PAN_ON_DRAG_MIDDLE: number[] = [1];

// ---------------------------------------------------------------------------
// Main FlowCanvas component
// ---------------------------------------------------------------------------

function FlowCanvas() {
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const allCanvases = useCanvasStore((s) => s.canvases) as Record<string, import("@/lib/schemas/network").Canvas>;
  const updateNode = useCanvasStore((s) => s.updateNode);
  const upsertNode = useCanvasStore((s) => s.upsertNode);
  const upsertEdge = useCanvasStore((s) => s.upsertEdge);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const addNodeToCanvas = useCanvasStore((s) => s.addNodeToCanvas);
  const addEdgeToCanvas = useCanvasStore((s) => s.addEdgeToCanvas);

  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const toggleNode = useNetworkStore((s) => s.toggleNode);
  const toggleEdge = useNetworkStore((s) => s.toggleEdge);
  const selectAll = useNetworkStore((s) => s.selectAll);
  const clearSelection = useNetworkStore((s) => s.clearSelection);

  const clipboard = useClipboardStore((s) => s.contents);
  const copyToClipboard = useClipboardStore((s) => s.copy);

  const { screenToFlowPosition, getNodes, fitView } = useReactFlow();

  // Auto-frame the Canvas's content when switching Canvas. fitView's `fitView`
  // prop only fires on first mount, and FlowCanvas is not remounted per Canvas,
  // so we re-fit whenever the active Canvas changes. rAF lets React Flow commit
  // the new Canvas's nodes before we measure their bounds.
  const activeCanvasId = activeCanvas?.id;
  useEffect(() => {
    if (!activeCanvasId) return;
    const raf = requestAnimationFrame(() => {
      if (getNodes().length > 0) fitView({ duration: 300 });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeCanvasId, fitView, getNodes]);

  // Fly to a node requested from outside the ReactFlow tree (attribute scan panel, etc.)
  const pendingFocusNodeId = useUiStore((s) => s.pendingFocusNodeId);
  useEffect(() => {
    if (!pendingFocusNodeId) return;
    fitView({ nodes: [{ id: pendingFocusNodeId }], duration: 400, padding: 0.5, maxZoom: 1.5 });
    useUiStore.getState().clearFocusNode();
  }, [pendingFocusNodeId, fitView]);

  // Register a capture function in ui-store so the Scorecard dialog can call it
  // from outside the ReactFlow context. Captures whatever is currently rendered
  // on screen — the user is responsible for being on the view they want to record.
  // Uses html-to-image (handles CSS transforms and SVG edges correctly).
  useEffect(() => {
    async function capture(): Promise<string | undefined> {
      try {
        const { toPng } = await import("html-to-image");
        const nodes = getNodes();
        if (nodes.length === 0) return undefined;

        // Exclude on-screen UI overlays (find-node search, zoom slider, legend,
        // React Flow attribution/minimap) from the exported image so it shows
        // only the network and its background. html-to-image calls this filter
        // for every DOM node; returning false drops that node and its subtree.
        const filter = (el: HTMLElement) =>
          !(el instanceof Element &&
            typeof el.matches === "function" &&
            el.matches(
              ".react-flow__panel, .react-flow__controls, .react-flow__minimap, .react-flow__attribution, [data-export-ignore]",
            ));

        // Georeferenced canvas: capture the full container (map + nodes) at its
        // natural screen size so the map tiles appear in the exported image.
        const storeState = (await import("@/store/canvas-store")).useCanvasStore.getState();
        const activeId = storeState.activeCanvasId;
        const isGeoref = activeId ? (storeState.canvases[activeId]?.georeferenced ?? false) : false;

        if (isGeoref && containerRef.current) {
          const el = containerRef.current;
          return await toPng(el, {
            width: el.offsetWidth,
            height: el.offsetHeight,
            filter,
          });
        }

        const viewport =
          containerRef.current?.querySelector<HTMLElement>(".react-flow__viewport") ??
          document.querySelector<HTMLElement>(".react-flow__viewport");
        if (!viewport) return undefined;

        // Expand the node-box bounds so the name labels — centered below each
        // node and wider than the node itself — are never clipped in the output
        // image. Geometry lives with the label in cascade-node.tsx.
        const bounds = expandBoundsForLabels(getNodesBounds(nodes));
        const PADDING = 48;
        const TARGET_MAX = 1600;

        // Zoom to fit the content within TARGET_MAX on its longest axis.
        const zoom = Math.min(2, Math.max(0.15,
          Math.min(TARGET_MAX / bounds.width, TARGET_MAX / bounds.height),
        ));

        // Desired output dimensions: tight crop around content.
        const cropW = Math.round(bounds.width * zoom + 2 * PADDING);
        const cropH = Math.round(bounds.height * zoom + 2 * PADDING);

        // With transformOrigin "0 0", translate(tx, ty) scale(zoom) maps a node
        // at flow position (bounds.x, bounds.y) to screen (PADDING, PADDING).
        const tx = PADDING - bounds.x * zoom;
        const ty = PADDING - bounds.y * zoom;

        // The capture canvas must be wide/tall enough to contain ALL nodes at
        // their original (untransformed) positions so nothing is clipped by
        // the element's own overflow box before the transform is applied.
        const captureW = Math.max(Math.ceil(Math.max(0, bounds.x) + bounds.width) + PADDING, cropW);
        const captureH = Math.max(Math.ceil(Math.max(0, bounds.y) + bounds.height) + PADDING, cropH);

        const dataUrl = await toPng(viewport, {
          backgroundColor: "#f4f4f5",
          width: captureW,
          height: captureH,
          filter,
          style: {
            width: `${captureW}px`,
            height: `${captureH}px`,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: "0 0",
          },
        });

        // If the capture canvas was larger than the desired output, crop it.
        if (cropW < captureW || cropH < captureH) {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = dataUrl;
          });
          const canvas = document.createElement("canvas");
          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return dataUrl;
          ctx.drawImage(img, 0, 0, cropW, cropH, 0, 0, cropW, cropH);
          return canvas.toDataURL("image/png");
        }

        return dataUrl;
      } catch {
        return undefined;
      }
    }

    useUiStore.getState().registerCaptureCanvas(capture);
    return () => useUiStore.getState().registerCaptureCanvas(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // register once — capture() reads live DOM state on every call

  // When the lasso fires onSelect, React Flow also fires an onSelectionChange
  // with an empty array (it sees the drag-end as a pane interaction and thinks
  // everything was deselected). This ref prevents that spurious empty-deselect
  // from wiping the selection the lasso just committed.
  const containerRef = useRef<HTMLDivElement>(null);
  const lassoActiveRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const activeTool = useUiStore((s) => s.activeTool);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const pushToast = useUiStore((s) => s.pushToast);
  const selectedNodeTemplate = useUiStore((s) => s.selectedNodeTemplate);

  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const nodeDefaults = useConfigStore(useShallow((s) => s.config.node_defaults ?? {}));

  // Build React Flow nodes/edges from store.
  // selectedNodeIds IS included in deps so that attribute updates (which change
  // allNodes) don't reset selection: the memo always stamps each node with its
  // current `selected` state, preventing RF from losing the selection on re-render.
  // The loop risk (store→rfNodes→onSelectionChange→store) is broken by the
  // idempotency guard inside onSelectionChange.
  const rfNodes = useMemo<RFNode[]>(() => {
    if (!activeCanvas) return [];
    return activeCanvas.graph.node_ids.flatMap((id) => {
      const node = allNodes[id];
      if (!node) return [];
      return [toRFNode(node, selectedNodeIds.has(id))];
    });
  }, [activeCanvas, allNodes, selectedNodeIds]);

  const rfEdges = useMemo<RFEdge[]>(() => {
    if (!activeCanvas) return [];
    const activeNodeIds = new Set(activeCanvas.graph.node_ids);

    // Collect edges from every canvas that has at least one endpoint in the
    // active canvas — this makes inter-canvas edges visible from both sides.
    const edgeIdsSeen = new Set<string>();
    const allCanvasEdgeIds = Object.values(allCanvases).flatMap((c) => c.graph.edge_ids);

    return allCanvasEdgeIds.flatMap((id) => {
      if (edgeIdsSeen.has(id)) return [];
      edgeIdsSeen.add(id);
      const edge = allEdges[id];
      if (!edge) return [];
      const tailInActive = activeNodeIds.has(edge.source);
      const headInActive = activeNodeIds.has(edge.target);
      if (!tailInActive && !headInActive) return [];
      const isInterCanvas = !tailInActive || !headInActive;
      const otherNodeId = isInterCanvas ? (tailInActive ? edge.target : edge.source) : null;
      const targetCanvas = otherNodeId
        ? Object.values(allCanvases).find(
            (c) => c.id !== activeCanvas.id && c.graph.node_ids.includes(otherNodeId),
          )
        : undefined;
      const edgeColor = levelColor(scaleLevels, edge.functionality);
      return [{
        ...toRFEdge(edge, isInterCanvas, targetCanvas?.label),
        selected: selectedEdgeIds.has(id),
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 14, height: 10 },
      }];
    });
  }, [activeCanvas, allEdges, allCanvases, scaleLevels, selectedEdgeIds]);

  // ── Node drag end → update position + push undoable history entry ──
  const onNodeDragStop = useCallback((_: React.MouseEvent, rfNode: RFNode) => {
    const geoAnchor = activeCanvas?.geo_anchor ?? null;
    const nodePatch: Partial<CascadeNode> = { position: rfNode.position };
    if (geoAnchor) {
      nodePatch.geo = anchorFlowToGeo(rfNode.position, geoAnchor);
    }
    runWithHistory(() => updateNode(rfNode.id, nodePatch), "Move node", {
      updateType: "graph_update",
      canvasId: activeCanvas?.id,
    });
  }, [updateNode, activeCanvas]);

  // ── Click → select ──
  // Ctrl/Meta+click: XOR-toggle into a homogeneous selection (nodes only OR edges only).
  // Plain click: single selection as before.
  // Ctrl/Meta+click: XOR-toggle. Plain click: single select.
  // setRfNodes is no longer needed here — the rfNodes memo re-stamps `selected`
  // from the store on every render, so the visual highlight follows automatically.
  const onNodeClick: NodeMouseHandler = useCallback((e, rfNode) => {
    if (e.ctrlKey || e.metaKey) {
      toggleNode(rfNode.id);
    } else {
      selectNode(rfNode.id);
    }
    setInspectorOpen(true);
  }, [selectNode, toggleNode, setInspectorOpen]);

  const onEdgeClick = useCallback((e: React.MouseEvent, rfEdge: RFEdge) => {
    if (e.ctrlKey || e.metaKey) {
      toggleEdge(rfEdge.id);
    } else {
      selectEdge(rfEdge.id);
    }
    setInspectorOpen(true);
  }, [selectEdge, toggleEdge, setInspectorOpen]);

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    if (lassoActiveRef.current) {
      lassoActiveRef.current = false;
      return;
    }
    clearSelection();
    setInspectorOpen(false);
  }, [clearSelection, setInspectorOpen]);

  // ── Rectangle / box select ──
  // Two guards here prevent looping:
  //
  // 1. Lasso guard: RF fires onSelectionChange({nodes:[], edges:[]}) when it
  //    processes the drag-end as a pane interaction. Skip that while
  //    lassoActiveRef is true.
  //
  // 2. Idempotency guard: since rfNodes/rfEdges now stamp `selected` from the
  //    store, every store update causes the memo to recompute, which makes RF
  //    fire onSelectionChange with the same set of IDs already in the store.
  //    We detect that case and skip the redundant selectAll to stop the loop.
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes, edges }) => {
    if (lassoActiveRef.current) {
      if (nodes.length === 0 && edges.length === 0) {
        // Spurious empty deselect from RF drag-end — consume it.
        // Do NOT reset lassoActiveRef here: onPaneClick may fire after this and
        // must still see the guard so it doesn't wipe the lasso result.
        return;
      }
      // Non-empty: let fall through; keep ref raised.
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

  // ── Add edge on connect ──
  // When the user drags from an explicit handle dot, RF provides sourceHandle /
  // targetHandle. When they use connectOnClick (clicking anywhere on a node),
  // handles are null — we fall back to the position-based heuristic that picks
  // the handle whose hexagon sector faces the other node.
  const onConnect = useCallback((connection: {
    source: string | null;
    target: string | null;
    sourceHandle: string | null;
    targetHandle: string | null;
  }) => {
    if (!connection.source || !connection.target || !activeCanvas) return;

    let sourceHandle = connection.sourceHandle ?? undefined;
    let targetHandle = connection.targetHandle ?? undefined;

    if (!sourceHandle || !targetHandle) {
      const srcNode = allNodes[connection.source];
      const tgtNode = allNodes[connection.target];
      if (srcNode && tgtNode) {
        const picked = pickHandles(
          { position: srcNode.position ?? { x: 0, y: 0 } },
          { position: tgtNode.position ?? { x: 0, y: 0 } },
        );
        sourceHandle = sourceHandle ?? picked.sourceHandle;
        targetHandle = targetHandle ?? picked.targetHandle;
      }
    }

    const edge: CascadeEdge = {
      id: `edge-${nanoid(8)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle,
      targetHandle,
      functionality: n,
    };
    runWithHistory(() => {
      upsertEdge(edge);
      addEdgeToCanvas(edge.id, activeCanvas.id);
    }, "Add edge", { updateType: "graph_update", canvasId: activeCanvas.id });
  }, [activeCanvas, n, allNodes, upsertEdge, addEdgeToCanvas]);

  // ── Delete selected ──
  const deleteSelected = useCallback(() => {
    const nodeCount = selectedNodeIds.size;
    const edgeCount = selectedEdgeIds.size;
    const total = nodeCount + edgeCount;
    if (total === 0) return;
    if (total > 3) {
      const ok = window.confirm(`Delete ${total} selected elements?`);
      if (!ok) return;
    }
    runWithHistory(() => {
      selectedNodeIds.forEach((id) => removeNode(id));
      selectedEdgeIds.forEach((id) => removeEdge(id));
      clearSelection();
    }, `Delete ${total} element${total > 1 ? "s" : ""}`, {
      updateType: "graph_update",
      canvasId: activeCanvas?.id,
    });
  }, [selectedNodeIds, selectedEdgeIds, removeNode, removeEdge, clearSelection, activeCanvas]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
        return;
      }

      // Ctrl+A — select all
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!activeCanvas) return;
        selectAll(activeCanvas.graph.node_ids, activeCanvas.graph.edge_ids);
        setInspectorOpen(true);
        return;
      }

      // Ctrl+C — copy
      if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
        if (!activeCanvas || selectedNodeIds.size === 0) return;
        const nodes = [...selectedNodeIds].flatMap((id) => allNodes[id] ? [allNodes[id]] : []);
        const edges = [...selectedEdgeIds].flatMap((id) => allEdges[id] ? [allEdges[id]] : []);
        copyToClipboard(nodes, edges, activeCanvas.id);
        return;
      }

      // Ctrl+V — paste
      if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
        if (!clipboard || !activeCanvas) return;
        runWithHistory(() => {
          const idMap: Record<string, string> = {};

          clipboard.nodes.forEach((node) => {
            const newId = `node-${nanoid(8)}`;
            idMap[node.id] = newId;
            const newNode: CascadeNode = {
              ...node,
              id: newId,
              position: { x: (node.position?.x ?? 0) + 40, y: (node.position?.y ?? 0) + 40 },
            };
            upsertNode(newNode);
            addNodeToCanvas(newId, activeCanvas.id);
          });

          clipboard.edges.forEach((edge) => {
            const newId = `edge-${nanoid(8)}`;
            const newEdge: CascadeEdge = {
              ...edge,
              id: newId,
              source: idMap[edge.source] ?? edge.source,
              target: idMap[edge.target] ?? edge.target,
            };
            upsertEdge(newEdge);
            addEdgeToCanvas(newId, activeCanvas.id);
          });
        }, `Paste ${clipboard.nodes.length} node${clipboard.nodes.length > 1 ? "s" : ""}`, {
          updateType: "graph_update",
          canvasId: activeCanvas.id,
        });
        return;
      }

      // Ctrl+Z — undo
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        const undone = useCanvasStore.getState().undo();
        if (!undone) pushToast({ message: "Nothing more to undo", variant: "info", durationMs: 2000 });
        return;
      }

      // Ctrl+Y / Ctrl+Shift+Z — redo
      if ((e.key === "y" && (e.ctrlKey || e.metaKey)) ||
          (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        const redone = useCanvasStore.getState().redo();
        if (!redone) pushToast({ message: "Nothing more to redo", variant: "info", durationMs: 2000 });
        return;
      }

      // Ctrl+R — clear most recent event (surgical field-by-field revert via mutation_reversal).
      // Escape excluded: conflicts with modal/dialog close handlers.
      if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        const cleared = useCanvasStore.getState().clearEvent();
        if (!cleared) pushToast({ message: "No event to clear", variant: "info", durationMs: 2000 });
        return;
      }

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const toolMap: Record<string, () => void> = {
          v: () => useUiStore.getState().setActiveTool("select"),
          V: () => useUiStore.getState().setActiveTool("select"),
          n: () => useUiStore.getState().setActiveTool("add-node"),
          N: () => useUiStore.getState().setActiveTool("add-node"),
          e: () => useUiStore.getState().setActiveTool("add-edge"),
          E: () => useUiStore.getState().setActiveTool("add-edge"),
          h: () => useUiStore.getState().setActiveTool("pan"),
          H: () => useUiStore.getState().setActiveTool("pan"),
        };
        toolMap[e.key]?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    deleteSelected, activeCanvas, selectAll, setInspectorOpen,
    selectedNodeIds, selectedEdgeIds, allNodes, allEdges,
    copyToClipboard, clipboard, upsertNode, upsertEdge,
    addNodeToCanvas, addEdgeToCanvas, pushToast,
  ]);

  // ── Double-click on pane → add node (when add-node tool active) ──
  const onPaneDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== "add-node" || !activeCanvas) return;
    e.preventDefault();
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const tpl = selectedNodeTemplate ? (nodeDefaults[selectedNodeTemplate] ?? {}) : {};
    const node: CascadeNode = {
      ...tpl,
      id: `node-${nanoid(8)}`,
      label: tpl.label ?? selectedNodeTemplate ?? "New Node",
      node_type: tpl.node_type ?? "Service",
      functionality: n,
      position,
    };
    runWithHistory(() => {
      upsertNode(node);
      addNodeToCanvas(node.id, activeCanvas.id);
    }, "Add node", { updateType: "graph_update", canvasId: activeCanvas.id });
    selectNode(node.id);
    setInspectorOpen(true);
  }, [activeTool, activeCanvas, n, selectedNodeTemplate, nodeDefaults, screenToFlowPosition, upsertNode, addNodeToCanvas, selectNode, setInspectorOpen]);

  // ── Right-click on pane → context menu ──
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // ── Right-click on node → select it ──
  const onNodeContextMenu = useCallback((_: React.MouseEvent, rfNode: RFNode) => {
    selectNode(rfNode.id);
  }, [selectNode]);

  const panMode = activeTool === "pan";

  if (!activeCanvas) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        No canvas selected.
      </div>
    );
  }

  const canvasColor = activeCanvas.color;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/* Map background — always behind React Flow when canvas is georeferenced.
          Keyed by canvas id so switching Canvas remounts with a fresh MapLibre
          instance (correct saved center/zoom/anchor and freshly-measured dims),
          rather than reusing the previous Canvas's stale map. */}
      {activeCanvas.georeferenced && (
        <GeoMapBackground key={activeCanvas.id} canvasId={activeCanvas.id} />
      )}

      {/* Canvas colour tint — subtle hue overlay, works in both light and dark mode */}
      {canvasColor && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: canvasColor,
            opacity: 0.05,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
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
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onDoubleClick={onPaneDoubleClick}
        panOnDrag={panMode ? true : PAN_ON_DRAG_MIDDLE}
        panOnScroll={false}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        connectionMode={ConnectionMode.Loose}
        connectOnClick={activeTool === "add-edge"}
        onlyRenderVisibleElements
        fitView
        minZoom={0.25}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        {!activeCanvas.georeferenced && (
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
        )}
        <NodeSearch />
        <ZoomSlider />
        {/* Freehand lasso — active in select tool, replaces rect-select */}
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

      {/* Legend overlay — bottom right, outside ReactFlow so it never pans/zooms */}
      <CanvasLegend />

      {/* Pane context menu */}
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeIds={activeCanvas?.graph.node_ids ?? []}
          edgeIds={activeCanvas?.graph.edge_ids ?? []}
          filename={activeCanvas?.label ?? "canvas"}
          onClose={() => setContextMenu(null)}
          containerRef={containerRef}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-export a wrapper that provides the ReactFlowProvider context
// ---------------------------------------------------------------------------

import { ReactFlowProvider } from "@xyflow/react";
import { levelColor } from "@/lib/colors";

export function FlowCanvasWithProvider() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}
