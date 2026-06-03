/**
 * canvas-store.ts — Single source of truth for all graph data.
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
 * network-store.ts is intentionally thin: it holds UI selection state only.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  AnyUpdateEntry,
  Canvas,
  Edge,
  Graph,
  GraphSnapshot,
  Node,
  Project,
  ScorecardEntry,
} from "@/lib/schemas";
import type { ElementUpdate, PropagationResult, EventDefinition } from "@/lib/schemas";

const HISTORY_LIMIT = 20;

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
  /**
   * Ring buffer of Any Update entries, latest first.
   * CTRL+Z pops from this list.
   */
  updateHistory: AnyUpdateEntry[];
  /**
   * Ephemeral redo stack — populated by undo(), drained by redo(), cleared by
   * any new pushUpdateEntry(). Never persisted to the project file.
   */
  redoStack: AnyUpdateEntry[];
  /** Project-level metadata (name, description). */
  projectMeta: { name: string; description?: string };
  /** Saved Scorecard entries, ordered by created_at ascending. */
  scorecard: import("@/lib/schemas").ScorecardEntry[];
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
  updateCanvasMeta: (canvasId: string, patch: Partial<Pick<Canvas, "label" | "color" | "crs" | "georeferenced">>) => void;
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

  // --- Any Update history ---
  pushUpdateEntry: (entry: AnyUpdateEntry) => void;
  /** Pop the most recent update entry. Reads committed state before mutating — no proxy bug. */
  popUpdateEntry: () => AnyUpdateEntry | undefined;
  /** Remove a specific entry by id (used by event-clear). */
  removeUpdateEntry: (id: string) => void;
  /** Restore a GraphSnapshot (undo/redo). Touches only nodes/edges/canvases. */
  restoreSnapshot: (snapshot: GraphSnapshot) => void;
  /** Clear the ephemeral redo stack (call after any out-of-band history mutation). */
  clearRedoStack: () => void;
  /**
   * Undo the most recent Any Graph Update. Moves the entry to the redo stack and
   * restores the entry's `before` snapshot. Returns false when history is empty.
   */
  undo: () => boolean;
  /**
   * Redo the most recently undone Any Graph Update. Moves the entry back to the
   * undo history and restores the entry's `after` snapshot. Returns false when the
   * redo stack is empty.
   */
  redo: () => boolean;

  // --- Event application ---
  /**
   * Apply an EventDefinition to the graph:
   *   1. Captures pre-event values of all fields the event will touch.
   *   2. Applies vulnerability_level drops, direct_damage_effects, attribute_mutations.
   *   3. Pushes an event_applied history entry with mutation_reversal populated.
   * The caller supplies the event definition and the N scale value.
   */
  applyEvent: (event: import("@/lib/schemas").EventDefinition, n: number) => void;
  /**
   * Revert the most recent event_applied entry using mutation_reversal (field-by-field).
   * Falls back to full snapshot restore for legacy entries that predate mutation_reversal.
   * Removes the entry and clears the redo stack.
   * Returns false when no event_applied entry exists.
   */
  clearEvent: () => boolean;

  // --- Scorecard ---
  addScorecardEntry: (entry: ScorecardEntry) => void;
  updateScorecardEntry: (id: string, patch: Partial<ScorecardEntry>) => void;
  removeScorecardEntry: (id: string) => void;

  // --- Project meta ---
  setProjectMeta: (meta: { name?: string; description?: string }) => void;

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
  updateHistory: [],
  redoStack: [],
  projectMeta: { name: "Untitled Project" },
  scorecard: [],
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
        // Remove from all Canvas memberships
        for (const canvas of Object.values(state.canvases)) {
          canvas.graph.node_ids = canvas.graph.node_ids.filter((id) => id !== nodeId);
          // Also remove edges whose source/target was this node
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
        // Note: elements in the registry are NOT deleted — they may belong to other Canvases
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
    // Propagation result — update global registry directly by ID
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
    // Any Update history
    // -------------------------------------------------------------------------

    pushUpdateEntry(entry) {
      set((state) => {
        state.updateHistory.unshift(entry);
        if (state.updateHistory.length > HISTORY_LIMIT) {
          state.updateHistory.length = HISTORY_LIMIT;
        }
        // Any new action invalidates the redo stack.
        state.redoStack = [];
      });
    },

    popUpdateEntry() {
      // Read from the committed state BEFORE mutating — avoids the revoked Immer
      // proxy that would be returned if we read `state.updateHistory[0]` inside set().
      const entry = get().updateHistory[0];
      if (entry !== undefined) {
        set((state) => { state.updateHistory.splice(0, 1); });
      }
      return entry;
    },

    removeUpdateEntry(id) {
      set((state) => {
        const idx = state.updateHistory.findIndex((e) => e.id === id);
        if (idx !== -1) state.updateHistory.splice(idx, 1);
      });
    },

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

    clearRedoStack() {
      set((state) => { state.redoStack = []; });
    },

    undo() {
      // Read from committed state to get plain objects — no proxy involved.
      const current = get();
      const entry = current.updateHistory[0];
      if (!entry) return false;
      set((draft) => {
        draft.updateHistory.splice(0, 1);
        draft.redoStack.unshift(entry);
        if (draft.redoStack.length > HISTORY_LIMIT) {
          draft.redoStack.length = HISTORY_LIMIT;
        }
      });
      // restoreSnapshot calls set() internally; it reads get() for the canvas
      // membership check, so it always sees the post-splice state above.
      current.restoreSnapshot(entry.before);
      return true;
    },

    redo() {
      const current = get();
      const entry = current.redoStack[0];
      if (!entry) return false;
      set((draft) => {
        draft.redoStack.splice(0, 1);
        draft.updateHistory.unshift(entry);
        if (draft.updateHistory.length > HISTORY_LIMIT) {
          draft.updateHistory.length = HISTORY_LIMIT;
        }
        // Do NOT clear redoStack here — remaining entries must survive.
      });
      current.restoreSnapshot(entry.after);
      return true;
    },

    // -------------------------------------------------------------------------
    // Event application
    // -------------------------------------------------------------------------

    applyEvent(event: EventDefinition, n: number) {
      const state = get();
      const reversal: Record<string, unknown> = {};

      // Helper: record pre-event value and return the elementId if the element exists.
      function capture(elementId: string, field: string, value: unknown) {
        reversal[`${elementId}.${field}`] = value;
      }

      const allElements: Array<{ id: string; el: Node | Edge }> = [
        ...Object.values(state.nodes).map((el) => ({ id: el.id, el })),
        ...Object.values(state.edges).map((el) => ({ id: el.id, el })),
      ];

      // ── 0. Temporal Jump — advance functionality_time, expire if ≤ 0 ──
      const temporalExpired = new Map<string, { functionality: number; functionality_time: number }>();
      if (event.type === "temporal_jump") {
        const hours = event.duration_hours ?? 0;
        for (const { id, el } of allElements) {
          const ft = el.functionality_time ?? 0;
          if (ft <= 0) continue;
          capture(id, "functionality_time", ft);
          const newFt = ft - hours;
          if (newFt <= 0) {
            capture(id, "functionality", el.functionality);
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
          vuln.set(id, imposed);
        }
      }

      // ── 2. direct_damage_effects ──
      const damageEntries = Object.entries(event.direct_damage_effects ?? {});
      for (const [elementId, effect] of damageEntries) {
        const node = state.nodes[elementId];
        const edge = state.edges[elementId];
        const el: Node | Edge | undefined = node ?? edge;
        if (!el) continue;
        capture(elementId, "direct_damage", el.direct_damage ?? false);
        capture(elementId, "expected_repair_time", el.expected_repair_time ?? null);
      }

      // ── 3. attribute_mutations ──
      for (const [key, _newVal] of Object.entries(event.attribute_mutations ?? {})) {
        const dotIdx = key.indexOf(".");
        if (dotIdx === -1) continue;
        const elementId = key.slice(0, dotIdx);
        const field = key.slice(dotIdx + 1);
        const el: Node | Edge | undefined = state.nodes[elementId] ?? state.edges[elementId];
        if (!el) continue;
        // Capture current value (may be undefined if field didn't exist before).
        capture(elementId, field, (el as Record<string, unknown>)[field] ?? null);
      }

      // ── Apply everything ──
      const before = state.toGraphSnapshot();

      set((draft) => {
        // temporal jump: update functionality_time and expire elements
        for (const [id, { functionality, functionality_time }] of temporalExpired) {
          if (draft.nodes[id]) {
            draft.nodes[id].functionality_time = functionality_time;
            draft.nodes[id].functionality = functionality;
          } else if (draft.edges[id]) {
            draft.edges[id].functionality_time = functionality_time;
            draft.edges[id].functionality = functionality;
          }
        }
        // vulnerability drops
        for (const [id, imposed] of vuln) {
          if (draft.nodes[id]) draft.nodes[id].functionality = imposed;
          else if (draft.edges[id]) draft.edges[id].functionality = imposed;
        }
        // direct_damage_effects
        for (const [elementId, effect] of damageEntries) {
          if (draft.nodes[elementId]) {
            draft.nodes[elementId].direct_damage = true;
            draft.nodes[elementId].expected_repair_time = effect.expected_repair_time;
          } else if (draft.edges[elementId]) {
            draft.edges[elementId].direct_damage = true;
            draft.edges[elementId].expected_repair_time = effect.expected_repair_time;
          }
        }
        // attribute_mutations
        for (const [key, newVal] of Object.entries(event.attribute_mutations ?? {})) {
          const dotIdx = key.indexOf(".");
          if (dotIdx === -1) continue;
          const elementId = key.slice(0, dotIdx);
          const field = key.slice(dotIdx + 1);
          if (draft.nodes[elementId]) {
            (draft.nodes[elementId] as Record<string, unknown>)[field] = newVal;
          } else if (draft.edges[elementId]) {
            (draft.edges[elementId] as Record<string, unknown>)[field] = newVal;
          }
        }
      });

      const after = get().toGraphSnapshot();

      get().pushUpdateEntry({
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
      const state = get();
      const entry = state.updateHistory.find((h) => h.update_type === "event_applied");
      if (!entry) return false;

      if (entry.mutation_reversal && Object.keys(entry.mutation_reversal).length > 0) {
        // Surgical field-by-field revert: only touch the fields the event mutated.
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
        // Legacy fallback: full snapshot restore for entries without mutation_reversal.
        state.restoreSnapshot(entry.before);
      }

      state.removeUpdateEntry(entry.id);
      state.clearRedoStack();
      return true;
    },

    // -------------------------------------------------------------------------
    // Scorecard
    // -------------------------------------------------------------------------

    addScorecardEntry(entry) {
      set((state) => { state.scorecard.push(entry); });
    },

    updateScorecardEntry(id, patch) {
      set((state) => {
        const idx = state.scorecard.findIndex((e) => e.id === id);
        if (idx !== -1) Object.assign(state.scorecard[idx], patch);
      });
    },

    removeScorecardEntry(id) {
      set((state) => {
        const idx = state.scorecard.findIndex((e) => e.id === id);
        if (idx !== -1) state.scorecard.splice(idx, 1);
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

    setProjectMeta(meta) {
      set((state) => {
        if (meta.name !== undefined) state.projectMeta.name = meta.name;
        if (meta.description !== undefined) state.projectMeta.description = meta.description;
      });
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
        nodes: { ...state.nodes },
        edges: { ...state.edges },
        canvases: state.canvasOrder.map((id) => state.canvases[id]),
        update_history: state.updateHistory,
        scorecard: state.scorecard,
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
        state.updateHistory = project.update_history ?? [];
        state.scorecard = project.scorecard ?? [];
        // Redo stack is session-only — never restored from a project file.
        state.redoStack = [];
        state.projectMeta = {
          name: project.meta.name,
          description: project.meta.description,
        };
      });
    },

    loadProject(project) {
      get().fromProject(project);
    },

    reset() {
      set(() => ({ ...emptyState }));
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
