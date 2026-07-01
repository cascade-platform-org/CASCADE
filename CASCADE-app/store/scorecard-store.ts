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
import type { ScorecardEntry } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface ScorecardState {
  /** Scorecard entries ordered by created_at ascending. */
  scorecard: ScorecardEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ScorecardActions {
  addScorecardEntry: (entry: ScorecardEntry) => void;
  updateScorecardEntry: (id: string, patch: Partial<ScorecardEntry>) => void;
  removeScorecardEntry: (id: string) => void;
  /** Bulk-load entries from a persisted Project (fromProject). */
  loadScorecard: (entries: ScorecardEntry[]) => void;
  reset: () => void;
}

export type ScorecardStore = ScorecardState & ScorecardActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const emptyState: ScorecardState = {
  scorecard: [],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useScorecardStore = create<ScorecardStore>()(
  immer((set) => ({
    ...emptyState,

    addScorecardEntry(entry) {
      set((state) => { state.scorecard.push(entry); });
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
      });
    },

    loadScorecard(entries) {
      set((state) => { state.scorecard = entries; });
    },

    reset() {
      set(() => ({ ...emptyState }));
    },
  })),
);
