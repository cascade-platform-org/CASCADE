"use client";

/**
 * UserManualPanel — slide-over drawer hosting the {@link UserManual}.
 *
 * Mirrors RulesManualPanel: right-anchored, non-blocking (no dark overlay) so
 * the canvas stays visible while reading. Toggled from the Topbar "Manual"
 * button via `userManualPanelOpen`. Its §4 hands off to the Rules Manual
 * drawer, which is the grammar reference.
 */

import { X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { UserManual } from "@/components/help/user-manual";
import { loadSampleBundle } from "@/lib/samples";
import { TOUR_SAMPLE_FILE } from "@/lib/tour/first-run-tour";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";

export function UserManualPanel() {
  const closeUserManualPanel = useUiStore((s) => s.closeUserManualPanel);
  const openRulesManualPanel = useUiStore((s) => s.openRulesManualPanel);
  const startTour = useUiStore((s) => s.startTour);

  // Replaying the tour reloads its worked example, since the steps name that
  // network's nodes and its Earthquake hazard.
  async function replayTour() {
    const bundle = await loadSampleBundle(TOUR_SAMPLE_FILE);
    if (bundle) {
      useCanvasStore.getState().fromProject(bundle.project);
      useConfigStore.getState().loadConfig(bundle.config);
    }
    startTour("first-run");
  }

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-[95vw] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      role="dialog"
      aria-label="User manual"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          User Manual
        </h2>
        <button
          onClick={closeUserManualPanel}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          aria-label="Close manual"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Hand off rather than stack: the store swaps the right-edge slot. */}
        <UserManual onOpenRulesManual={openRulesManualPanel} onStartTour={replayTour} />
      </div>
    </aside>
  );
}
