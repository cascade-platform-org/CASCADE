/**
 * canvas-store.ts — Global element registry and Canvas lifecycle.
 *
 * Data shape (ADR-0001):
 *   Project.nodes  = Record<id, Node>   ← global registry
 *   Project.edges  = Record<id, Edge>   ← global registry
 *   Canvas.graph   = { graph_type, node_ids[], edge_ids[] }
 *
 * Elements have globally unique IDs. A node may appear in multiple Canvases
 * (node_ids lists) without duplication — the registry is the single source of truth.
 * "Inter-canvas edge" is a UI render-time concept only (no field in the data model).
 *
 * Concerns intentionally NOT in this store:
 *   - update_history / redo stack → history-store.ts
 *   - scorecard entries           → scorecard-store.ts
 *   - UI selection / hover        → network-store.ts
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  Canvas,
  Edge,
  Graph,
  GraphSnapshot,
  Node,
  Project,
} from "@/lib/schemas";
import type { ElementUpdate, PropagationResult, EventDefinition } from "@/lib/schemas";
import { useHistoryStore } from "@/store/history-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useNetworkStore } from "@/store/network-store";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface CanvasState {
  /** Global node registry. Single authoritative state per node. */
  nodes: Record<string, Node>;
  /** Global edge registry. Single authoritative state per edge. */
  edges: Record<string, Edge>;
  /** Ordered Canvas ids — drives tab order and serialisation order. */
  canvasOrder: string[];
  /** O(1) Canvas lookup by id. */
  canvases: Record<string, Canvas>;
  /** Currently visible Canvas. Null only before the first Canvas is created. */
  activeCanvasId: string | null;
  /** Project-level metadata (name, description, global graph type). */
  projectMeta: { name: string; description?: string; global_graph_type?: string };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface CanvasActions {
  // --- Node registry ---
  upsertNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<Node>) => void;

  // --- Edge registry ---
  upsertEdge: (edge: Edge) => void;
  removeEdge: (edgeId: string) => void;
  updateEdge: (edgeId: string, patch: Partial<Edge>) => void;

  // --- Canvas lifecycle ---
  addCanvas: (canvas: Canvas) => void;
  removeCanvas: (canvasId: string) => void;
  updateCanvasMeta: (canvasId: string, patch: Partial<Pick<Canvas, "label" | "color" | "crs" | "georeferenced" | "map_style" | "map_center" | "map_zoom" | "geo_anchor">>) => void;
  setActiveCanvas: (canvasId: string) => void;
  reorderCanvases: (orderedIds: string[]) => void;

  // --- Graph membership (which elements a Canvas visualises) ---
  addNodeToCanvas: (nodeId: string, canvasId?: string) => void;
  removeNodeFromCanvas: (nodeId: string, canvasId?: string) => void;
  addEdgeToCanvas: (edgeId: string, canvasId?: string) => void;
  removeEdgeFromCanvas: (edgeId: string, canvasId?: string) => void;
  setGraphType: (graphType: string, canvasId?: string) => void;

  // --- Propagation result ---
  /**
   * Merges engine updates into the global registry.
   * Each ElementUpdate ID is looked up directly in nodes or edges.
   */
  applyPropagationResult: (result: PropagationResult) => void;

  // --- Snapshot restore (used by undo/redo) ---
  /** Restore a GraphSnapshot. Touches only nodes/edges/canvases. */
  restoreSnapshot: (snapshot: GraphSnapshot) => void;

  // --- Undo / Redo (coordinate registry + history-store) ---
  /**
   * Undo the most recent Any Graph Update. Moves the entry to the redo stack and
   * restores the entry's `before` snapshot. Returns false when history is empty.
   */
  undo: () => boolean;
  /**
   * Redo the most recently undone Any Graph Update. Moves the entry back to the
   * undo history and restores the entry's `after` snapshot. Returns false when
   * the redo stack is empty.
   */
  redo: () => boolean;

  // --- Event application ---
  /**
   * Apply an EventDefinition to the graph:
   *   1. Captures pre-event values of all fields the event will touch.
   *   2. Applies vulnerability_level drops, direct_damage_effects, attribute_mutations.
   *   3. Pushes an event_applied history entry (via history-store) with mutation_reversal populated.
   */
  applyEvent: (event: EventDefinition, n: number) => void;
  /**
   * Revert the most recent event_applied entry using mutation_reversal (field-by-field).
   * Falls back to full snapshot restore for legacy entries that predate mutation_reversal.
   * Returns false when no event_applied entry exists.
   */
  clearEvent: () => boolean;

  // --- Cross-canvas node operations ---
  /**
   * Copy selected nodes (and internal edges) to targetCanvasId.
   * Nodes are referenced by ID — no new data created. Edges whose both endpoints
   * are in nodeIds are also added to the target canvas.
   * Records a graph_update history entry.
   */
  copyNodesToCanvas: (nodeIds: string[], targetCanvasId: string) => void;
  /**
   * Move selected nodes (and internal edges) from sourceCanvasId to targetCanvasId.
   * Records a graph_update history entry.
   */
  moveNodesToCanvas: (nodeIds: string[], sourceCanvasId: string, targetCanvasId: string) => void;

  // --- Project meta ---
  setProjectMeta: (meta: { name?: string; description?: string }) => void;
  /** Set the graph type for the Global view (all Canvases). Pass null to clear. */
  setGlobalGraphType: (graphType: string | null) => void;

  // --- Serialisation ---
  toGraphSnapshot: () => GraphSnapshot;
  toProject: () => Project;
  fromProject: (project: Project) => void;
  /** Alias for fromProject — used by File I/O panel. */
  loadProject: (project: Project) => void;
  reset: () => void;
}

export type CanvasStore = CanvasState & CanvasActions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveCanvasId(state: CanvasState, canvasId?: string): string {
  const id = canvasId ?? state.activeCanvasId;
  if (!id) throw new Error("No active Canvas — provide an explicit canvasId.");
  if (!state.canvases[id]) throw new Error(`Canvas '${id}' not found.`);
  return id;
}

function applyUpdate(element: Node | Edge, update: ElementUpdate): Node | Edge {
  return {
    ...element,
    functionality: update.functionality,
    ...(update.functionality_time !== undefined && { functionality_time: update.functionality_time }),
    ...(update.direct_damage !== undefined && { direct_damage: update.direct_damage }),
    ...(update.expected_repair_time !== undefined && { expected_repair_time: update.expected_repair_time }),
    ...(update.responsibility_share !== undefined && { responsibility_share: update.responsibility_share }),
    ...(update.properties !== undefined && { properties: { ...(element.properties ?? {}), ...update.properties } }),
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const emptyState: CanvasState = {
  nodes: {},
  edges: {},
  canvasOrder: [],
  canvases: {},
  activeCanvasId: null,
  projectMeta: { name: "Untitled Project" },
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCanvasStore = create<CanvasStore>()(
  immer((set, get) => ({
    ...emptyState,

    // -------------------------------------------------------------------------
    // Node registry
    // -------------------------------------------------------------------------

    upsertNode(node) {
      set((state) => { state.nodes[node.id] = node; });
    },

    removeNode(nodeId) {
      set((state) => {
        delete state.nodes[nodeId];
        for (const canvas of Object.values(state.canvases)) {
          canvas.graph.node_ids = canvas.graph.node_ids.filter((id) => id !== nodeId);
          const affectedEdgeIds = canvas.graph.edge_ids.filter((eid) => {
            const e = state.edges[eid];
            return e && (e.source === nodeId || e.target === nodeId);
          });
          canvas.graph.edge_ids = canvas.graph.edge_ids.filter(
            (eid) => !affectedEdgeIds.includes(eid),
          );
          affectedEdgeIds.forEach((eid) => delete state.edges[eid]);
        }
      });
    },

    updateNode(nodeId, patch) {
      set((state) => {
        if (!state.nodes[nodeId]) return;
        state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
      });
    },

    // -------------------------------------------------------------------------
    // Edge registry
    // -------------------------------------------------------------------------

    upsertEdge(edge) {
      set((state) => { state.edges[edge.id] = edge; });
    },

    removeEdge(edgeId) {
      set((state) => {
        delete state.edges[edgeId];
        for (const canvas of Object.values(state.canvases)) {
          canvas.graph.edge_ids = canvas.graph.edge_ids.filter((id) => id !== edgeId);
        }
      });
    },

    updateEdge(edgeId, patch) {
      set((state) => {
        if (!state.edges[edgeId]) return;
        state.edges[edgeId] = { ...state.edges[edgeId], ...patch };
      });
    },

    // -------------------------------------------------------------------------
    // Canvas lifecycle
    // -------------------------------------------------------------------------

    addCanvas(canvas) {
      set((state) => {
        if (state.canvases[canvas.id]) return;
        state.canvases[canvas.id] = canvas;
        state.canvasOrder.push(canvas.id);
        if (state.activeCanvasId === null) state.activeCanvasId = canvas.id;
      });
    },

    removeCanvas(canvasId) {
      set((state) => {
        if (!state.canvases[canvasId]) return;
        delete state.canvases[canvasId];
        state.canvasOrder = state.canvasOrder.filter((id) => id !== canvasId);
        if (state.activeCanvasId === canvasId) {
          state.activeCanvasId = state.canvasOrder[0] ?? null;
        }
      });
    },

    updateCanvasMeta(canvasId, patch) {
      set((state) => {
        const canvas = state.canvases[canvasId];
        if (!canvas) return;
        Object.assign(canvas, patch);
      });
    },

    setActiveCanvas(canvasId) {
      set((state) => {
        if (!state.canvases[canvasId]) return;
        state.activeCanvasId = canvasId;
      });
    },

    reorderCanvases(orderedIds) {
      set((state) => {
        const current = new Set(state.canvasOrder);
        const next = new Set(orderedIds);
        if (current.size !== next.size || [...current].some((id) => !next.has(id))) {
          throw new Error("reorderCanvases: orderedIds must match the existing Canvas ids exactly.");
        }
        state.canvasOrder = orderedIds;
      });
    },

    // -------------------------------------------------------------------------
    // Graph membership
    // -------------------------------------------------------------------------

    addNodeToCanvas(nodeId, canvasId) {
      set((state) => {
        const id = resolveCanvasId(state, canvasId);
        const { graph } = state.canvases[id];
        if (!graph.node_ids.includes(nodeId)) graph.node_ids.push(nodeId);
      });
    },

    removeNodeFromCanvas(nodeId, canvasId) {
      set((state) => {
        const id = resolveCanvasId(state, canvasId);
        const { graph } = state.canvases[id];
        graph.node_ids = graph.node_ids.filter((n) => n !== nodeId);
      });
    },

    addEdgeToCanvas(edgeId, canvasId) {
      set((state) => {
        const id = resolveCanvasId(state, canvasId);
        const { graph } = state.canvases[id];
        if (!graph.edge_ids.includes(edgeId)) graph.edge_ids.push(edgeId);
      });
    },

    removeEdgeFromCanvas(edgeId, canvasId) {
      set((state) => {
        const id = resolveCanvasId(state, canvasId);
        const { graph } = state.canvases[id];
        graph.edge_ids = graph.edge_ids.filter((e) => e !== edgeId);
      });
    },

    setGraphType(graphType, canvasId) {
      set((state) => {
        const id = resolveCanvasId(state, canvasId);
        state.canvases[id].graph.graph_type = graphType;
      });
    },

    // -------------------------------------------------------------------------
    // Propagation result
    // -------------------------------------------------------------------------

    applyPropagationResult(result) {
      set((state) => {
        for (const update of result.updates) {
          if (state.nodes[update.id]) {
            state.nodes[update.id] = applyUpdate(state.nodes[update.id], update) as Node;
          } else if (state.edges[update.id]) {
            state.edges[update.id] = applyUpdate(state.edges[update.id], update) as Edge;
          }
        }
      });
    },

    // -------------------------------------------------------------------------
    // Snapshot restore
    // -------------------------------------------------------------------------

    restoreSnapshot(snapshot) {
      set((state) => {
        state.nodes = snapshot.nodes;
        state.edges = snapshot.edges;
        const newCanvases: Record<string, Canvas> = {};
        const newOrder: string[] = [];
        for (const canvas of snapshot.canvases) {
          newCanvases[canvas.id] = canvas;
          newOrder.push(canvas.id);
        }
        state.canvases = newCanvases;
        state.canvasOrder = newOrder;
        if (state.activeCanvasId && !newCanvases[state.activeCanvasId]) {
          state.activeCanvasId = newOrder[0] ?? null;
        }
      });
    },

    // -------------------------------------------------------------------------
    // Undo / Redo — coordinate registry with history-store
    // -------------------------------------------------------------------------

    undo() {
      const entry = useHistoryStore.getState().shiftToRedo();
      if (!entry) return false;
      get().restoreSnapshot(entry.before);
      return true;
    },

    redo() {
      const entry = useHistoryStore.getState().shiftFromRedo();
      if (!entry) return false;
      get().restoreSnapshot(entry.after);
      return true;
    },

    // -------------------------------------------------------------------------
    // Event application
    // -------------------------------------------------------------------------

    applyEvent(event: EventDefinition, n: number) {
      const state = get();
      const reversal: Record<string, unknown> = {};

      function capture(elementId: string, field: string, value: unknown) {
        reversal[`${elementId}.${field}`] = value;
      }

      const allElements: Array<{ id: string; el: Node | Edge }> = [
        ...Object.values(state.nodes).map((el) => ({ id: el.id, el })),
        ...Object.values(state.edges).map((el) => ({ id: el.id, el })),
      ];

      // ── 0. Temporal Jump — advance functionality_time, expire if ≤ 0 ──
      const temporalExpired = new Map<string, { functionality: number; functionality_time: number }>();
      const expiredIds = new Set<string>();  // elements whose backup expired (functionality → 1)
      if (event.type === "temporal_jump") {
        const hours = event.duration_hours ?? 0;
        for (const { id, el } of allElements) {
          const ft = el.functionality_time ?? 0;
          if (ft <= 0) continue;
          capture(id, "functionality_time", ft);
          const newFt = ft - hours;
          if (newFt <= 0) {
            capture(id, "functionality", el.functionality);
            capture(id, "responsibility_share", el.responsibility_share ?? null);
            expiredIds.add(id);
            temporalExpired.set(id, { functionality: 1, functionality_time: 0 });
          } else {
            temporalExpired.set(id, { functionality: el.functionality ?? n, functionality_time: newFt });
          }
        }
      }

      // ── 1. vulnerability_levels drops → functionality ──
      const vuln = new Map<string, number>();
      for (const { id, el } of allElements) {
        const level = el.vulnerability_levels?.[event.id] ?? 0;
        if (level === 0) continue;
        const imposed = Math.max(1, n - level);
        if (imposed < (el.functionality ?? n)) {
          capture(id, "functionality", el.functionality);
          capture(id, "responsibility_share", el.responsibility_share ?? null);
          vuln.set(id, imposed);
        }
      }

      // ── 2. direct_damage for hazards ──
      // A hazard sets direct_damage = true on every element whose vulnerability_level > 0
      // (i.e., the hazard produces any worsening of functionality on that element).
      // direct_damage_effects provides per-element expected_repair_time overrides only;
      // default_repair_time is the fallback repair time when no override is present.
      const directDamageElements: Array<{ id: string; repairTime: number | undefined }> = [];
      if (event.type === "hazard") {
        const explicitEffects = event.direct_damage_effects ?? {};
        const defaultRepairTime = event.default_repair_time;
        for (const { id, el } of allElements) {
          const level = el.vulnerability_levels?.[event.id] ?? 0;
          if (level === 0) continue;
          capture(id, "direct_damage", el.direct_damage ?? false);
          capture(id, "expected_repair_time", el.expected_repair_time ?? null);
          const repairTime = explicitEffects[id]?.expected_repair_time ?? defaultRepairTime;
          directDamageElements.push({ id, repairTime });
        }
      }

      // ── 3. attribute_mutations ──
      for (const [key, _newVal] of Object.entries(event.attribute_mutations ?? {})) {
        const dotIdx = key.indexOf(".");
        if (dotIdx === -1) continue;
        const elementId = key.slice(0, dotIdx);
        const field = key.slice(dotIdx + 1);
        const el: Node | Edge | undefined = state.nodes[elementId] ?? state.edges[elementId];
        if (!el) continue;
        capture(elementId, field, (el as Record<string, unknown>)[field] ?? null);
        if (field === "functionality") {
          capture(elementId, "responsibility_share", el.responsibility_share ?? null);
        }
      }

      // ── Apply everything ──
      const before = state.toGraphSnapshot();

      set((draft) => {
        // The Event is the direct cause for elements it drops — set the
        // responsibility share to the EventId so the UI shows "Event: …" rather
        // than a stale propagation cause from a previous run.
        const eventCause = { [event.id]: 1.0 };
        for (const [id, { functionality, functionality_time }] of temporalExpired) {
          if (draft.nodes[id]) {
            draft.nodes[id].functionality_time = functionality_time;
            draft.nodes[id].functionality = functionality;
            if (expiredIds.has(id)) draft.nodes[id].responsibility_share = eventCause;
          } else if (draft.edges[id]) {
            draft.edges[id].functionality_time = functionality_time;
            draft.edges[id].functionality = functionality;
            if (expiredIds.has(id)) draft.edges[id].responsibility_share = eventCause;
          }
        }
        for (const [id, imposed] of vuln) {
          if (draft.nodes[id]) {
            draft.nodes[id].functionality = imposed;
            draft.nodes[id].responsibility_share = eventCause;
          } else if (draft.edges[id]) {
            draft.edges[id].functionality = imposed;
            draft.edges[id].responsibility_share = eventCause;
          }
        }
        for (const { id, repairTime } of directDamageElements) {
          if (draft.nodes[id]) {
            draft.nodes[id].direct_damage = true;
            if (repairTime !== undefined) draft.nodes[id].expected_repair_time = repairTime;
          } else if (draft.edges[id]) {
            draft.edges[id].direct_damage = true;
            if (repairTime !== undefined) draft.edges[id].expected_repair_time = repairTime;
          }
        }
        for (const [key, newVal] of Object.entries(event.attribute_mutations ?? {})) {
          const dotIdx = key.indexOf(".");
          if (dotIdx === -1) continue;
          const elementId = key.slice(0, dotIdx);
          const field = key.slice(dotIdx + 1);
          if (draft.nodes[elementId]) {
            (draft.nodes[elementId] as Record<string, unknown>)[field] = newVal;
            if (field === "functionality") draft.nodes[elementId].responsibility_share = eventCause;
          } else if (draft.edges[elementId]) {
            (draft.edges[elementId] as Record<string, unknown>)[field] = newVal;
            if (field === "functionality") draft.edges[elementId].responsibility_share = eventCause;
          }
        }
      });

      const after = get().toGraphSnapshot();

      useHistoryStore.getState().pushUpdateEntry({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        update_type: "event_applied",
        label: `Apply event: ${event.label}`,
        event_id: event.id,
        before,
        after,
        mutation_reversal: reversal,
      });
    },

    clearEvent() {
      const historyState = useHistoryStore.getState();
      const entry = historyState.updateHistory.find((h) => h.update_type === "event_applied");
      if (!entry) return false;

      if (entry.mutation_reversal && Object.keys(entry.mutation_reversal).length > 0) {
        set((draft) => {
          for (const [key, oldVal] of Object.entries(entry.mutation_reversal!)) {
            const dotIdx = key.indexOf(".");
            if (dotIdx === -1) continue;
            const elementId = key.slice(0, dotIdx);
            const field = key.slice(dotIdx + 1);
            if (draft.nodes[elementId]) {
              (draft.nodes[elementId] as Record<string, unknown>)[field] = oldVal;
            } else if (draft.edges[elementId]) {
              (draft.edges[elementId] as Record<string, unknown>)[field] = oldVal;
            }
          }
        });
      } else {
        get().restoreSnapshot(entry.before);
      }

      historyState.removeUpdateEntry(entry.id);
      historyState.clearRedoStack();
      return true;
    },

    // -------------------------------------------------------------------------
    // Cross-canvas node operations
    // -------------------------------------------------------------------------

    copyNodesToCanvas(nodeIds, targetCanvasId) {
      const state = get();
      if (!state.canvases[targetCanvasId]) return;
      const nodeSet = new Set(nodeIds);
      const internalEdgeIds = Object.values(state.edges)
        .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
        .map((e) => e.id);
      const before = state.toGraphSnapshot();
      set((draft) => {
        const target = draft.canvases[targetCanvasId];
        for (const id of nodeIds) {
          if (!target.graph.node_ids.includes(id)) target.graph.node_ids.push(id);
        }
        for (const id of internalEdgeIds) {
          if (!target.graph.edge_ids.includes(id)) target.graph.edge_ids.push(id);
        }
      });
      useHistoryStore.getState().pushUpdateEntry({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        update_type: "graph_update",
        label: `Copy ${nodeIds.length} node${nodeIds.length !== 1 ? "s" : ""} to canvas "${state.canvases[targetCanvasId]?.label ?? targetCanvasId}"`,
        before,
        after: get().toGraphSnapshot(),
      });
    },

    moveNodesToCanvas(nodeIds, sourceCanvasId, targetCanvasId) {
      const state = get();
      if (!state.canvases[sourceCanvasId] || !state.canvases[targetCanvasId]) return;
      const nodeSet = new Set(nodeIds);
      const internalEdgeIds = Object.values(state.edges)
        .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
        .map((e) => e.id);
      const internalEdgeSet = new Set(internalEdgeIds);
      const before = state.toGraphSnapshot();
      set((draft) => {
        const source = draft.canvases[sourceCanvasId];
        const target = draft.canvases[targetCanvasId];
        source.graph.node_ids = source.graph.node_ids.filter((id) => !nodeSet.has(id));
        source.graph.edge_ids = source.graph.edge_ids.filter((id) => !internalEdgeSet.has(id));
        for (const id of nodeIds) {
          if (!target.graph.node_ids.includes(id)) target.graph.node_ids.push(id);
        }
        for (const id of internalEdgeIds) {
          if (!target.graph.edge_ids.includes(id)) target.graph.edge_ids.push(id);
        }
      });
      useHistoryStore.getState().pushUpdateEntry({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        update_type: "graph_update",
        label: `Move ${nodeIds.length} node${nodeIds.length !== 1 ? "s" : ""} to canvas "${state.canvases[targetCanvasId]?.label ?? targetCanvasId}"`,
        before,
        after: get().toGraphSnapshot(),
      });
    },

    // -------------------------------------------------------------------------
    // Project meta
    // -------------------------------------------------------------------------

    setProjectMeta(meta) {
      set((state) => {
        if (meta.name !== undefined) state.projectMeta.name = meta.name;
        if (meta.description !== undefined) state.projectMeta.description = meta.description;
      });
    },

    setGlobalGraphType(graphType) {
      set((state) => {
        state.projectMeta.global_graph_type = graphType ?? undefined;
      });
    },

    // -------------------------------------------------------------------------
    // Serialisation
    // -------------------------------------------------------------------------

    toGraphSnapshot(): GraphSnapshot {
      const state = get();
      return {
        nodes: { ...state.nodes },
        edges: { ...state.edges },
        canvases: state.canvasOrder.map((id) => state.canvases[id]),
      };
    },

    toProject(): Project {
      const state = get();
      return {
        version: "2.0",
        meta: {
          name: state.projectMeta.name,
          description: state.projectMeta.description,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        global_graph_type: state.projectMeta.global_graph_type,
        nodes: { ...state.nodes },
        edges: { ...state.edges },
        canvases: state.canvasOrder.map((id) => state.canvases[id]),
        update_history: useHistoryStore.getState().updateHistory,
        scorecard: useScorecardStore.getState().scorecard,
      };
    },

    fromProject(project) {
      set((state) => {
        state.nodes = project.nodes ?? {};
        state.edges = project.edges ?? {};
        const canvases: Record<string, Canvas> = {};
        const canvasOrder: string[] = [];
        for (const canvas of project.canvases ?? []) {
          canvases[canvas.id] = canvas;
          canvasOrder.push(canvas.id);
        }
        state.canvases = canvases;
        state.canvasOrder = canvasOrder;
        state.activeCanvasId = canvasOrder[0] ?? null;
        state.projectMeta = {
          name: project.meta.name,
          description: project.meta.description,
          global_graph_type: project.global_graph_type,
        };
      });
      useHistoryStore.getState().loadHistory(project.update_history ?? []);
      useScorecardStore.getState().loadScorecard(project.scorecard ?? []);
    },

    loadProject(project) {
      get().fromProject(project);
    },

    reset() {
      set(() => ({ ...emptyState }));
      useHistoryStore.getState().reset();
      useScorecardStore.getState().reset();
    },
  })),
);

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

export const selectActiveCanvas = (state: CanvasStore): Canvas | null =>
  state.activeCanvasId ? (state.canvases[state.activeCanvasId] ?? null) : null;

export const selectActiveGraph = (state: CanvasStore): Graph | null =>
  selectActiveCanvas(state)?.graph ?? null;

/** Resolve the active Canvas's node_ids to actual Node objects. */
export const selectActiveNodes = (state: CanvasStore): Node[] => {
  const graph = selectActiveGraph(state);
  if (!graph) return [];
  return graph.node_ids.flatMap((id) => (state.nodes[id] ? [state.nodes[id]] : []));
};

/** Resolve the active Canvas's edge_ids to actual Edge objects. */
export const selectActiveEdges = (state: CanvasStore): Edge[] => {
  const graph = selectActiveGraph(state);
  if (!graph) return [];
  return graph.edge_ids.flatMap((id) => (state.edges[id] ? [state.edges[id]] : []));
};

export const selectOrderedCanvases = (state: CanvasStore): Canvas[] =>
  state.canvasOrder.map((id) => state.canvases[id]);

// Mark the project dirty whenever nodes, edges, or canvases change.
// Import is deferred to avoid a circular dependency at module load time.
if (typeof window !== "undefined") {
  let prev = useCanvasStore.getState();
  useCanvasStore.subscribe((state) => {
    if (state.nodes !== prev.nodes || state.edges !== prev.edges || state.canvases !== prev.canvases) {
      import("@/store/ui-store").then(({ useUiStore }) => {
        useUiStore.getState().markDirty();
      });
    }
    // An Element removal (undo/redo/clearEvent restore, or removeNode) can leave
    // network-store selection/hover pointing at IDs that no longer exist. Prune
    // them so "selection ⊆ existing Elements" holds. Only Element registries
    // matter here — canvases-only changes never remove Elements.
    if (state.nodes !== prev.nodes || state.edges !== prev.edges) {
      useNetworkStore.getState().reconcileToElements(state.nodes, state.edges);
    }
    prev = state;
  });
}
