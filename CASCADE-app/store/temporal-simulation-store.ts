/**
 * temporal-simulation-store.ts — the project's Temporal Simulation (ADR-0019)
 * and the window's state.
 *
 * Two forms of one definition. The DRAFT (`timeline`, `profile` rows, `metrics`)
 * is what the window edits: profile rows and Metric ids exist for the grid. The
 * SAVED document (`saved`) is what `Project.temporal_simulation` holds, so it
 * reaches file, autosave and sync through canvas-store's `toProject()`, like the
 * Scorecard. Every definition edit saves the draft into the project when it
 * passes the schema; otherwise `unsaved` says why and the project keeps its last
 * valid document. That rule keeps a half-written row from ever producing a
 * project file that would fail to load.
 *
 * A project without a Temporal Simulation shows a starter Timeline, saved on
 * its first edit. Nothing here touches the canvas, the history or the engine.
 * Every action also sets the `explanation` the window shows.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { current, type Draft } from "immer";
import { nanoid } from "nanoid";
import type { CalendarUnit, Timeline, Phase, Step, TemporalSimulation } from "@/lib/schemas/temporal-simulation";
import { checkDoc, docToDraft, draftToDoc, type MetricEntry, type ProfileRow, type SimulationDraft } from "@/lib/temporal-simulation-text";
import type { StockDraft } from "@/lib/stock-math";
import { EXPLAIN_INTRO, type Explanation } from "@/lib/temporal-simulation-explainers";

export type SimTab = "timeline" | "run" | "metrics" | "stock" | "text";

export interface StockPreview extends StockDraft {
  delivered: number;
  phi: number;
}

interface TemporalSimulationState {
  open: boolean;
  tab: SimTab;
  timeline: Timeline;
  profile: ProfileRow[];
  metrics: MetricEntry[];
  /** `Project.temporal_simulation`: the last draft that passed the schema; undefined until the first edit. */
  saved: TemporalSimulation | undefined;
  /** Why the draft is not saved into the project (schema errors); empty when it is. */
  unsaved: string[];
  stock: StockPreview;
  /** A run is shown (the Run View): every definition writer below is refused until End run. */
  running: boolean;
  /** The period the Run View shows; meaningful only while `running`. */
  selectedPeriod: number;
  display: "functionality" | "level";
  levelReading: "level" | "change";
  explanation: Explanation;

  openWindow: () => void;
  closeWindow: () => void;
  /** The project's document, or the starter when it has none (project load, new project). */
  loadFromProject: (doc: TemporalSimulation | undefined) => void;
  setTab: (tab: SimTab) => void;
  explain: (e: Explanation) => void;
  updateTimeline: (fn: (t: Timeline) => void) => void;
  updateProfile: (fn: (rows: ProfileRow[]) => void) => void;
  /** Change one profile row in place; an unknown id does nothing. */
  updateRow: (id: string, fn: (row: ProfileRow) => void) => void;
  /** Write cells of one row; undefined empties a cell. */
  writeCells: (id: string, cells: [label: string, value: ProfileRow["values"][string] | undefined][]) => void;
  updateMetrics: (fn: (rows: MetricEntry[]) => void) => void;
  /** Replace the whole draft — the Text tab's Apply. */
  replaceDraft: (d: SimulationDraft) => void;
  updateStock: (patch: Partial<StockPreview>) => void;
  markRun: () => void;
  endRun: () => void;
  selectPeriod: (n: number) => void;
  setDisplay: (d: "functionality" | "level") => void;
  setLevelReading: (r: "level" | "change") => void;
}

export const newPhase = (propagate: boolean): Phase => ({ events: [], propagate });

export const newStep = (label: string, unit: CalendarUnit): Step => ({
  label,
  unit,
  repeat: 1,
  phases: [newPhase(true)],
});

const STARTER_TIMELINE: Timeline = {
  name: "Example — one year, monthly, with a settlement Phase",
  steps: [
    {
      label: "2023-01",
      unit: "month",
      repeat: 12,
      phases: [newPhase(true), newPhase(false)],
    },
  ],
};

const starterDraft = (): SimulationDraft => ({ timeline: structuredClone(STARTER_TIMELINE), profile: [], metrics: [] });

type State = Draft<TemporalSimulationState>;

/** After a definition edit: save the draft into the project if it passes the schema, else say why not. */
function save(s: State) {
  const checked = checkDoc(draftToDoc(current(s)));
  if (checked.ok) {
    s.saved = checked.doc;
    s.unsaved = [];
  } else {
    s.unsaved = checked.errors;
  }
}

/** Run a definition edit, refused while a run is shown (ADR-0019 §1), whatever the caller. */
const editing = (fn: (s: State) => void) => (s: State) => {
  if (s.running) return;
  fn(s);
  save(s);
};

export const useTemporalSimulationStore = create<TemporalSimulationState>()(
  immer((set) => ({
    open: false,
    tab: "timeline",
    ...starterDraft(),
    saved: undefined,
    unsaved: [],
    stock: { rate: 160, level: -20, min: -50, delivered: 150, phi: 1 },
    running: false,
    selectedPeriod: 1,
    display: "functionality",
    levelReading: "level",
    explanation: EXPLAIN_INTRO,

    openWindow: () => set((s) => { s.open = true; s.explanation = EXPLAIN_INTRO; }),
    closeWindow: () => set((s) => { s.open = false; }),
    loadFromProject: (doc) => set((s) => {
      Object.assign(s, doc ? docToDraft(doc, nanoid) : starterDraft());
      s.saved = doc;
      s.unsaved = [];
      s.running = false;
      s.display = "functionality";
    }),
    setTab: (tab) => set((s) => { s.tab = tab; }),
    explain: (e) => set((s) => { s.explanation = e; }),
    // Definition writers.
    updateTimeline: (fn) => set(editing((s) => fn(s.timeline))),
    updateProfile: (fn) => set(editing((s) => fn(s.profile))),
    updateRow: (id, fn) => set(editing((s) => {
      const row = s.profile.find((r) => r.id === id);
      if (row) fn(row);
    })),
    writeCells: (id, cells) => set(editing((s) => {
      const row = s.profile.find((r) => r.id === id);
      if (row) for (const [label, value] of cells) { if (value === undefined) delete row.values[label]; else row.values[label] = value; }
    })),
    updateMetrics: (fn) => set(editing((s) => fn(s.metrics))),
    replaceDraft: (d) => set(editing((s) => { s.timeline = d.timeline; s.profile = d.profile; s.metrics = d.metrics; })),
    updateStock: (patch) => set((s) => { Object.assign(s.stock, patch); }),
    markRun: () => set((s) => { s.running = true; s.selectedPeriod = 1; }),
    endRun: () => set((s) => { s.running = false; s.display = "functionality"; }),
    selectPeriod: (n) => set((s) => { s.selectedPeriod = n; }),
    setDisplay: (d) => set((s) => { s.display = d; }),
    setLevelReading: (r) => set((s) => { s.levelReading = r; }),
  })),
);

// The project has unsaved changes whenever its document changes, as for an
// Element edit (canvas-store). Deferred import: ui-store is not needed at load.
if (typeof window !== "undefined") {
  useTemporalSimulationStore.subscribe((state, prev) => {
    if (state.saved !== prev.saved) {
      void import("@/store/ui-store").then(({ useUiStore }) => useUiStore.getState().markDirty());
    }
  });
}
