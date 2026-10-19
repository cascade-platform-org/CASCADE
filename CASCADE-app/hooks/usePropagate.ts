"use client";

import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { commitPropagation, propagationBlocked } from "@/lib/propagation-call";

/**
 * Why a Propagation cannot run right now, or null — re-rendering when the
 * server or the account changes. Every control that calls the engine
 * (Propagate, Run, Compare, Analyse, the Scorecard's Compute) is disabled by
 * this one rule (`propagationBlocked` in lib/propagation-call.ts).
 */
export function usePropagationGate(): string | null {
  const serverReachable = useUiStore((s) => s.serverReachable);
  const canPropagate = useAuthStore((s) => s.hasPermission("can_propagate"));
  return propagationBlocked({ serverReachable, canPropagate });
}

/**
 * The Propagate button: `commitPropagation` does the work; this words the
 * outcome as a toast. Returns whether the Propagation ran. A call while one is
 * already in flight is ignored.
 */
export function usePropagate() {
  const isPropagating = useUiStore((s) => s.isPropagating);
  const pushToast = useUiStore((s) => s.pushToast);
  const openScorecardSaveDialog = useUiStore((s) => s.openScorecardSaveDialog);

  async function propagate(): Promise<boolean> {
    const outcome = await commitPropagation();
    switch (outcome.status) {
      case "busy":
        return false;
      case "refused":
        pushToast({ message: outcome.message, variant: "warning", durationMs: 4000 });
        return false;
      case "failed":
        pushToast({ message: outcome.message, variant: "error", durationMs: 5000 });
        return false;
      case "done": {
        const { updated, warnings } = outcome;
        const elements = `${updated} element${updated !== 1 ? "s" : ""} updated`;
        pushToast({
          message: warnings.length > 0
            ? `Propagation complete — ${elements}. ⚠ ${warnings[0]}`
            : updated > 0 ? `Propagation complete — ${elements}` : "Propagation complete — no changes",
          variant: warnings.length > 0 ? "warning" : "success",
          durationMs: 6000,
          action: { label: "Save to Scorecard", onClick: openScorecardSaveDialog },
        });
        return true;
      }
    }
  }

  return { propagate, isPropagating };
}
