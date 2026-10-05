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
import type { Timeline, TimelinePhase, TimelineStep } from "@/lib/timeline-plan";
import type { StockDraft } from "@/lib/stock-math";
import { EXPLAIN_INTRO, type Explanation } from "@/lib/temporal-simulation-explainers";

export type SimTab = "timeline" | "profile" | "run" | "metrics" | "stock";

export interface ProfileRowDraft {
  id: string;
  label: string;
  element: string;
  /** Comma-separated path, e.g. "supply_capacity, hours, rate". */
  path: string;
  op: "set" | "add" | "mul" | "at_most" | "at_least";
  value: string;
}

export interface MetricDraft {
  id: string;
  name: string;
  target: string;
  attribute: string;
  read: "state" | "change";
  phase: string;
  aggregate: "sum" | "mean" | "min" | "max" | "count" | "share_where" | "percentile";
  filter: string;
}

export interface StockPreview extends StockDraft {
  delivered: number;
  phi: number;
}

interface TemporalSimulationState {
  open: boolean;
  tab: SimTab;
  timeline: Timeline;
  profile: ProfileRowDraft[];
  metrics: MetricDraft[];
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
  updateProfile: (fn: (rows: ProfileRowDraft[]) => void) => void;
  updateMetrics: (fn: (rows: MetricDraft[]) => void) => void;
  updateStock: (patch: Partial<StockPreview>) => void;
  markRun: () => void;
  selectPeriod: (n: number | null) => void;
  setDisplay: (d: "functionality" | "level") => void;
  setLevelReading: (r: "level" | "change") => void;
}

export const newPhase = (propagate = true): TimelinePhase => ({ events: [], propagate });

export const newStep = (label: string): TimelineStep => ({
  label,
  unit: "month",
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
  every: [{ every: 3, phase: 1, events: [] }],
};

export const timelineKey = (t: Timeline) => JSON.stringify(t);

export const useTemporalSimulationStore = create<TemporalSimulationState>()(
  immer((set) => ({
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
    updateStock: (patch) => set((s) => { Object.assign(s.stock, patch); }),
    markRun: () => set((s) => { s.lastRunKey = timelineKey(s.timeline); s.selectedPeriod = 1; }),
    selectPeriod: (n) => set((s) => { s.selectedPeriod = n; }),
    setDisplay: (d) => set((s) => { s.display = d; }),
    setLevelReading: (r) => set((s) => { s.levelReading = r; }),
  })),
);
