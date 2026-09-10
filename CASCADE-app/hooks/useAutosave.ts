"use client";

import { useEffect, useRef } from "react";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useHistoryStore } from "@/store/history-store";
import { useUiStore } from "@/store/ui-store";
import { autosave, pushAutoSnapshot } from "@/lib/file-io";
import { isWorkingCopyEnabled } from "@/lib/working-copy";
import { syncPutWorkingCopy } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";

/**
 * Idle delay before a save (ADR-0017). Ten seconds rather than the old two: the
 * write now carries `update_history`, and the point of an idle timer is to save
 * once the user has stopped, not to keep pace with them.
 */
const IDLE_MS = 10_000;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const FAILURE_TOAST_THRESHOLD = 3;

/**
 * Continuously saves the current project to localStorage as a safety net.
 *
 * Fires on **10 seconds of inactivity, and only when the content changed**.
 * Both halves are needed. The store subscription fires on writes that change
 * nothing serialisable — switching Canvas tab, or an `updateNode` patch equal to
 * what is already there — so a timer alone would rewrite the same bytes forever
 * on an untouched tab. Comparing the serialised bundle is cheap next to the
 * `localStorage.setItem` it avoids, and it is the same string that gets written.
 *
 * `update_history` is INCLUDED. It used to be stripped here, so undo was empty
 * after a crash; Graph Diffs (ADR-0017) made it small enough to keep, and
 * `autosave()` falls back to a history-free write only if the quota refuses.
 *
 * Also pushes an automatic version-history snapshot every 5 minutes so the
 * history panel builds up without requiring an explicit download, and — only
 * for a project the user has opted in — writes the server-side **Working Copy**
 * on the same idle tick.
 */
export function useAutosave(): void {
  const lastSnapshotRef = useRef<number>(0);
  const lastWrittenRef = useRef<string>("");
  const consecutiveFailuresRef = useRef<number>(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const bundle = {
          project: useCanvasStore.getState().toProject(),
          config: useConfigStore.getState().config,
        };

        // Timestamps in `meta` move on every toProject(), so they are excluded
        // from the comparison — otherwise nothing is ever "unchanged".
        const fingerprint = JSON.stringify({
          project: { ...bundle.project, meta: { ...bundle.project.meta, created_at: "", updated_at: "" } },
          config: bundle.config,
        });
        if (fingerprint === lastWrittenRef.current) return;

        const written = autosave(bundle);
        if (written > 0) {
          lastWrittenRef.current = fingerprint;
          consecutiveFailuresRef.current = 0;
        } else {
          consecutiveFailuresRef.current += 1;
          if (consecutiveFailuresRef.current === FAILURE_TOAST_THRESHOLD) {
            useUiStore.getState().pushToast({
              message: "Autosave is failing — your browser storage may be full. Download a backup to avoid losing work.",
              variant: "warning",
              durationMs: 10_000,
            });
          }
        }

        const now = Date.now();
        if (now - lastSnapshotRef.current >= SNAPSHOT_INTERVAL_MS) {
          lastSnapshotRef.current = now;
          pushAutoSnapshot(bundle);
        }

        // Server-side Working Copy (ADR-0017). Every condition is a gate the
        // user controls: they hold can_sync, they are signed in, and they
        // switched THIS project on — which is off by default (ADR-0007).
        const name = bundle.project.meta.name;
        if (useAuthStore.getState().hasPermission("can_sync") && isWorkingCopyEnabled(name)) {
          void syncPutWorkingCopy(name, bundle).catch(() => {
            // Offline or the server refused. The local autosave above already
            // succeeded, so the work is safe; a failed upload is not worth a
            // toast on a timer the user did not trigger.
          });
        }
      }, IDLE_MS);
    }

    const unsubCanvas = useCanvasStore.subscribe(schedule);
    const unsubConfig = useConfigStore.subscribe(schedule);
    // Undo, redo and Clear Event change the history without necessarily writing
    // to canvas-store in the same tick; the undo stack is part of what is saved
    // now, so those have to schedule a write too.
    const unsubHistory = useHistoryStore.subscribe(schedule);

    return () => {
      if (timer) clearTimeout(timer);
      unsubCanvas();
      unsubConfig();
      unsubHistory();
    };
  }, []);
}
