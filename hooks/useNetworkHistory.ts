/**
 * useNetworkHistory — single entry point for undo/redo across all call sites.
 *
 * Wraps canvas-store's undo() / redo() so that neither action-bar nor
 * flow-canvas need to duplicate the "nothing to undo/redo" toast logic.
 */

import { useCallback } from "react";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export function useNetworkHistory() {
  const canUndo = useCanvasStore((s) => s.updateHistory.length > 0);
  const canRedo = useCanvasStore((s) => s.redoStack.length > 0);

  const undo = useCallback(() => {
    const undone = useCanvasStore.getState().undo();
    if (!undone) {
      useUiStore.getState().pushToast({
        message: "Nothing more to undo",
        variant: "info",
        durationMs: 2000,
      });
    }
  }, []);

  const redo = useCallback(() => {
    const redone = useCanvasStore.getState().redo();
    if (!redone) {
      useUiStore.getState().pushToast({
        message: "Nothing more to redo",
        variant: "info",
        durationMs: 2000,
      });
    }
  }, []);

  return { undo, redo, canUndo, canRedo };
}
