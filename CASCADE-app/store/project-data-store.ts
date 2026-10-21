/**
 * project-data-store.ts — the project's client data: its Series (ADR-0019,
 * revised 2026-10-12) and its Expectations (ADR-0023). They are saved in the project file through
 * canvas-store's `toProject()`, like the Scorecard, and never reach the engine
 * (`buildPropagationPayload` leaves them out).
 */

import { create } from "zustand";
import { SeriesSchema, type Series } from "@/lib/schemas/series";
import { ExpectationSchema, type Expectation } from "@/lib/schemas/expectation";
import { confirmed } from "@/lib/provenance";
import { freshOperandName } from "@/lib/schemas/operand";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { runWithSnapshots } from "@/lib/history-entry";

interface ProjectDataState {
  series: Series[];
  /** A loaded project's Series; none when it has none. */
  loadFromProject: (series: Series[] | undefined) => void;
  /** A new empty Series with a fresh name; returns the name, or null while a run is shown. */
  addSeries: () => string | null;
  /** Replace the Series `name`; returns why not (schema, a run shown), or null when done. */
  setSeries: (name: string, next: Series) => string | null;
  /** Rename a Series and every Temporal Simulation's operations that read it. */
  renameSeries: (from: string, to: string) => string | null;
  removeSeries: (name: string) => string | null;

  expectations: Expectation[];
  /** A loaded project's Expectations; none when it has none. */
  loadExpectations: (expectations: Expectation[] | undefined) => void;
  /** Add one, or replace the one with its id; returns why not (schema), or null when done. */
  putExpectation: (next: Expectation) => string | null;
  removeExpectation: (id: string) => void;
  /** The person agrees the statement is true of their system: its Provenance is confirmed. */
  confirmExpectation: (id: string) => void;
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
    { model: () => ({ series: get().series, temporal_simulations: useTemporalSimulationStore.getState().simulations }) },
    write,
    label,
    { updateType: "model_update", ...(coalesce ? { coalesce } : {}) },
  );
/** An Expectation edit as one undo step. Expectations are not model inputs, so a shown run does not lock them. */
const recordedExpectations = (label: string, write: () => void): void =>
  runWithSnapshots({ model: () => ({ expectations: get().expectations }) }, write, label, { updateType: "model_update" });
return {
  series: [],
  loadFromProject: (series) => set({ series: series ?? [] }),
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

  expectations: [],
  loadExpectations: (expectations) => set({ expectations: expectations ?? [] }),
  putExpectation: (next) => {
    const parsed = ExpectationSchema.safeParse(next);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid Expectation";
    const exists = get().expectations.some((x) => x.id === next.id);
    recordedExpectations(exists ? `Edit Expectation ${next.id}` : `Add Expectation ${next.id}`, () =>
      set({ expectations: exists ? get().expectations.map((x) => (x.id === next.id ? parsed.data : x)) : [...get().expectations, parsed.data] }),
    );
    return null;
  },
  removeExpectation: (id) =>
    recordedExpectations(`Delete Expectation ${id}`, () => set({ expectations: get().expectations.filter((x) => x.id !== id) })),
  confirmExpectation: (id) =>
    recordedExpectations(`Confirm Expectation ${id}`, () =>
      set({ expectations: get().expectations.map((x) => (x.id === id && x.provenance ? { ...x, provenance: confirmed(x.provenance) } : x)) }),
    ),
};
});

// The project has unsaved changes whenever its Series change, as for an
// Element edit (canvas-store). Deferred import: ui-store is not needed at load.
if (typeof window !== "undefined") {
  useProjectDataStore.subscribe((state, prev) => {
    if (state.series !== prev.series || state.expectations !== prev.expectations) {
      void import("@/store/ui-store").then(({ useUiStore }) => useUiStore.getState().markDirty());
    }
  });
}
