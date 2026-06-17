"use client";

import { useEffect, useRef } from "react";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { autosave, pushAutoSnapshot } from "@/lib/file-io";

const DEBOUNCE_MS = 2_000;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Continuously saves the current project to localStorage as a safety net.
 * Debounced so rapid edits (dragging nodes, typing labels) collapse into one write.
 *
 * Also pushes an automatic version-history snapshot every 5 minutes so the
 * history panel builds up without requiring an explicit download.
 *
 * update_history is stripped before any localStorage write: the undo stack
 * holds full graph snapshots that easily exhaust the localStorage quota on
 * larger projects. On restore the user gets their data back; the undo stack
 * restarts empty.
 */
export function useAutosave(): void {
  const lastSnapshotRef = useRef<number>(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const project = useCanvasStore.getState().toProject();
        const config = useConfigStore.getState().config;
        const slim = { project: { ...project, update_history: [] }, config };

        autosave(slim);

        const now = Date.now();
        if (now - lastSnapshotRef.current >= SNAPSHOT_INTERVAL_MS) {
          lastSnapshotRef.current = now;
          pushAutoSnapshot(slim);
        }
      }, DEBOUNCE_MS);
    }

    const unsubCanvas = useCanvasStore.subscribe(schedule);
    const unsubConfig = useConfigStore.subscribe(schedule);

    return () => {
      if (timer) clearTimeout(timer);
      unsubCanvas();
      unsubConfig();
    };
  }, []);
}
