/**
 * ui-store.ts — Ephemeral UI state that does not belong in canvas-store or config-store.
 *
 * Nothing here is persisted to the project file. All state resets on page load.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { GraphSnapshot } from "@/lib/schemas/network";
import { useNetworkStore } from "@/store/network-store";

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
  /** Layout for the global view. "merged" = flat editable canvas (default); "grouped" = read-only coloured boxes. */
  globalViewLayout: "merged" | "grouped";

  // --- Active tool ---
  activeTool: ActiveTool;

  // --- Config modal ---
  configModalOpen: boolean;
  configModalTab: ConfigModalTab;

  // --- File I/O panel ---
  fileIoPanelOpen: boolean;

  /**
   * Set by the File panel's "New Project" button; cleared by `app/page.tsx`
   * once it has acted on it. A page-level app-state transition (editor ↔
   * wizard) lives above every store, so this is the one-shot signal that
   * crosses that boundary — the File panel cannot call `setAppState` directly,
   * and threading the setter down through props would tie `EditorShell` to a
   * transition that is really `app/page.tsx`'s to own.
   */
  newProjectRequested: boolean;

  // --- Inter-canvas edge dialog ---
  interCanvasEdgeDialogOpen: boolean;
  /** Source node id pre-selected when the dialog opens. Null = user picks source. */
  interCanvasEdgeSourceNodeId: string | null;

  // --- Active Rules panel ---
  activeRulesPanelOpen: boolean;
  /**
   * Set when the panel is opened by something that means "I want to write a
   * rule" (the Inspector's Add rule), rather than "show me the rules". The
   * panel consumes it once on mount to open its compose form pre-targeted at
   * the selection, then clears it.
   */
  rulesComposeRequested: boolean;
  /**
   * True for a moment after the panel closes, so the Status Bar control it
   * flew back into can flash. The animation says where the panel went; this
   * says "and here is the thing that brings it back".
   */
  rulesAnchorFlash: boolean;

  // --- Rules Manual panel ---
  rulesManualPanelOpen: boolean;

  // --- User Manual panel ---
  userManualPanelOpen: boolean;

  // --- Guided tour ---
  /** Id of the running tour, or null. Only "first-run" exists today. */
  activeTour: string | null;

  // --- Scorecard panel ---
  scorecardPanelOpen: boolean;
  /** When true, the Save-to-Scorecard dialog is open independently of the Scorecard panel. */
  scorecardSaveDialogOpen: boolean;

  // --- Situation window ---
  /**
   * The `event_applied` history entry id the user has dismissed the floating
   * Situation window for. The window reappears automatically when a newer Event
   * (a different entry id) is applied.
   */
  dismissedSituationId: string | null;

  // --- Intervention prioritisation panel ---
  interventionPanelOpen: boolean;

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
  /**
   * Newest history entry id at the moment that snapshot was taken — the point
   * the reverted jumps begin at. Recorded on the revert's history entry so the
   * Situation can be derived as the one that was live before the jumps.
   */
  temporalJumpRevertFromEntryId: string | null;

  // --- Node template selection ---
  /** Key into config.node_defaults. Null = blank node (no template). */
  selectedNodeTemplate: string | null;

  // --- Attribute scan panel ---
  attributeScanPanelOpen: boolean;

  // --- Programmatic canvas focus ---
  /**
   * When set, FlowCanvas / MergedViewCanvas will call fitView on this node and
   * then clear the field. Used by panels outside the ReactFlow provider tree.
   */
  pendingFocusNodeId: string | null;
  /**
   * One-shot request to frame the whole network. Set by anything that changes
   * what is on screen from outside the ReactFlow tree — a tour loading its
   * sample, above all — because a viewport fitted on one screen size is cut off
   * on a smaller one, and until now nothing re-fitted it.
   */
  fitViewRequested: boolean;

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
  setGlobalViewLayout: (layout: "merged" | "grouped") => void;

  // --- Active tool ---
  setActiveTool: (tool: ActiveTool) => void;

  // --- Config modal ---
  openConfigModal: (tab?: ConfigModalTab) => void;
  closeConfigModal: () => void;
  setConfigModalTab: (tab: ConfigModalTab) => void;

  // --- File I/O panel ---
  toggleFileIoPanel: () => void;
  closeFileIoPanel: () => void;
  requestNewProject: () => void;
  clearNewProjectRequest: () => void;

  // --- Inter-canvas edge dialog ---
  openInterCanvasEdgeDialog: (sourceNodeId?: string) => void;
  closeInterCanvasEdgeDialog: () => void;

  // --- Active Rules panel ---
  toggleActiveRulesPanel: () => void;
  closeActiveRulesPanel: () => void;
  /** Open the panel straight into its compose form (Inspector → "Add rule"). */
  openRuleComposer: () => void;
  clearRulesComposeRequest: () => void;
  clearRulesAnchorFlash: () => void;

  // --- Rules Manual panel ---
  toggleRulesManualPanel: () => void;
  openRulesManualPanel: () => void;
  closeRulesManualPanel: () => void;
  toggleUserManualPanel: () => void;
  closeUserManualPanel: () => void;
  startTour: (id: string) => void;
  endTour: () => void;

  // --- Scorecard panel ---
  toggleScorecardPanel: () => void;
  closeScorecardPanel: () => void;
  openScorecardSaveDialog: () => void;
  closeScorecardSaveDialog: () => void;

  // --- Situation window ---
  dismissSituation: (eventEntryId: string) => void;

  // --- Intervention panel ---
  toggleInterventionPanel: () => void;
  closeInterventionPanel: () => void;

  // --- Attribute scan panel ---
  toggleAttributeScanPanel: () => void;
  closeAttributeScanPanel: () => void;

  // --- Programmatic canvas focus ---
  requestFocusNode: (id: string) => void;
  clearFocusNode: () => void;
  requestFitView: () => void;
  clearFitViewRequest: () => void;

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
  /**
   * Called before the first jump — saves the snapshot to enable revert.
   * `fromEntryId` is the newest history entry at that moment (null when history
   * is empty); the revert records it so the Situation can be rewound with it.
   */
  saveTemporalRevertSnapshot: (snapshot: GraphSnapshot, fromEntryId: string | null) => void;
  /** Adds hours to the elapsed counter after each jump. */
  addTemporalElapsedHours: (hours: number) => void;
  /**
   * Give back hours from a Temporal Jump that has left the scenario — Ctrl+R can
   * clear a jump, because a jump IS an Event (ADR-0016). Reaching zero drops the
   * revert snapshot too: it was taken before jumps that no longer exist, so the
   * −Xh button would otherwise offer to rewind into a dead scenario.
   */
  dropTemporalElapsedHours: (hours: number) => void;
  /** Clears both the revert snapshot and elapsed counter (after revert or manual reset). */
  clearTemporalJumpProgress: () => void;

  // --- Node template selection ---
  setSelectedNodeTemplate: (key: string | null) => void;

  // --- Unsaved changes ---
  markDirty: () => void;
  markSaved: () => void;

  // --- Canvas screenshot ---
  registerCaptureCanvas: (fn: (() => Promise<string | undefined>) | null) => void;
}

export type UiStore = UiState & UiActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: UiState = {
  propagationScope: "global",
  isPropagating: false,
  serverReachable: false,
  globalViewActive: false,
  globalViewLayout: "merged",
  activeTool: "select",
  configModalOpen: false,
  configModalTab: "functionality-scale",
  fileIoPanelOpen: false,
  newProjectRequested: false,
  interCanvasEdgeDialogOpen: false,
  interCanvasEdgeSourceNodeId: null,
  activeRulesPanelOpen: false,
  rulesComposeRequested: false,
  rulesAnchorFlash: false,
  rulesManualPanelOpen: false,
  userManualPanelOpen: false,
  activeTour: null,
  scorecardPanelOpen: false,
  scorecardSaveDialogOpen: false,
  dismissedSituationId: null,
  interventionPanelOpen: false,
  attributeScanPanelOpen: false,
  pendingFocusNodeId: null,
  fitViewRequested: false,
  temporalAutoPropagate: true,
  temporalJumpRevertSnapshot: null,
  temporalJumpElapsedHours: 0,
  temporalJumpRevertFromEntryId: null,
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
    // Global view
    // -------------------------------------------------------------------------

    setGlobalViewActive(active) {
      set((state) => { state.globalViewActive = active; });
    },
    setGlobalViewLayout(layout) {
      set((state) => { state.globalViewLayout = layout; });
      // Grouped is a read-only layout: drop any lingering element selection so
      // the Inspector shows the "All canvases" summary (with the toggle back to
      // merged) rather than an editable node/edge panel.
      if (layout === "grouped") useNetworkStore.getState().clearSelection();
    },

    // -------------------------------------------------------------------------
    // Active tool
    // -------------------------------------------------------------------------

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

    requestNewProject() {
      set((state) => { state.newProjectRequested = true; state.fileIoPanelOpen = false; });
    },

    clearNewProjectRequest() {
      set((state) => { state.newProjectRequested = false; });
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
      // The flash is set on the way out, not by the closer: every close path
      // (X, backdrop, Escape) should point at the way back in.
      set((state) => {
        state.activeRulesPanelOpen = false;
        state.rulesComposeRequested = false;
        state.rulesAnchorFlash = true;
      });
    },

    openRuleComposer() {
      set((state) => {
        state.activeRulesPanelOpen = true;
        state.rulesComposeRequested = true;
      });
    },

    clearRulesComposeRequest() {
      set((state) => { state.rulesComposeRequested = false; });
    },

    clearRulesAnchorFlash() {
      set((state) => { state.rulesAnchorFlash = false; });
    },

    // -------------------------------------------------------------------------
    // Rules Manual panel
    // -------------------------------------------------------------------------

    // The two manuals used to be one right-edge drawer slot, so opening either
    // closed the other. They are floating windows now and can sit side by
    // side — which is the point of following §2 of the User Manual into the
    // rule grammar.
    toggleRulesManualPanel() {
      set((state) => {
        state.rulesManualPanelOpen = !state.rulesManualPanelOpen;
      });
    },

    openRulesManualPanel() {
      set((state) => {
        state.rulesManualPanelOpen = true;
      });
    },

    closeRulesManualPanel() {
      set((state) => { state.rulesManualPanelOpen = false; });
    },

    toggleUserManualPanel() {
      set((state) => {
        state.userManualPanelOpen = !state.userManualPanelOpen;
      });
    },

    closeUserManualPanel() {
      set((state) => { state.userManualPanelOpen = false; });
    },

    // The tour drives the real UI, so it starts from a clean slate: any drawer
    // left open would sit above the highlighted target.
    startTour(id) {
      set((state) => {
        state.activeTour = id;
        state.userManualPanelOpen = false;
        state.rulesManualPanelOpen = false;
        state.configModalOpen = false;
        state.fileIoPanelOpen = false;
      });
    },

    endTour() {
      set((state) => { state.activeTour = null; });
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

    dismissSituation(eventEntryId) {
      set((state) => { state.dismissedSituationId = eventEntryId; });
    },

    // -------------------------------------------------------------------------
    // Intervention panel
    // -------------------------------------------------------------------------

    toggleInterventionPanel() {
      set((state) => { state.interventionPanelOpen = !state.interventionPanelOpen; });
    },

    closeInterventionPanel() {
      set((state) => { state.interventionPanelOpen = false; });
    },

    // -------------------------------------------------------------------------
    // Attribute scan panel
    // -------------------------------------------------------------------------

    toggleAttributeScanPanel() {
      set((state) => { state.attributeScanPanelOpen = !state.attributeScanPanelOpen; });
    },

    closeAttributeScanPanel() {
      set((state) => { state.attributeScanPanelOpen = false; });
    },

    // -------------------------------------------------------------------------
    // Programmatic canvas focus
    // -------------------------------------------------------------------------

    requestFocusNode(id) {
      set((state) => { state.pendingFocusNodeId = id; });
    },

    clearFocusNode() {
      set((state) => { state.pendingFocusNodeId = null; });
    },

    requestFitView() {
      set((state) => { state.fitViewRequested = true; });
    },

    clearFitViewRequest() {
      set((state) => { state.fitViewRequested = false; });
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

    saveTemporalRevertSnapshot(snapshot, fromEntryId) {
      set((state) => {
        state.temporalJumpRevertSnapshot = snapshot;
        state.temporalJumpRevertFromEntryId = fromEntryId;
      });
    },

    addTemporalElapsedHours(hours) {
      set((state) => { state.temporalJumpElapsedHours += hours; });
    },

    dropTemporalElapsedHours(hours) {
      set((state) => {
        state.temporalJumpElapsedHours = Math.max(0, state.temporalJumpElapsedHours - hours);
        if (state.temporalJumpElapsedHours === 0) {
          state.temporalJumpRevertSnapshot = null;
          state.temporalJumpRevertFromEntryId = null;
        }
      });
    },

    clearTemporalJumpProgress() {
      set((state) => {
        state.temporalJumpRevertSnapshot = null;
        state.temporalJumpElapsedHours = 0;
        state.temporalJumpRevertFromEntryId = null;
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
