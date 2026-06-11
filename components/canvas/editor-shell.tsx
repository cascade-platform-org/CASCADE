"use client";

import { useEffect, useRef } from "react";
import { Topbar } from "./topbar";
import { ActionBar } from "./action-bar";
import { StatusBar } from "./status-bar";
import { FlowCanvasWithProvider } from "./flow-canvas";
import { GlobalViewCanvasWithProvider } from "./global-view-canvas";
import { Inspector } from "./inspector";
import { Toolbox } from "./toolbox";
import { ConfigModal } from "@/components/controls/config-modal";
import { FileIoPanel } from "@/components/controls/file-io-panel";
import { ActiveRulesPanel } from "@/components/rules/active-rules-panel";
import { RulesManualPanel } from "@/components/rules/rules-manual-panel";
import { InterCanvasEdgeDialogWired } from "./inter-canvas-edge-dialog-wired";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import { ToastContainer } from "./toast-container";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { saveBeforeUnload } from "@/lib/file-io";
import { loadRecoveryDir } from "@/lib/recovery-dir";
import { checkServerHealth } from "@/lib/api-client";
import { SaveScorecardDialog } from "@/components/scorecard/operativity-scorecard";

export function EditorShell() {
  const configModalOpen = useUiStore((s) => s.configModalOpen);
  const fileIoPanelOpen = useUiStore((s) => s.fileIoPanelOpen);
  const activeRulesPanelOpen = useUiStore((s) => s.activeRulesPanelOpen);
  const rulesManualPanelOpen = useUiStore((s) => s.rulesManualPanelOpen);
  const scorecardPanelOpen = useUiStore((s) => s.scorecardPanelOpen);
  const interCanvasEdgeDialogOpen = useUiStore((s) => s.interCanvasEdgeDialogOpen);
  const globalViewActive = useUiStore((s) => s.globalViewActive);
  const scorecardSaveDialogOpen = useUiStore((s) => s.scorecardSaveDialogOpen);
  const closeScorecardSaveDialog = useUiStore((s) => s.closeScorecardSaveDialog);
  const setServerReachable = useUiStore((s) => s.setServerReachable);

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
      <ActionBar />

      {/* Main workspace */}
      <div className="flex min-h-0 flex-1">
        {/* Toolbox hidden in global view (read-only) */}
        {!globalViewActive && <Toolbox />}

        {/* Canvas area */}
        <div className="relative flex-1 bg-zinc-100 dark:bg-zinc-900">
          {globalViewActive
            ? <GlobalViewCanvasWithProvider />
            : <FlowCanvasWithProvider />
          }
        </div>

        {/* Inspector hidden in global view */}
        {!globalViewActive && <Inspector />}
      </div>

      <StatusBar />

      {/* Overlays */}
      {configModalOpen && <ConfigModal />}
      {fileIoPanelOpen && <FileIoPanel />}
      {activeRulesPanelOpen && <ActiveRulesPanel />}
      {rulesManualPanelOpen && <RulesManualPanel />}
      {scorecardPanelOpen && <ScorecardPanel />}
      {interCanvasEdgeDialogOpen && <InterCanvasEdgeDialogWired />}
      {scorecardSaveDialogOpen && (
        <SaveScorecardDialog onClose={closeScorecardSaveDialog} />
      )}

      <ToastContainer />
    </div>
  );
}
