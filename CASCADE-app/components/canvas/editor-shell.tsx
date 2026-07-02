"use client";

import { useEffect, useRef } from "react";
import { Topbar } from "./topbar";
import { ActionBar } from "./action-bar";
import { StatusBar } from "./status-bar";
import { FlowCanvasWithProvider } from "./flow-canvas";
import { GroupedViewCanvasWithProvider } from "./global-view-canvas";
import { MergedViewCanvasWithProvider } from "./merged-view-canvas";
import { Inspector } from "./inspector";
import { Toolbox } from "./toolbox";
import { ConfigModal } from "@/components/controls/config-modal";
import { FileIoPanel } from "@/components/controls/file-io-panel";
import { ActiveRulesPanel } from "@/components/rules/active-rules-panel";
import { RulesManualPanel } from "@/components/rules/rules-manual-panel";
import { InterCanvasEdgeDialogWired } from "./inter-canvas-edge-dialog-wired";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import { InterventionPanel } from "@/components/canvas/intervention-panel";
import { AttributeScanPanel } from "@/components/canvas/attribute-scan-panel";
import { AnalysisPage } from "@/components/analysis/analysis-page";
import { ToastContainer } from "./toast-container";
import { AnonymousBanner } from "@/components/auth/AnonymousBanner";
import { useAuthStore } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { saveBeforeUnload } from "@/lib/file-io";
import { loadRecoveryDir } from "@/lib/recovery-dir";
import { useAutosave } from "@/hooks/useAutosave";
import { checkServerHealth } from "@/lib/api-client";
import { loadAllIconsOnce } from "@/lib/category-icons";
import { SaveScorecardDialog } from "@/components/scorecard/operativity-scorecard";

export function EditorShell() {
  const canPropagate = useAuthStore((s) => s.hasPermission("can_propagate"));
  const configModalOpen = useUiStore((s) => s.configModalOpen);
  const fileIoPanelOpen = useUiStore((s) => s.fileIoPanelOpen);
  const activeRulesPanelOpen = useUiStore((s) => s.activeRulesPanelOpen);
  const rulesManualPanelOpen = useUiStore((s) => s.rulesManualPanelOpen);
  const scorecardPanelOpen = useUiStore((s) => s.scorecardPanelOpen);
  const interventionPanelOpen = useUiStore((s) => s.interventionPanelOpen);
  const attributeScanPanelOpen = useUiStore((s) => s.attributeScanPanelOpen);
  const interCanvasEdgeDialogOpen = useUiStore((s) => s.interCanvasEdgeDialogOpen);
  const globalViewActive = useUiStore((s) => s.globalViewActive);
  const globalViewLayout = useUiStore((s) => s.globalViewLayout);
  const scorecardSaveDialogOpen = useUiStore((s) => s.scorecardSaveDialogOpen);
  const closeScorecardSaveDialog = useUiStore((s) => s.closeScorecardSaveDialog);
  const setServerReachable = useUiStore((s) => s.setServerReachable);

  useAutosave();

  // Load the full Lucide icon set in the background so stored icons render
  // immediately without the user needing to open the config modal first.
  useEffect(() => { loadAllIconsOnce(); }, []);

  const recoveryDirRef = useRef<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    loadRecoveryDir().then((dir) => { recoveryDirRef.current = dir; });
  }, []);

  // Health-check: probe on mount, every 30 s, and when the tab regains focus.
  useEffect(() => {
    let cancelled = false;

    async function probe() {
      const ok = await checkServerHealth();
      if (!cancelled) setServerReachable(ok);
    }

    probe();
    const interval = setInterval(probe, 30_000);
    window.addEventListener("focus", probe);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", probe);
    };
  }, [setServerReachable]);

  useEffect(() => {
    function handleBeforeUnload() {
      const project = useCanvasStore.getState().toProject();
      const config = useConfigStore.getState().config;
      saveBeforeUnload({ project, config }, recoveryDirRef.current);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <div className="flex flex-col bg-zinc-50 dark:bg-zinc-950" style={{ height: "100dvh" }}>
      <Topbar />
      {!canPropagate && (
        <AnonymousBanner
          onSignIn={() => {
            const a = useAuthStore.getState();
            if (a.authEnabled) a.loginWithOidc();
            else a.signOut();
          }}
        />
      )}
      <ActionBar />

      {/* Main workspace */}
      <div className="flex min-h-0 flex-1">
        {/* Toolbox: visible in single-canvas mode and merged global view (both editable) */}
        {(!globalViewActive || globalViewLayout === "merged") && <Toolbox />}

        {/* Canvas area */}
        <div className="relative flex-1 bg-zinc-100 dark:bg-zinc-900">
          {!globalViewActive
            ? <FlowCanvasWithProvider />
            : globalViewLayout === "merged"
            ? <MergedViewCanvasWithProvider />
            : <GroupedViewCanvasWithProvider />
          }
        </div>

        {/* Inspector: visible in single-canvas mode and merged global view (both editable) */}
        {(!globalViewActive || globalViewLayout === "merged") && <Inspector />}
      </div>

      <StatusBar />

      {/* Overlays */}
      {configModalOpen && <ConfigModal />}
      {fileIoPanelOpen && <FileIoPanel />}
      {activeRulesPanelOpen && <ActiveRulesPanel />}
      {rulesManualPanelOpen && <RulesManualPanel />}
      {scorecardPanelOpen && <ScorecardPanel />}
      {interventionPanelOpen && <InterventionPanel />}
      {attributeScanPanelOpen && <AttributeScanPanel />}
      {interCanvasEdgeDialogOpen && <InterCanvasEdgeDialogWired />}
      {scorecardSaveDialogOpen && (
        <SaveScorecardDialog onClose={closeScorecardSaveDialog} />
      )}
      <AnalysisPage />

      <ToastContainer />
    </div>
  );
}
