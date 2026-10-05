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
import type { MetricEntry, ProfileEntry, SimulationDraft } from "@/lib/temporal-simulation-text";
import type { StockDraft } from "@/lib/stock-math";
import { EXPLAIN_INTRO, type Explanation } from "@/lib/temporal-simulation-explainers";

export type SimTab = "timeline" | "profile" | "run" | "metrics" | "stock" | "text";

export interface StockPreview extends StockDraft {
  delivered: number;
  phi: number;
}

interface TemporalSimulationState {
  open: boolean;
  tab: SimTab;
  timeline: Timeline;
  profile: ProfileEntry[];
  metrics: MetricEntry[];
  stock: StockPreview;
  /** Snapshot of the Timeline the last dry run planned; differs → stale. */
  lastRunKey: string | null;
  selectedPeriod: number | null;
  display: "functionality" | "level";
  levelReading: "level" | "change";
  explanation: Explanation;

  openWindow: () => void;
  closeWindow: () => void;
  setTab: (tab: SimTab) => void;
  explain: (e: Explanation) => void;
  updateTimeline: (fn: (t: Timeline) => void) => void;
  updateProfile: (fn: (rows: ProfileEntry[]) => void) => void;
  updateMetrics: (fn: (rows: MetricEntry[]) => void) => void;
  /** Replace the whole draft — the Text tab's Apply. */
  replaceDraft: (d: SimulationDraft) => void;
  updateStock: (patch: Partial<StockPreview>) => void;
  markRun: () => void;
  selectPeriod: (n: number | null) => void;
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

/** What a run depends on in the draft; a change after a run marks it stale. */
export const runKey = (s: { timeline: Timeline; profile: ProfileEntry[] }) =>
  JSON.stringify([s.timeline, s.profile.map((e) => [e.label, e.op])]);

export const useTemporalSimulationStore = create<TemporalSimulationState>()(
  immer((set, get) => ({
    open: false,
    tab: "timeline",
    timeline: EXAMPLE_TIMELINE,
    profile: [],
    metrics: [],
    stock: { rate: 160, level: -20, min: -50, delivered: 150, phi: 1 },
    lastRunKey: null,
    selectedPeriod: null,
    display: "functionality",
    levelReading: "level",
    explanation: EXPLAIN_INTRO,

    openWindow: () => set((s) => { s.open = true; s.explanation = EXPLAIN_INTRO; }),
    closeWindow: () => set((s) => { s.open = false; }),
    setTab: (tab) => set((s) => { s.tab = tab; }),
    explain: (e) => set((s) => { s.explanation = e; }),
    updateTimeline: (fn) => set((s) => { fn(s.timeline); }),
    updateProfile: (fn) => set((s) => { fn(s.profile); }),
    updateMetrics: (fn) => set((s) => { fn(s.metrics); }),
    replaceDraft: (d) => set((s) => { s.timeline = d.timeline; s.profile = d.profile; s.metrics = d.metrics; }),
    updateStock: (patch) => set((s) => { Object.assign(s.stock, patch); }),
    markRun: () => {
      // Keyed from the plain state: stringifying the immer draft would draft every nested object.
      const key = runKey(get());
      set((s) => { s.lastRunKey = key; s.selectedPeriod = 1; });
    },
    selectPeriod: (n) => set((s) => { s.selectedPeriod = n; }),
    setDisplay: (d) => set((s) => { s.display = d; }),
    setLevelReading: (r) => set((s) => { s.levelReading = r; }),
  })),
);
