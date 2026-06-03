"use client";

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
import { InterCanvasEdgeDialogWired } from "./inter-canvas-edge-dialog-wired";
import { ScorecardPanel } from "@/components/scorecard/scorecard-panel";
import { useUiStore } from "@/store/ui-store";

export function EditorShell() {
  const configModalOpen = useUiStore((s) => s.configModalOpen);
  const fileIoPanelOpen = useUiStore((s) => s.fileIoPanelOpen);
  const activeRulesPanelOpen = useUiStore((s) => s.activeRulesPanelOpen);
  const scorecardPanelOpen = useUiStore((s) => s.scorecardPanelOpen);
  const interCanvasEdgeDialogOpen = useUiStore((s) => s.interCanvasEdgeDialogOpen);
  const globalViewActive = useUiStore((s) => s.globalViewActive);

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
      {scorecardPanelOpen && <ScorecardPanel />}
      {interCanvasEdgeDialogOpen && <InterCanvasEdgeDialogWired />}
    </div>
  );
}
