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
import { diffByteSize } from "@/lib/graph-diff";
import { baselineKey, deriveBaseline, foldDiff, sourceOf, type BaselineEntry, type ScenarioBaseline } from "@/lib/scenario-baseline";

export const HISTORY_LIMIT = 20;

/**
 * Companion bound to HISTORY_LIMIT, in bytes of serialised Graph Diff.
 *
 * A count alone is the wrong bound once entries are diffs rather than fixed-size
 * snapshots: twenty ordinary edits measure ~66 KB on the case-study network
 * (ADR-0017), but one bulk deletion can produce a single diff larger than all of
 * them. Entries are evicted past EITHER limit, which is what lets the history be
 * persisted everywhere instead of stripped from the small writes.
 */
export const HISTORY_BYTE_BUDGET = 1_000_000;

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface HistoryState {
  /** Ring buffer of Any Graph Update entries, latest first. Capped at HISTORY_LIMIT. */
  updateHistory: AnyUpdateEntry[];
  /**
   * Scenario Baseline entries whose Update has been evicted from the buffer
   * above (ADR-0016).
   *
   * The Baseline is otherwise DERIVED from `updateHistory`, so it self-corrects
   * through undo, redo and Clear Event with no second copy to keep in sync. This
   * is the one thing derivation cannot see: a scenario easily outlives twenty
   * Updates, and losing the ability to Reset because the user nudged twenty node
   * positions is the bug this exists to prevent. Oldest-evicted first, so it
   * folds ahead of everything still in the buffer.
   *
   * Never persisted: it is rebuilt from the loaded history on Project load.
   */
  retiredBaseline: BaselineEntry[];
  /**
   * Ephemeral redo stack — populated by undo(), drained by redo(), cleared by
   * any new pushUpdateEntry(). Never persisted to the project file.
   */
  redoStack: AnyUpdateEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface HistoryActions {
  pushUpdateEntry: (entry: AnyUpdateEntry) => void;
  /** The current Scenario Baseline, derived from history plus retired entries. */
  scenarioBaseline: () => ScenarioBaseline;
  /** Drop every retired entry — called by Reset, which ends the scenario. */
  clearRetiredBaseline: () => void;
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
  retiredBaseline: [],
};

/**
 * Trim `state.updateHistory` past either limit, retiring what leaves.
 *
 * Eviction takes from the TAIL (oldest), and the Baseline folds oldest-first, so
 * a retired entry's values are older than anything left in the buffer and win
 * under first-write-wins.
 *
 * During normal operation an evicted `scenario_reset` needs no special case:
 * Reset empties the retired map when it runs, so nothing older than it is ever
 * in there. But a project can be LOADED with an over-long history (`loadHistory`
 * evicts one on the way in), and there the accumulator is built from scratch —
 * so if a `scenario_reset` passes through eviction, everything retired before it
 * is a dead scenario and is dropped as the Reset goes by.
 */
function evict(state: HistoryState): void {
  // The retired map is built ONCE per call, not once per evicted entry: a single
  // bulk edit can push several entries out at the same time, and rebuilding the
  // whole map for each of them is O(retired × evicted) for no benefit.
  const retired = new Map<string, BaselineEntry>();
  for (const e of state.retiredBaseline) retired.set(baselineKey(e.id, e.field, e.key), e);
  let retiredChanged = false;

  const retire = (entry: AnyUpdateEntry) => {
    if (entry.update_type === "scenario_reset") {
      // Eviction is oldest-first, so everything folded so far predates this
      // Reset — a scenario it ended. Discard it and keep going: entries newer
      // than the Reset but still evicted DO belong to the live scenario.
      retired.clear();
      retiredChanged = true;
      return;
    }
    if (!entry.diff) return; // legacy entry: no field-level record to retire
    foldDiff(retired, entry.diff, sourceOf(entry));
    retiredChanged = true;
  };

  while (state.updateHistory.length > HISTORY_LIMIT) {
    const dropped = state.updateHistory.pop();
    if (dropped) retire(dropped);
  }
  let bytes = state.updateHistory.reduce((n, e) => n + (e.diff ? diffByteSize(e.diff) : 0), 0);
  // Always keep at least one entry: an undo stack of zero after a single huge
  // edit would be worse than briefly exceeding the budget.
  while (bytes > HISTORY_BYTE_BUDGET && state.updateHistory.length > 1) {
    const dropped = state.updateHistory.pop();
    if (dropped) {
      bytes -= dropped.diff ? diffByteSize(dropped.diff) : 0;
      retire(dropped);
    }
  }

  if (retiredChanged) state.retiredBaseline = [...retired.values()];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useHistoryStore = create<HistoryStore>()(
  immer((set, get) => ({
    ...emptyState,

    pushUpdateEntry(entry) {
      set((state) => {
        state.updateHistory.unshift(entry);
        evict(state);
        state.redoStack = [];
      });
    },

    scenarioBaseline() {
      const { updateHistory, retiredBaseline } = get();
      return deriveBaseline(updateHistory, retiredBaseline);
    },

    clearRetiredBaseline() {
      set((state) => { state.retiredBaseline = []; });
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
        // No eviction on the way out: undo REMOVES an Update, so its writes are
        // no longer in the graph and must not be retired as if they were.
      });
      return entry;
    },

    shiftFromRedo() {
      const entry = get().redoStack[0];
      if (!entry) return undefined;
      set((state) => {
        state.redoStack.splice(0, 1);
        state.updateHistory.unshift(entry);
        evict(state);
      });
      return entry;
    },

    loadHistory(entries) {
      set((state) => {
        state.updateHistory = entries;
        state.redoStack = [];
        // The loaded history IS the Scenario Baseline's source (ADR-0016): a
        // project may ship mid-scenario, and Reset has to reach behind whatever
        // the file already had applied. Nothing is retired yet.
        state.retiredBaseline = [];
        evict(state);
      });
    },

    reset() {
      set(() => ({ ...emptyState }));
    },
  })),
);
