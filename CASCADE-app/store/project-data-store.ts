/**
 * project-data-store.ts — the project's client data: its Series (ADR-0019,
 * revised 2026-10-12) and custom sheets (ADR-0023 §4a). Both are saved in the
 * project file through canvas-store's `toProject()`, like the Scorecard, and
 * neither reaches the engine (`buildPropagationPayload` leaves them out).
 */

import { create } from "zustand";
import { SeriesSchema, type Series } from "@/lib/schemas/series";
import { freshOperandName } from "@/lib/schemas/operand";
import type { CustomSheet } from "@/lib/schemas/custom-sheet";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { runWithSnapshots } from "@/lib/history-entry";

interface ProjectDataState {
  series: Series[];
  sheets: CustomSheet[];
  /** A loaded project's Series and custom sheets; none when it has none. */
  loadFromProject: (series: Series[] | undefined, sheets: CustomSheet[] | undefined) => void;
  /** A new empty Series with a fresh name; returns the name, or null while a run is shown. */
  addSeries: () => string | null;
  /** Replace the Series `name`; returns why not (schema, a run shown), or null when done. */
  setSeries: (name: string, next: Series) => string | null;
  /** Rename a Series and every Temporal Simulation's operations that read it. */
  renameSeries: (from: string, to: string) => string | null;
  removeSeries: (name: string) => string | null;
}

/** Series are model inputs: like the model, they are read-only while a run is shown (ADR-0019 §1). */
function locked(): string | null {
  const sim = useTemporalSimulationStore.getState();
  if (!sim.running) return null;
  sim.cueEndRun();
  return "A Temporal Simulation run is shown: End run to edit Series.";
}

export const useProjectDataStore = create<ProjectDataState>()((set, get) => {
/** A Series edit as one undo step (ADR-0017, revised 2026-10-19); a rename's references in the Temporal Simulations are in it. */
const recorded = <T>(label: string, write: () => T, coalesce?: "auto"): T =>
  runWithSnapshots(
    { model: () => ({ series: get().series, sheets: get().sheets, temporal_simulations: useTemporalSimulationStore.getState().simulations }) },
    write,
    label,
    { updateType: "model_update", ...(coalesce ? { coalesce } : {}) },
  );
return {
  series: [],
  sheets: [],
  loadFromProject: (series, sheets) => set({ series: series ?? [], sheets: sheets ?? [] }),
  addSeries: () => recorded("Add a Series", () => {
    if (locked()) return null;
    const name = freshOperandName("series", get().series.map((x) => x.name));
    set({ series: [...get().series, { name, rows: {} }] });
    return name;
  }),
  setSeries: (name, next) => recorded(`Edit Series ${name}`, () => {
    const why = locked();
    if (why) return why;
    const parsed = SeriesSchema.safeParse(next);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid Series";
    if (next.name !== name && get().series.some((x) => x.name === next.name)) return `a Series named ${next.name} exists`;
    set({ series: get().series.map((x) => (x.name === name ? parsed.data : x)) });
    return null;
  }, "auto"),
  renameSeries: (from, to) => recorded(`Rename Series ${from} to ${to}`, () => {
    const current = get().series.find((x) => x.name === from);
    if (!current) return `no Series ${from}`;
    if (from === to) return null;
    const why = get().setSeries(from, { ...current, name: to });
    if (why) return why;
    useTemporalSimulationStore.getState().renameSeriesReferences(from, to);
    return null;
  }),
  removeSeries: (name) => recorded(`Delete Series ${name}`, () => {
    const why = locked();
    if (why) return why;
    set({ series: get().series.filter((x) => x.name !== name) });
    return null;
  }),
};
});

// The project has unsaved changes whenever its Series or sheets change, as for an
// Element edit (canvas-store). Deferred import: ui-store is not needed at load.
if (typeof window !== "undefined") {
  useProjectDataStore.subscribe((state, prev) => {
    if (state.series !== prev.series || state.sheets !== prev.sheets) {
      void import("@/store/ui-store").then(({ useUiStore }) => useUiStore.getState().markDirty());
    }
  });
}
