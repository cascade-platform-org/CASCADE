/**
 * temporal-simulation-store.ts — state of the Temporal Simulation PROTOTYPE window.
 *
 * Ephemeral and local: the draft Timeline, profile and Metrics live only here
 * until the feature is built schema-first (ADR-0019). Nothing in this store
 * touches the canvas, the history or the engine. Every action also sets the
 * `explanation` the window shows, so the prototype reads as a walk-through of
 * the specification.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { CalendarUnit, Timeline, TimelinePhase, TimelineStep } from "@/lib/temporal-simulation-schema";
import type { MetricEntry, ProfileRow, SimulationDraft } from "@/lib/temporal-simulation-text";
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

export const newPhase = (propagate: boolean): TimelinePhase => ({ events: [], propagate });

export const newStep = (label: string, unit: CalendarUnit): TimelineStep => ({
  label,
  unit,
  repeat: 1,
  phases: [newPhase(true)],
});

const EXAMPLE_TIMELINE: Timeline = {
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

export const useTemporalSimulationStore = create<TemporalSimulationState>()(
  immer((set) => ({
    open: false,
    tab: "timeline",
    timeline: EXAMPLE_TIMELINE,
    profile: [],
    metrics: [],
    stock: { rate: 160, level: -20, min: -50, delivered: 150, phi: 1 },
    running: false,
    selectedPeriod: 1,
    display: "functionality",
    levelReading: "level",
    explanation: EXPLAIN_INTRO,

    openWindow: () => set((s) => { s.open = true; s.explanation = EXPLAIN_INTRO; }),
    closeWindow: () => set((s) => { s.open = false; }),
    setTab: (tab) => set((s) => { s.tab = tab; }),
    explain: (e) => set((s) => { s.explanation = e; }),
    // Definition writers: refused while a run is shown (ADR-0019 §1), whatever the caller.
    updateTimeline: (fn) => set((s) => { if (!s.running) fn(s.timeline); }),
    updateProfile: (fn) => set((s) => { if (!s.running) fn(s.profile); }),
    updateRow: (id, fn) => set((s) => {
      const row = s.running ? undefined : s.profile.find((r) => r.id === id);
      if (row) fn(row);
    }),
    writeCells: (id, cells) => set((s) => {
      const row = s.running ? undefined : s.profile.find((r) => r.id === id);
      if (row) for (const [label, value] of cells) { if (value === undefined) delete row.values[label]; else row.values[label] = value; }
    }),
    updateMetrics: (fn) => set((s) => { if (!s.running) fn(s.metrics); }),
    replaceDraft: (d) => set((s) => { if (!s.running) { s.timeline = d.timeline; s.profile = d.profile; s.metrics = d.metrics; } }),
    updateStock: (patch) => set((s) => { Object.assign(s.stock, patch); }),
    markRun: () => set((s) => { s.running = true; s.selectedPeriod = 1; }),
    endRun: () => set((s) => { s.running = false; s.display = "functionality"; }),
    selectPeriod: (n) => set((s) => { s.selectedPeriod = n; }),
    setDisplay: (d) => set((s) => { s.display = d; }),
    setLevelReading: (r) => set((s) => { s.levelReading = r; }),
  })),
);
