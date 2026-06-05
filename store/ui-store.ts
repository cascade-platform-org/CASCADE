/**
 * ui-store.ts — Ephemeral UI state that does not belong in canvas-store or config-store.
 *
 * Nothing here is persisted to the project file. All state resets on page load.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { GraphSnapshot } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PropagationScope = "local" | "global";

export type ActiveTool = "select" | "add-node" | "add-edge" | "pan" | "inter-canvas-edge";

export type ConfigModalTab =
  | "functionality-scale"
  | "categories"
  | "events"
  | "graph-types"
  | "node-defaults";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface UiState {
  // --- Propagation ---
  /** Scope for the next Propagate call. */
  propagationScope: PropagationScope;
  /** True while a Propagate request is in flight. */
  isPropagating: boolean;
  /** True when the propagation server is reachable (checked on mount and on demand). */
  serverReachable: boolean;

  // --- Global view ---
  /** When true the "All" tab is active — shows every canvas merged into one view. */
  globalViewActive: boolean;

  // --- Active tool ---
  activeTool: ActiveTool;

  // --- Config modal ---
  configModalOpen: boolean;
  configModalTab: ConfigModalTab;

  // --- File I/O panel ---
  fileIoPanelOpen: boolean;

  // --- Inter-canvas edge dialog ---
  interCanvasEdgeDialogOpen: boolean;
  /** Source node id pre-selected when the dialog opens. Null = user picks source. */
  interCanvasEdgeSourceNodeId: string | null;

  // --- Active Rules panel ---
  activeRulesPanelOpen: boolean;

  // --- Scorecard panel ---
  scorecardPanelOpen: boolean;
  /** When true, the Save-to-Scorecard dialog is open independently of the Scorecard panel. */
  scorecardSaveDialogOpen: boolean;

  // --- Inspector ---
  /** When false the inspector panel is fully collapsed. */
  inspectorOpen: boolean;

  // --- Category filter (MiniMap + canvas display) ---
  /** Null = no filter (show all). String = show only elements in this category. */
  activeCategoryFilter: string | null;

  // --- Last propagation warnings ---
  /**
   * Non-fatal warnings from the most recent PropagationResult.
   * Empty after a clean run. Persisted until the next Propagation clears them.
   * Includes "convergence not reached" when the engine timed out.
   */
  propagationWarnings: string[];

  // --- Toast / notification queue ---
  toasts: Toast[];

  // --- Temporal Jump ---
  /**
   * When true, applying a Temporal Jump automatically triggers a Propagation
   * using the current propagationScope. When false, only the client-side
   * functionality_time math runs (no engine call).
   */
  temporalAutoPropagate: boolean;
  /**
   * Graph state captured before the first temporal jump in the current session.
   * Non-null as soon as one jump has been applied. Cleared by revert or page reload.
   */
  temporalJumpRevertSnapshot: GraphSnapshot | null;
  /** Cumulative hours advanced by temporal jumps since the revert snapshot was saved. */
  temporalJumpElapsedHours: number;

  // --- Node template selection ---
  /** Key into config.node_defaults. Null = blank node (no template). */
  selectedNodeTemplate: string | null;

  // --- Unsaved changes ---
  hasUnsavedChanges: boolean;

  // --- Canvas screenshot ---
  /**
   * Registered by FlowCanvas on mount. Captures the current global canvas view
   * as a PNG data-URL. Null when no canvas is mounted.
   */
  captureCanvasFn: (() => Promise<string | undefined>) | null;
}

export interface Toast {
  id: string;
  message: string;
  /** Defaults to "info". */
  variant?: "info" | "success" | "warning" | "error";
  /** Auto-dismiss after ms. Undefined = persistent until dismissed. */
  durationMs?: number;
  /** Optional inline action button shown in the toast. */
  action?: { label: string; onClick: () => void };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface UiActions {
  // --- Propagation ---
  setPropagationScope: (scope: PropagationScope) => void;
  setIsPropagating: (value: boolean) => void;
  setServerReachable: (value: boolean) => void;

  // --- Global view ---
  setGlobalViewActive: (active: boolean) => void;

  // --- Active tool ---
  setActiveTool: (tool: ActiveTool) => void;

  // --- Config modal ---
  openConfigModal: (tab?: ConfigModalTab) => void;
  closeConfigModal: () => void;
  setConfigModalTab: (tab: ConfigModalTab) => void;

  // --- File I/O panel ---
  toggleFileIoPanel: () => void;
  closeFileIoPanel: () => void;

  // --- Inter-canvas edge dialog ---
  openInterCanvasEdgeDialog: (sourceNodeId?: string) => void;
  closeInterCanvasEdgeDialog: () => void;

  // --- Active Rules panel ---
  toggleActiveRulesPanel: () => void;
  closeActiveRulesPanel: () => void;

  // --- Scorecard panel ---
  toggleScorecardPanel: () => void;
  closeScorecardPanel: () => void;
  openScorecardSaveDialog: () => void;
  closeScorecardSaveDialog: () => void;

  // --- Inspector ---
  setInspectorOpen: (open: boolean) => void;

  // --- Category filter ---
  setActiveCategoryFilter: (category: string | null) => void;
  setPropagationWarnings: (warnings: string[]) => void;

  // --- Toasts ---
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  // --- Temporal Jump ---
  setTemporalAutoPropagate: (value: boolean) => void;
  /** Called before the first jump — saves the snapshot to enable revert. */
  saveTemporalRevertSnapshot: (snapshot: GraphSnapshot) => void;
  /** Adds hours to the elapsed counter after each jump. */
  addTemporalElapsedHours: (hours: number) => void;
  /** Clears both the revert snapshot and elapsed counter (after revert or manual reset). */
  clearTemporalJumpProgress: () => void;

  // --- Node template selection ---
  setSelectedNodeTemplate: (key: string | null) => void;

  // --- Unsaved changes ---
  markDirty: () => void;
  markSaved: () => void;

  // --- Canvas screenshot ---
  registerCaptureCanvas: (fn: () => Promise<string | undefined>) => void;
}

export type UiStore = UiState & UiActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: UiState = {
  propagationScope: "local",
  isPropagating: false,
  serverReachable: false,
  globalViewActive: false,
  activeTool: "select",
  configModalOpen: false,
  configModalTab: "functionality-scale",
  fileIoPanelOpen: false,
  interCanvasEdgeDialogOpen: false,
  interCanvasEdgeSourceNodeId: null,
  activeRulesPanelOpen: false,
  scorecardPanelOpen: false,
  scorecardSaveDialogOpen: false,
  temporalAutoPropagate: true,
  temporalJumpRevertSnapshot: null,
  temporalJumpElapsedHours: 0,
  inspectorOpen: false,
  activeCategoryFilter: null,
  propagationWarnings: [],
  toasts: [],
  captureCanvasFn: null,
  hasUnsavedChanges: false,
  selectedNodeTemplate: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let toastCounter = 0;

export const useUiStore = create<UiStore>()(
  immer((set) => ({
    ...initialState,

    // -------------------------------------------------------------------------
    // Propagation
    // -------------------------------------------------------------------------

    setPropagationScope(scope) {
      set((state) => { state.propagationScope = scope; });
    },

    setIsPropagating(value) {
      set((state) => { state.isPropagating = value; });
    },

    setServerReachable(value) {
      set((state) => { state.serverReachable = value; });
    },

    // -------------------------------------------------------------------------
    // Active tool
    // -------------------------------------------------------------------------

    setGlobalViewActive(active) {
      set((state) => { state.globalViewActive = active; });
    },

    setActiveTool(tool) {
      set((state) => { state.activeTool = tool; });
    },

    // -------------------------------------------------------------------------
    // Config modal
    // -------------------------------------------------------------------------

    openConfigModal(tab = "functionality-scale") {
      set((state) => {
        state.configModalOpen = true;
        state.configModalTab = tab;
      });
    },

    closeConfigModal() {
      set((state) => { state.configModalOpen = false; });
    },

    setConfigModalTab(tab) {
      set((state) => { state.configModalTab = tab; });
    },

    // -------------------------------------------------------------------------
    // File I/O panel
    // -------------------------------------------------------------------------

    toggleFileIoPanel() {
      set((state) => { state.fileIoPanelOpen = !state.fileIoPanelOpen; });
    },

    closeFileIoPanel() {
      set((state) => { state.fileIoPanelOpen = false; });
    },

    // -------------------------------------------------------------------------
    // Inter-canvas edge dialog
    // -------------------------------------------------------------------------

    openInterCanvasEdgeDialog(sourceNodeId) {
      set((state) => {
        state.interCanvasEdgeDialogOpen = true;
        state.interCanvasEdgeSourceNodeId = sourceNodeId ?? null;
      });
    },

    closeInterCanvasEdgeDialog() {
      set((state) => {
        state.interCanvasEdgeDialogOpen = false;
        state.interCanvasEdgeSourceNodeId = null;
      });
    },

    // -------------------------------------------------------------------------
    // Active Rules panel
    // -------------------------------------------------------------------------

    toggleActiveRulesPanel() {
      set((state) => { state.activeRulesPanelOpen = !state.activeRulesPanelOpen; });
    },

    closeActiveRulesPanel() {
      set((state) => { state.activeRulesPanelOpen = false; });
    },

    // -------------------------------------------------------------------------
    // Scorecard panel
    // -------------------------------------------------------------------------

    toggleScorecardPanel() {
      set((state) => { state.scorecardPanelOpen = !state.scorecardPanelOpen; });
    },

    closeScorecardPanel() {
      set((state) => { state.scorecardPanelOpen = false; });
    },

    openScorecardSaveDialog() {
      set((state) => { state.scorecardSaveDialogOpen = true; });
    },

    closeScorecardSaveDialog() {
      set((state) => { state.scorecardSaveDialogOpen = false; });
    },

    // -------------------------------------------------------------------------
    // Inspector
    // -------------------------------------------------------------------------

    setInspectorOpen(open) {
      set((state) => { state.inspectorOpen = open; });
    },

    // -------------------------------------------------------------------------
    // Category filter
    // -------------------------------------------------------------------------

    setActiveCategoryFilter(category) {
      set((state) => { state.activeCategoryFilter = category; });
    },

    setPropagationWarnings(warnings) {
      set((state) => { state.propagationWarnings = warnings; });
    },

    // -------------------------------------------------------------------------
    // Toasts
    // -------------------------------------------------------------------------

    pushToast(toast) {
      const id = `toast-${++toastCounter}`;
      set((state) => {
        state.toasts.push({ ...toast, id });
      });
    },

    dismissToast(id) {
      set((state) => {
        state.toasts = state.toasts.filter((t) => t.id !== id);
      });
    },

    // -------------------------------------------------------------------------
    // Canvas screenshot
    // -------------------------------------------------------------------------

    registerCaptureCanvas(fn) {
      // Immer cannot store functions in state — assign directly on the raw store object.
      useUiStore.setState({ captureCanvasFn: fn });
    },

    // -------------------------------------------------------------------------
    // Unsaved changes
    // -------------------------------------------------------------------------

    setTemporalAutoPropagate(value) {
      set((state) => { state.temporalAutoPropagate = value; });
    },

    saveTemporalRevertSnapshot(snapshot) {
      set((state) => { state.temporalJumpRevertSnapshot = snapshot; });
    },

    addTemporalElapsedHours(hours) {
      set((state) => { state.temporalJumpElapsedHours += hours; });
    },

    clearTemporalJumpProgress() {
      set((state) => {
        state.temporalJumpRevertSnapshot = null;
        state.temporalJumpElapsedHours = 0;
      });
    },

    setSelectedNodeTemplate(key) {
      set((state) => { state.selectedNodeTemplate = key; });
    },

    markDirty() {
      set((state) => { state.hasUnsavedChanges = true; });
    },

    markSaved() {
      set((state) => { state.hasUnsavedChanges = false; });
    },
  })),
);

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

export const selectPropagationScope = (state: UiStore): PropagationScope =>
  state.propagationScope;

export const selectActiveTool = (state: UiStore): ActiveTool =>
  state.activeTool;

export const selectConfigModalOpen = (state: UiStore): boolean =>
  state.configModalOpen;

export const selectServerReachable = (state: UiStore): boolean =>
  state.serverReachable;
