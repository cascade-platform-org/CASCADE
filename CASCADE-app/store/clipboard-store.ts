/**
 * Clipboard store — transient session state for copy/paste of nodes and edges.
 *
 * Never persisted to file or server; lives only in memory for the current
 * browser session. The store is intentionally separate from network-store
 * because clipboard state is orthogonal to project state: it survives canvas
 * switches and undo/redo, but is discarded on page reload.
 *
 * Copy:
 *   Capture a selection of nodes and the edges whose both endpoints are inside
 *   that selection. Edges that cross the selection boundary are excluded (they
 *   would reference a node that doesn't exist in the paste target).
 *
 * Paste:
 *   The caller (useNetworkActions) is responsible for:
 *     1. Generating new IDs for all copied nodes and edges.
 *     2. Offsetting positions by a fixed delta so the paste is visible.
 *     3. Remapping edge.source / edge.target to the new IDs.
 *     4. Warning the user if origin_canvas_id differs from the current canvas.
 */

import { create } from "zustand";
import type { Node, Edge } from "../lib/schemas/network";

interface ClipboardContents {
  nodes: Node[];
  /**
   * Only edges where both source and target IDs are present in `nodes`.
   * Cross-selection edges are excluded at copy time.
   */
  edges: Edge[];
  /** Canvas the content was copied from. Informational — paste is always allowed. */
  origin_canvas_id: string;
  /** ISO 8601 UTC. Informational — the clipboard has no expiry. */
  copied_at: string;
}

interface ClipboardState {
  contents: ClipboardContents | null;
  copy: (nodes: Node[], edges: Edge[], canvas_id: string) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  contents: null,

  copy(nodes, edges, canvas_id) {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    set({
      contents: {
        nodes,
        edges: internalEdges,
        origin_canvas_id: canvas_id,
        copied_at: new Date().toISOString(),
      },
    });
  },

  clear() {
    set({ contents: null });
  },
}));
