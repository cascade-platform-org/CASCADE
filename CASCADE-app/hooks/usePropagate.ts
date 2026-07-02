"use client";

import { nanoid } from "nanoid";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useHistoryStore } from "@/store/history-store";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { postPropagate } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";

/**
 * Returns a stable `propagate` function that sends the current canvas state to
 * the engine and merges the result. Handles its own loading/error state via
 * ui-store. Safe to call concurrently — duplicate calls while `isPropagating`
 * is true are silently ignored.
 */
export function usePropagate() {
  const isPropagating = useUiStore((s) => s.isPropagating);
  const serverReachable = useUiStore((s) => s.serverReachable);
  const scope = useUiStore((s) => s.propagationScope);
  const setIsPropagating = useUiStore((s) => s.setIsPropagating);
  const pushToast = useUiStore((s) => s.pushToast);
  const openScorecardSaveDialog = useUiStore((s) => s.openScorecardSaveDialog);

  async function propagate(): Promise<boolean> {
    if (!serverReachable || isPropagating) return false;

    // Viewer/guest gate (backend also enforces via can_propagate).
    if (!useAuthStore.getState().hasPermission("can_propagate")) {
      pushToast({
        message: "Running the propagation engine requires an account. Sign in to continue.",
        variant: "warning",
        durationMs: 4000,
      });
      return false;
    }

    const canvasState = useCanvasStore.getState();
    const config = useConfigStore.getState().config;
    const activeCanvasId = canvasState.activeCanvasId;

    let payload;
    try {
      payload = buildPropagationPayload({
        project: canvasState.toProject(),
        config,
        scope,
        activeCanvasId,
      });
    } catch (err) {
      pushToast({
        message: `Cannot propagate: ${err instanceof Error ? err.message : String(err)}`,
        variant: "error",
        durationMs: 4000,
      });
      return false;
    }

    setIsPropagating(true);
    const before = canvasState.toGraphSnapshot();

    try {
      const result = await postPropagate(payload);

      canvasState.applyPropagationResult(result);

      const after = useCanvasStore.getState().toGraphSnapshot();
      useHistoryStore.getState().pushUpdateEntry({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        update_type: "propagation",
        label: `Propagation (${scope})`,
        scope,
        canvas_id: activeCanvasId ?? undefined,
        before,
        after,
      });

      const count = result.updates.length;
      const warnings = result.warnings ?? [];

      if (warnings.length > 0) {
        pushToast({
          message: `Propagation complete — ${count} element${count !== 1 ? "s" : ""} updated. ⚠ ${warnings[0]}`,
          variant: "warning",
          durationMs: 6000,
          action: { label: "Save to Scorecard", onClick: openScorecardSaveDialog },
        });
      } else {
        pushToast({
          message: count > 0
            ? `Propagation complete — ${count} element${count !== 1 ? "s" : ""} updated`
            : "Propagation complete — no changes",
          variant: "success",
          durationMs: 6000,
          action: { label: "Save to Scorecard", onClick: openScorecardSaveDialog },
        });
      }

      return true;
    } catch (err) {
      pushToast({
        message: `Propagation failed — ${err instanceof Error ? err.message : "unexpected error"}`,
        variant: "error",
        durationMs: 5000,
      });
      return false;
    } finally {
      setIsPropagating(false);
    }
  }

  return { propagate, isPropagating, serverReachable };
}
