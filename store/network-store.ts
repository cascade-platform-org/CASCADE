/**
 * network-store.ts — UI selection and hover state for the active canvas.
 *
 * This store is intentionally thin: it holds no graph data of its own.
 * All node/edge data lives in canvas-store.ts. Components that need both
 * data and selection state should subscribe to both stores.
 *
 * Why a separate store?
 * Selection and hover state change at high frequency during user interaction
 * (every mousemove, every click). Keeping them isolated prevents canvas-store
 * subscribers (which do expensive graph renders) from re-rendering on every
 * pointer event.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

// Immer does not support Set/Map by default — enable the plugin once at module
// load time so all stores can use Sets in their state.
enableMapSet();

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface NetworkState {
  /** Ids of currently selected nodes. */
  selectedNodeIds: Set<string>;
  /** Ids of currently selected edges (intra- or inter-canvas). */
  selectedEdgeIds: Set<string>;
  /** The single element under the pointer, or null. */
  hoveredElementId: string | null;
  /** True while the user is drawing a new edge. */
  isAddingEdge: boolean;
  /** Source node id while isAddingEdge is true. */
  pendingEdgeSourceId: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface NetworkActions {
  // Selection
  selectNode: (nodeId: string, additive?: boolean) => void;
  selectEdge: (edgeId: string, additive?: boolean) => void;
  deselectNode: (nodeId: string) => void;
  deselectEdge: (edgeId: string) => void;
  selectAll: (nodeIds: string[], edgeIds: string[]) => void;
  clearSelection: () => void;
  /**
   * XOR-toggle a node into/out of the current selection.
   * Clears any selected edges first (selection is homogeneous: nodes OR edges, never both).
   */
  toggleNode: (nodeId: string) => void;
  /**
   * XOR-toggle an edge into/out of the current selection.
   * Clears any selected nodes first.
   */
  toggleEdge: (edgeId: string) => void;

  // Hover
  setHovered: (elementId: string | null) => void;

  // Edge drawing mode
  beginAddEdge: (sourceNodeId: string) => void;
  cancelAddEdge: () => void;
}

export type NetworkStore = NetworkState & NetworkActions;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNetworkStore = create<NetworkStore>()(
  immer((set) => ({
    selectedNodeIds: new Set(),
    selectedEdgeIds: new Set(),
    hoveredElementId: null,
    isAddingEdge: false,
    pendingEdgeSourceId: null,

    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------

    selectNode(nodeId, additive = false) {
      set((state) => {
        if (!additive) {
          state.selectedNodeIds = new Set([nodeId]);
          state.selectedEdgeIds = new Set();
        } else {
          state.selectedNodeIds.add(nodeId);
        }
      });
    },

    selectEdge(edgeId, additive = false) {
      set((state) => {
        if (!additive) {
          state.selectedEdgeIds = new Set([edgeId]);
          state.selectedNodeIds = new Set();
        } else {
          state.selectedEdgeIds.add(edgeId);
        }
      });
    },

    deselectNode(nodeId) {
      set((state) => {
        state.selectedNodeIds.delete(nodeId);
      });
    },

    deselectEdge(edgeId) {
      set((state) => {
        state.selectedEdgeIds.delete(edgeId);
      });
    },

    selectAll(nodeIds, edgeIds) {
      set((state) => {
        state.selectedNodeIds = new Set(nodeIds);
        state.selectedEdgeIds = new Set(edgeIds);
      });
    },

    clearSelection() {
      set((state) => {
        state.selectedNodeIds = new Set();
        state.selectedEdgeIds = new Set();
      });
    },

    toggleNode(nodeId) {
      set((state) => {
        state.selectedEdgeIds = new Set();
        if (state.selectedNodeIds.has(nodeId)) {
          state.selectedNodeIds.delete(nodeId);
        } else {
          state.selectedNodeIds.add(nodeId);
        }
      });
    },

    toggleEdge(edgeId) {
      set((state) => {
        state.selectedNodeIds = new Set();
        if (state.selectedEdgeIds.has(edgeId)) {
          state.selectedEdgeIds.delete(edgeId);
        } else {
          state.selectedEdgeIds.add(edgeId);
        }
      });
    },

    // -------------------------------------------------------------------------
    // Hover
    // -------------------------------------------------------------------------

    setHovered(elementId) {
      set((state) => {
        state.hoveredElementId = elementId;
      });
    },

    // -------------------------------------------------------------------------
    // Edge drawing mode
    // -------------------------------------------------------------------------

    beginAddEdge(sourceNodeId) {
      set((state) => {
        state.isAddingEdge = true;
        state.pendingEdgeSourceId = sourceNodeId;
      });
    },

    cancelAddEdge() {
      set((state) => {
        state.isAddingEdge = false;
        state.pendingEdgeSourceId = null;
      });
    },
  })),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectIsNodeSelected = (nodeId: string) => (state: NetworkStore) =>
  state.selectedNodeIds.has(nodeId);

export const selectIsEdgeSelected = (edgeId: string) => (state: NetworkStore) =>
  state.selectedEdgeIds.has(edgeId);

export const selectHasSelection = (state: NetworkStore) =>
  state.selectedNodeIds.size > 0 || state.selectedEdgeIds.size > 0;
