/**
 * useHistoryAction — hook-style wrapper around `runWithHistory` (the single
 * seam for undoable mutations; see lib/run-with-history.ts).
 *
 * Usage:
 *   const historyAction = useHistoryAction();
 *   historyAction(() => updateNode(id, patch), "Manual functionality edit");
 *   historyAction(() => removeNode(id), "Delete node", "graph_update");
 */

import { useCallback } from "react";
import { runWithHistory } from "@/lib/run-with-history";

type UpdateType = "manual_functionality_update" | "graph_update";

export function useHistoryAction() {
  return useCallback(
    (
      updateFn: () => void,
      label: string,
      update_type: UpdateType = "manual_functionality_update",
    ) => {
      runWithHistory(updateFn, label, { updateType: update_type });
    },
    [],
  );
}
