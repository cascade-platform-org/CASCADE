/**
 * config-store.ts — Single source of truth for the ModelConfiguration.
 *
 * Holds the full configuration (functionality scale, categories, events,
 * graph-type algorithm pipelines) and a dirty flag so the Config modal can
 * warn before discarding unsaved edits.
 *
 * All mutations operate on a working draft (`draft`) so the user can cancel
 * changes. Calling `commitDraft()` replaces `config` with `draft` and clears
 * the dirty flag. Calling `discardDraft()` resets `draft` to `config`.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import { getEngineAlgorithms } from "@/lib/api-client";
import type {
  CategoryDefinition,
  EventDefinition,
  FunctionalityScaleLevel,
  GraphTypeConfig,
  HeuristicConfig,
  ModelConfiguration,
} from "@/lib/schemas";
import type { Node } from "@/lib/schemas/network";
import type { EngineAlgorithms } from "@/lib/schemas/api";

// ---------------------------------------------------------------------------
// Default configuration — N=3, no categories, no events
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: ModelConfiguration = {
  version: "1.0",
  meta: { name: "Default Config" },
  functionality_scale: [
    { level: 1, label: "critical",            color: "#ef4444" },
    { level: 2, label: "operational_warning", color: "#f97316" },
    { level: 3, label: "operational",         color: "#22c55e" },
  ],
  categories: [],
  events: [],
  graph_types: [],
  node_defaults: {},
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ConfigState {
  /** Committed configuration — the source of truth for the rest of the app. */
  config: ModelConfiguration;
  /**
   * Working draft — editable copy used by the Config modal.
   * Always initialised to a deep clone of `config` when the modal opens.
   */
  draft: ModelConfiguration;
  /** True when `draft` differs from `config`. */
  isDirty: boolean;
  /**
   * Cached response from GET /api/engine/algorithms.
   * Null = not yet fetched. Used by Config modal Tab 4 to render typed
   * parameter forms. Falls back to raw JSON textarea when null.
   */
  engineAlgorithms: EngineAlgorithms | null;
  /** "idle" | "loading" | "error" */
  engineAlgorithmsStatus: "idle" | "loading" | "error";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ConfigActions {
  // --- Draft lifecycle ---
  /** Reset draft to a fresh clone of the committed config (call when modal opens). */
  openDraft: () => void;
  /** Commit draft → config, clear dirty flag. */
  commitDraft: () => void;
  /** Discard draft, reset to committed config, clear dirty flag. */
  discardDraft: () => void;

  // --- Bulk load ---
  /** Replace the committed config wholesale (file upload / wizard). */
  loadConfig: (config: ModelConfiguration) => void;
  /**
   * Merge an incoming config INTO the committed one, rather than replacing it
   * (used when importing a network as an extra canvas into the current
   * project — requirements §13.5). Categories and graph_types are added only
   * when no entry of that name already exists (existing wins on a name
   * collision — surfaced in the returned summary so the caller can warn).
   * Events are added by id; if an event with that id already exists, its
   * `attribute_mutations` are unioned into the existing one instead of adding
   * a duplicate — this is what makes a shared scenario event (e.g. a
   * "Blackout" or "Running on Reserve" event spanning every merged network)
   * correctly cover every merged network's own elements. `functionality_scale`
   * is deliberately never touched — the existing project's own scale stays
   * authoritative; the caller is responsible for requesting the import build
   * its node/edge functionality values on that same scale size.
   */
  mergeConfig: (incoming: ModelConfiguration) => MergeConfigSummary;

  // --- Functionality scale (operate on draft) ---
  addScaleLevel: () => void;
  removeScaleLevel: (level: number) => void;
  updateScaleLevel: (level: number, patch: Partial<Omit<FunctionalityScaleLevel, "level">>) => void;
  reorderScaleLevels: (orderedLevels: number[]) => void;

  // --- Categories (operate on draft) ---
  addCategory: (category: CategoryDefinition) => void;
  removeCategory: (name: string) => void;
  updateCategory: (name: string, patch: Partial<CategoryDefinition>) => void;
  removeCategoryAt: (index: number) => void;
  updateCategoryAt: (index: number, patch: Partial<CategoryDefinition>) => void;

  // --- Events (operate on draft) ---
  addEvent: (event: Omit<EventDefinition, "id">) => string;
  removeEvent: (id: string) => void;
  updateEvent: (id: string, patch: Partial<EventDefinition>) => void;
  reorderEvents: (orderedIds: string[]) => void;

  // --- Graph types / algorithm pipelines (operate on draft) ---
  addGraphType: (name: string) => void;
  removeGraphType: (name: string) => void;
  updateGraphTypeName: (oldName: string, newName: string) => void;
  addAlgorithm: (graphTypeName: string, algorithm: HeuristicConfig) => void;
  removeAlgorithm: (graphTypeName: string, algorithmId: string) => void;
  updateAlgorithm: (graphTypeName: string, algorithmId: string, patch: Partial<HeuristicConfig>) => void;
  reorderAlgorithms: (graphTypeName: string, orderedIds: string[]) => void;

  // --- Node defaults (templates) ---
  addNodeDefault: (name: string) => void;
  removeNodeDefault: (name: string) => void;
  renameNodeDefault: (oldName: string, newName: string) => void;
  updateNodeDefault: (name: string, patch: Partial<Node>) => void;

  // --- Engine algorithms ---
  /**
   * Fetch GET /api/engine/algorithms and cache the result.
   * No-ops if already loading or successfully cached.
   * On network error sets status to "error" — UI falls back to raw JSON textarea.
   */
  fetchEngineAlgorithms: () => Promise<void>;

  // --- Selectors (read committed config) ---
  getFunctionalityN: () => number;
  getLevelByLabel: (label: string) => FunctionalityScaleLevel | undefined;
  getEventById: (id: string) => EventDefinition | undefined;
  getCategoryByName: (name: string) => CategoryDefinition | undefined;
  getGraphTypeConfig: (name: string) => GraphTypeConfig | undefined;
}

export type ConfigStore = ConfigState & ConfigActions;

/** Summary of a mergeConfig() call — enough for the caller to build a toast. */
export interface MergeConfigSummary {
  addedCategories: string[];
  skippedCategories: string[];
  addedGraphTypes: string[];
  skippedGraphTypes: string[];
  addedEvents: string[];
  /** Existing event ids whose attribute_mutations absorbed the incoming ones. */
  mergedEvents: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Recompute the dirty flag by comparing the working draft against the
 * committed config, honouring the invariant documented on `isDirty`
 * ("True when draft differs from config").
 *
 * We deliberately do NOT just set `isDirty = true`: mutation actions fire on
 * every field `onChange`, including no-op writes that echo back the value
 * already stored (re-selecting the current category type, a focus/blur or
 * autofill event re-emitting the existing name, etc.). Latching the flag to
 * true on those made the Config modal warn "Unsaved changes — discard?" even
 * when nothing had actually changed. A structural compare keeps the flag —
 * and the "unsaved" badge — truthful, and also clears it automatically when
 * an edit is manually reverted to its original value.
 *
 * Both objects are produced by `deepClone` (JSON round-trip) and mutated in
 * place by immer, so key insertion order is preserved and a JSON-string
 * compare is a sound equality test for this small config object.
 */
function recomputeDirty(state: ConfigState): void {
  state.isDirty = JSON.stringify(state.draft) !== JSON.stringify(state.config);
}

function draftGraphType(draft: ModelConfiguration, name: string): GraphTypeConfig | undefined {
  return draft.graph_types.find((gt) => gt.name === name);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useConfigStore = create<ConfigStore>()(
  immer((set, get) => ({
    config: DEFAULT_CONFIG,
    draft: deepClone(DEFAULT_CONFIG),
    isDirty: false,
    engineAlgorithms: null,
    engineAlgorithmsStatus: "idle",

    // -------------------------------------------------------------------------
    // Draft lifecycle
    // -------------------------------------------------------------------------

    openDraft() {
      set((state) => {
        state.draft = deepClone(state.config);
        state.isDirty = false;
      });
    },

    commitDraft() {
      set((state) => {
        state.config = deepClone(state.draft);
        state.isDirty = false;
      });
    },

    discardDraft() {
      set((state) => {
        state.draft = deepClone(state.config);
        state.isDirty = false;
      });
    },

    // -------------------------------------------------------------------------
    // Bulk load
    // -------------------------------------------------------------------------

    loadConfig(config) {
      set((state) => {
        state.config = config;
        state.draft = deepClone(config);
        state.isDirty = false;
      });
    },

    mergeConfig(incoming) {
      const summary: MergeConfigSummary = {
        addedCategories: [], skippedCategories: [],
        addedGraphTypes: [], skippedGraphTypes: [],
        addedEvents: [], mergedEvents: [],
      };
      set((state) => {
        for (const category of incoming.categories) {
          if (state.config.categories.some((c) => c.name === category.name)) {
            summary.skippedCategories.push(category.name);
          } else {
            state.config.categories.push(category);
            summary.addedCategories.push(category.name);
          }
        }
        for (const graphType of incoming.graph_types) {
          if (state.config.graph_types.some((g) => g.name === graphType.name)) {
            summary.skippedGraphTypes.push(graphType.name);
          } else {
            state.config.graph_types.push(graphType);
            summary.addedGraphTypes.push(graphType.name);
          }
        }
        for (const event of incoming.events) {
          const existing = state.config.events.find((e) => e.id === event.id);
          if (existing) {
            existing.attribute_mutations = {
              ...existing.attribute_mutations,
              ...event.attribute_mutations,
            };
            summary.mergedEvents.push(event.id);
          } else {
            state.config.events.push(event);
            summary.addedEvents.push(event.id);
          }
        }
        // functionality_scale intentionally untouched — see mergeConfig's doc.
        state.draft = deepClone(state.config);
        state.isDirty = false;
      });
      return summary;
    },

    // -------------------------------------------------------------------------
    // Functionality scale
    // -------------------------------------------------------------------------

    addScaleLevel() {
      set((state) => {
        const levels = state.draft.functionality_scale;
        const nextLevel = levels.length > 0 ? Math.max(...levels.map((l) => l.level)) + 1 : 1;
        levels.push({ level: nextLevel, label: `level_${nextLevel}`, color: "#94a3b8" });
        recomputeDirty(state);
      });
    },

    removeScaleLevel(level) {
      set((state) => {
        if (state.draft.functionality_scale.length <= 2) return; // min 2
        state.draft.functionality_scale = state.draft.functionality_scale.filter(
          (l) => l.level !== level,
        );
        recomputeDirty(state);
      });
    },

    updateScaleLevel(level, patch) {
      set((state) => {
        const entry = state.draft.functionality_scale.find((l) => l.level === level);
        if (!entry) return;
        Object.assign(entry, patch);
        recomputeDirty(state);
      });
    },

    reorderScaleLevels(orderedLevels) {
      set((state) => {
        const map = new Map(state.draft.functionality_scale.map((l) => [l.level, l]));
        state.draft.functionality_scale = orderedLevels.map((lvl) => map.get(lvl)!).filter(Boolean);
        recomputeDirty(state);
      });
    },

    // -------------------------------------------------------------------------
    // Categories
    // -------------------------------------------------------------------------

    addCategory(category) {
      set((state) => {
        state.draft.categories.push(category);
        recomputeDirty(state);
      });
    },

    removeCategory(name) {
      set((state) => {
        state.draft.categories = state.draft.categories.filter((c) => c.name !== name);
        recomputeDirty(state);
      });
    },

    updateCategory(name, patch) {
      set((state) => {
        const entry = state.draft.categories.find((c) => c.name === name);
        if (!entry) return;
        Object.assign(entry, patch);
        recomputeDirty(state);
      });
    },

    removeCategoryAt(index) {
      set((state) => {
        state.draft.categories.splice(index, 1);
        recomputeDirty(state);
      });
    },

    updateCategoryAt(index, patch) {
      set((state) => {
        const entry = state.draft.categories[index];
        if (!entry) return;
        Object.assign(entry, patch);
        recomputeDirty(state);
      });
    },

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    addEvent(event) {
      const id = nanoid();
      set((state) => {
        state.draft.events.push({ ...event, id });
        recomputeDirty(state);
      });
      return id;
    },

    removeEvent(id) {
      set((state) => {
        state.draft.events = state.draft.events.filter((e) => e.id !== id);
        recomputeDirty(state);
      });
    },

    updateEvent(id, patch) {
      set((state) => {
        const entry = state.draft.events.find((e) => e.id === id);
        if (!entry) return;
        Object.assign(entry, patch);
        recomputeDirty(state);
      });
    },

    reorderEvents(orderedIds) {
      set((state) => {
        const map = new Map(state.draft.events.map((e) => [e.id, e]));
        state.draft.events = orderedIds.map((id) => map.get(id)!).filter(Boolean);
        recomputeDirty(state);
      });
    },

    // -------------------------------------------------------------------------
    // Graph types / algorithm pipelines
    // -------------------------------------------------------------------------

    addGraphType(name) {
      set((state) => {
        if (state.draft.graph_types.some((gt) => gt.name === name)) return;
        state.draft.graph_types.push({ name, heuristics: [] });
        recomputeDirty(state);
      });
    },

    removeGraphType(name) {
      set((state) => {
        state.draft.graph_types = state.draft.graph_types.filter((gt) => gt.name !== name);
        recomputeDirty(state);
      });
    },

    updateGraphTypeName(oldName, newName) {
      set((state) => {
        const gt = draftGraphType(state.draft, oldName);
        if (!gt) return;
        gt.name = newName;
        recomputeDirty(state);
      });
    },

    addAlgorithm(graphTypeName, algorithm) {
      set((state) => {
        const gt = draftGraphType(state.draft, graphTypeName);
        if (!gt) return;
        gt.heuristics.push(algorithm);
        recomputeDirty(state);
      });
    },

    removeAlgorithm(graphTypeName, algorithmId) {
      set((state) => {
        const gt = draftGraphType(state.draft, graphTypeName);
        if (!gt) return;
        gt.heuristics = gt.heuristics.filter((h) => h.id !== algorithmId);
        recomputeDirty(state);
      });
    },

    updateAlgorithm(graphTypeName, algorithmId, patch) {
      set((state) => {
        const gt = draftGraphType(state.draft, graphTypeName);
        if (!gt) return;
        const alg = gt.heuristics.find((h) => h.id === algorithmId);
        if (!alg) return;
        Object.assign(alg, patch);
        recomputeDirty(state);
      });
    },

    reorderAlgorithms(graphTypeName, orderedIds) {
      set((state) => {
        const gt = draftGraphType(state.draft, graphTypeName);
        if (!gt) return;
        const map = new Map(gt.heuristics.map((h) => [h.id, h]));
        gt.heuristics = orderedIds.map((id) => map.get(id)!).filter(Boolean);
        recomputeDirty(state);
      });
    },

    // -------------------------------------------------------------------------
    // Node defaults (templates)
    // -------------------------------------------------------------------------

    addNodeDefault(name) {
      set((state) => {
        if (!state.draft.node_defaults) state.draft.node_defaults = {};
        state.draft.node_defaults[name] = {};
        recomputeDirty(state);
      });
    },

    removeNodeDefault(name) {
      set((state) => {
        if (state.draft.node_defaults) {
          delete state.draft.node_defaults[name];
          recomputeDirty(state);
        }
      });
    },

    renameNodeDefault(oldName, newName) {
      set((state) => {
        if (!state.draft.node_defaults || !newName.trim() || newName === oldName) return;
        const val = state.draft.node_defaults[oldName] ?? {};
        delete state.draft.node_defaults[oldName];
        state.draft.node_defaults[newName] = val;
        recomputeDirty(state);
      });
    },

    updateNodeDefault(name, patch) {
      set((state) => {
        if (!state.draft.node_defaults) state.draft.node_defaults = {};
        state.draft.node_defaults[name] = { ...state.draft.node_defaults[name], ...patch };
        recomputeDirty(state);
      });
    },

    // -------------------------------------------------------------------------
    // Engine algorithms
    // -------------------------------------------------------------------------

    async fetchEngineAlgorithms() {
      const { engineAlgorithmsStatus, engineAlgorithms } = get();
      if (engineAlgorithmsStatus === "loading" || engineAlgorithms !== null) return;
      set((state) => { state.engineAlgorithmsStatus = "loading"; });
      try {
        // Goes through api-client so the base URL (and, later, the auth
        // header) is defined in one place. The previous inline fetch used a
        // relative URL by default, which hit the Next.js server instead of
        // the backend.
        const algorithms = await getEngineAlgorithms();
        set((state) => {
          state.engineAlgorithms = algorithms;
          state.engineAlgorithmsStatus = "idle";
        });
      } catch {
        set((state) => { state.engineAlgorithmsStatus = "error"; });
      }
    },

    // -------------------------------------------------------------------------
    // Selectors (committed config)
    // -------------------------------------------------------------------------

    getFunctionalityN() {
      return get().config.functionality_scale.length;
    },

    getLevelByLabel(label) {
      return get().config.functionality_scale.find((l) => l.label === label);
    },

    getEventById(id) {
      return get().config.events.find((e) => e.id === id);
    },

    getCategoryByName(name) {
      return get().config.categories.find((c) => c.name === name);
    },

    getGraphTypeConfig(name) {
      return get().config.graph_types.find((gt) => gt.name === name);
    },
  })),
);

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

/** Functionality N — the maximum level (fully operational). */
export const selectN = (state: ConfigStore): number =>
  state.config.functionality_scale.length;

/** Ordered functionality levels from the committed config. */
export const selectScaleLevels = (state: ConfigStore): FunctionalityScaleLevel[] =>
  state.config.functionality_scale;

/** Color for a given functionality integer level. Falls back to gray. */
export const selectLevelColor = (level: number) => (state: ConfigStore): string =>
  state.config.functionality_scale.find((l) => l.level === level)?.color ?? "#94a3b8";

/** First 5 events shown in the Action Bar. */
export const selectActionBarEvents = (state: ConfigStore): EventDefinition[] =>
  state.config.events.slice(0, 5);

/** Events 6+ that overflow into the "More ▼" menu. */
export const selectOverflowEvents = (state: ConfigStore): EventDefinition[] =>
  state.config.events.slice(5);

/** All category definitions from the committed config. */
export const selectCategories = (state: ConfigStore): CategoryDefinition[] =>
  state.config.categories;
