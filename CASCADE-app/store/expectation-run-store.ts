/**
 * expectation-run-store.ts — the session's Expectation results (ADR-0023).
 *
 * A result is computed on a copy of the model and never saved, like a
 * Temporal Simulation run: reopening a project means running its checks again.
 * Kept apart from project-data-store, which holds what the project file saves.
 */

import { create } from "zustand";
import type { ExpectationResult } from "@/lib/expectations";

interface ExpectationRunState {
  /** Expectation id → its latest result this session. */
  results: Record<string, ExpectationResult>;
  /** While checks compute: how many of how many are done. */
  progress: { done: number; total: number } | null;
  begin: (total: number) => void;
  record: (result: ExpectationResult) => void;
  finish: () => void;
  clear: () => void;
}

export const useExpectationRunStore = create<ExpectationRunState>()((set) => ({
  results: {},
  progress: null,
  begin: (total) => set({ progress: { done: 0, total } }),
  record: (result) =>
    set((s) => ({
      results: { ...s.results, [result.id]: result },
      progress: s.progress ? { ...s.progress, done: s.progress.done + 1 } : null,
    })),
  finish: () => set({ progress: null }),
  clear: () => set({ results: {}, progress: null }),
}));
