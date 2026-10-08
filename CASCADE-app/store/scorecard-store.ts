/**
 * scorecard-store.ts — Persisted atlas of named Scenario snapshots.
 *
 * A Scorecard entry is explicitly saved by the user ("Save to Scorecard").
 * Nothing is auto-generated. Entries are ordered by created_at ascending.
 *
 * This store has zero coupling to the element registry or the history ring
 * buffer. It is serialised into Project.scorecard via canvas-store's
 * toProject() / fromProject().
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { GraphSnapshot, ScorecardEntry } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface ScorecardState {
  /** Scorecard entries ordered by created_at ascending. */
  scorecard: ScorecardEntry[];
  /**
   * `Project.scorecard_bases`: Temporal Simulation run starts, each shared by the
   * periods saved from that run (an entry's `base_id` + `diff`).
   */
  bases: Record<string, GraphSnapshot>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface ScorecardActions {
  addScorecardEntry: (entry: ScorecardEntry) => void;
  /** Add periods saved from one run, with the run's start state they diff against (kept once). */
  addSimulationPeriods: (baseId: string, base: GraphSnapshot, entries: ScorecardEntry[]) => void;
  updateScorecardEntry: (id: string, patch: Partial<ScorecardEntry>) => void;
  removeScorecardEntry: (id: string) => void;
  /** Bulk-load entries and bases from a persisted Project (fromProject). */
  loadScorecard: (entries: ScorecardEntry[], bases?: Record<string, GraphSnapshot>) => void;
  reset: () => void;
}

export type ScorecardStore = ScorecardState & ScorecardActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const emptyState: ScorecardState = {
  scorecard: [],
  bases: {},
};

/** Drop every base no entry refers to any more. */
function dropUnusedBases(state: ScorecardState) {
  const used = new Set(state.scorecard.flatMap((e) => (e.type === "temporal_simulation" && e.base_id !== undefined ? [e.base_id] : [])));
  for (const id of Object.keys(state.bases)) if (!used.has(id)) delete state.bases[id];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useScorecardStore = create<ScorecardStore>()(
  immer((set) => ({
    ...emptyState,

    addScorecardEntry(entry) {
      set((state) => { state.scorecard.push(entry); });
    },

    addSimulationPeriods(baseId, base, entries) {
      set((state) => {
        state.bases[baseId] ??= base;
        state.scorecard.push(...entries);
      });
    },

    updateScorecardEntry(id, patch) {
      set((state) => {
        const idx = state.scorecard.findIndex((e) => e.id === id);
        if (idx !== -1) Object.assign(state.scorecard[idx], patch);
      });
    },

    removeScorecardEntry(id) {
      set((state) => {
        const idx = state.scorecard.findIndex((e) => e.id === id);
        if (idx !== -1) state.scorecard.splice(idx, 1);
        dropUnusedBases(state);
      });
    },

    loadScorecard(entries, bases = {}) {
      set((state) => {
        state.scorecard = entries;
        state.bases = bases;
        dropUnusedBases(state);
      });
    },

    reset() {
      set(() => ({ ...emptyState }));
    },
  })),
);
