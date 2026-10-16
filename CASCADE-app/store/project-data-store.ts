/**
 * project-data-store.ts — the project's client data: its Series (ADR-0019,
 * revised 2026-10-12) and custom sheets (ADR-0023 §4a). Both are saved in the
 * project file through canvas-store's `toProject()`, like the Scorecard, and
 * neither reaches the engine (`buildPropagationPayload` leaves them out).
 */

import { create } from "zustand";
import type { Series } from "@/lib/schemas/series";
import type { CustomSheet } from "@/lib/schemas/custom-sheet";

interface ProjectDataState {
  series: Series[];
  sheets: CustomSheet[];
  /** A loaded project's Series and custom sheets; none when it has none. */
  loadFromProject: (series: Series[] | undefined, sheets: CustomSheet[] | undefined) => void;
}

export const useProjectDataStore = create<ProjectDataState>()((set) => ({
  series: [],
  sheets: [],
  loadFromProject: (series, sheets) => set({ series: series ?? [], sheets: sheets ?? [] }),
}));

// The project has unsaved changes whenever its Series or sheets change, as for an
// Element edit (canvas-store). Deferred import: ui-store is not needed at load.
if (typeof window !== "undefined") {
  useProjectDataStore.subscribe((state, prev) => {
    if (state.series !== prev.series || state.sheets !== prev.sheets) {
      void import("@/store/ui-store").then(({ useUiStore }) => useUiStore.getState().markDirty());
    }
  });
}
