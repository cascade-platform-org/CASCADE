/**
 * useNetworkHistory — single entry point for undo/redo across all call sites.
 *
 * Wraps canvas-store's undo() / redo() so that neither action-bar nor
 * flow-canvas need to duplicate the "nothing to undo/redo" toast logic.
 * While a Temporal Simulation run is shown the model is read-only: the buttons
 * are disabled and canvas-store's refusal explains itself, so no "nothing to
 * undo" follows it.
 */

import { useCallback } from "react";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useUiStore } from "@/store/ui-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";

export function useNetworkHistory() {
  const running = useTemporalSimulationStore((s) => s.running);
  const canUndo = useHistoryStore((s) => s.updateHistory.length > 0) && !running;
  const canRedo = useHistoryStore((s) => s.redoStack.length > 0) && !running;

  const undo = useCallback(() => {
    const undone = useCanvasStore.getState().undo();
    if (!undone && !useTemporalSimulationStore.getState().running) {
      useUiStore.getState().pushToast({
        message: "Nothing more to undo",
        variant: "info",
        durationMs: 2000,
      });
    }
  }, []);

  const redo = useCallback(() => {
    const redone = useCanvasStore.getState().redo();
    if (!redone && !useTemporalSimulationStore.getState().running) {
      useUiStore.getState().pushToast({
        message: "Nothing more to redo",
        variant: "info",
        durationMs: 2000,
      });
    }
  }, []);

  return { undo, redo, canUndo, canRedo };
}
