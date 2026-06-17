/**
 * useHistoryAction — wraps any mutation in a before/after snapshot pair and
 * pushes one undoable entry to the history store.
 *
 * Replaces the private `withHistory` helper that was buried in inspector.tsx.
 * Any component or hook that needs undo support imports this instead of
 * re-implementing the snapshot-wrap-push pattern.
 *
 * Usage:
 *   const historyAction = useHistoryAction();
 *   historyAction(() => updateNode(id, patch), "Manual functionality edit");
 *   historyAction(() => removeNode(id), "Delete node", "graph_update");
 */

import { useCallback } from "react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";

type UpdateType = "manual_functionality_update" | "graph_update";

export function useHistoryAction() {
  return useCallback(
    (
      updateFn: () => void,
      label: string,
      update_type: UpdateType = "manual_functionality_update",
    ) => {
      const store = useCanvasStore.getState();
      const before = store.toGraphSnapshot();
      updateFn();
      // Re-read via getState() so `after` reflects the committed state, not the
      // snapshot captured before updateFn ran.
      const after = useCanvasStore.getState().toGraphSnapshot();
      useHistoryStore.getState().pushUpdateEntry({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        update_type,
        label,
        canvas_id: store.activeCanvasId ?? "",
        before,
        after,
      });
    },
    [],
  );
}
