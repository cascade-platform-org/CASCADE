/**
 * history-store.ts — Any Graph Update history and ephemeral redo stack.
 *
 * Owns the updateHistory ring buffer and the session-only redoStack.
 * Has zero dependency on canvas-store or any other store — it is a pure
 * append/pop/restore data structure.
 *
 * undo() and redo() live in canvas-store because they must call
 * restoreSnapshot(), which writes to the element registry. Those actions
 * call useHistoryStore.getState() to read and mutate history entries.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AnyUpdateEntry } from "@/lib/schemas";

export const HISTORY_LIMIT = 20;

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface HistoryState {
  /** Ring buffer of Any Graph Update entries, latest first. Capped at HISTORY_LIMIT. */
  updateHistory: AnyUpdateEntry[];
  /**
   * Ephemeral redo stack — populated by undo(), drained by redo(), cleared by
   * any new pushUpdateEntry(). Never persisted to the project file.
   */
  redoStack: AnyUpdateEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface HistoryActions {
  pushUpdateEntry: (entry: AnyUpdateEntry) => void;
  /** Pop the most recent update entry. Returns the entry, or undefined if empty. */
  popUpdateEntry: () => AnyUpdateEntry | undefined;
  /** Remove a specific entry by id (used by event-clear). */
  removeUpdateEntry: (id: string) => void;
  /** Clear the ephemeral redo stack (call after any out-of-band history mutation). */
  clearRedoStack: () => void;
  /**
   * Move the top undo entry to the redo stack.
   * Returns the entry that was moved, or undefined if history is empty.
   * The caller (canvas-store undo()) must then call restoreSnapshot(entry.before).
   */
  shiftToRedo: () => AnyUpdateEntry | undefined;
  /**
   * Move the top redo entry back to the undo stack.
   * Returns the entry that was moved, or undefined if redo stack is empty.
   * The caller (canvas-store redo()) must then call restoreSnapshot(entry.after).
   */
  shiftFromRedo: () => AnyUpdateEntry | undefined;
  /** Bulk-load history from a persisted Project (fromProject). Clears redo stack. */
  loadHistory: (entries: AnyUpdateEntry[]) => void;
  reset: () => void;
}

export type HistoryStore = HistoryState & HistoryActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const emptyState: HistoryState = {
  updateHistory: [],
  redoStack: [],
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useHistoryStore = create<HistoryStore>()(
  immer((set, get) => ({
    ...emptyState,

    pushUpdateEntry(entry) {
      set((state) => {
        state.updateHistory.unshift(entry);
        if (state.updateHistory.length > HISTORY_LIMIT) {
          state.updateHistory.length = HISTORY_LIMIT;
        }
        state.redoStack = [];
      });
    },

    popUpdateEntry() {
      const entry = get().updateHistory[0];
      if (entry !== undefined) {
        set((state) => { state.updateHistory.splice(0, 1); });
      }
      return entry;
    },

    removeUpdateEntry(id) {
      set((state) => {
        const idx = state.updateHistory.findIndex((e) => e.id === id);
        if (idx !== -1) state.updateHistory.splice(idx, 1);
      });
    },

    clearRedoStack() {
      set((state) => { state.redoStack = []; });
    },

    shiftToRedo() {
      const entry = get().updateHistory[0];
      if (!entry) return undefined;
      set((state) => {
        state.updateHistory.splice(0, 1);
        state.redoStack.unshift(entry);
        if (state.redoStack.length > HISTORY_LIMIT) {
          state.redoStack.length = HISTORY_LIMIT;
        }
      });
      return entry;
    },

    shiftFromRedo() {
      const entry = get().redoStack[0];
      if (!entry) return undefined;
      set((state) => {
        state.redoStack.splice(0, 1);
        state.updateHistory.unshift(entry);
        if (state.updateHistory.length > HISTORY_LIMIT) {
          state.updateHistory.length = HISTORY_LIMIT;
        }
      });
      return entry;
    },

    loadHistory(entries) {
      set((state) => {
        state.updateHistory = entries;
        state.redoStack = [];
      });
    },

    reset() {
      set(() => ({ ...emptyState }));
    },
  })),
);
