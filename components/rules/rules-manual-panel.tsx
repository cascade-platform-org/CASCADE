"use client";

/**
 * RulesManualPanel — slide-over drawer that hosts the {@link RulesManual}.
 *
 * Anchored to the right edge so the guide sits next to the user's work
 * (canvas / rule editor) rather than covering it. Toggled from the
 * "Manual" button via the UI store (`rulesManualPanelOpen`). The backdrop
 * is intentionally non-blocking (no dark overlay) so authoring stays
 * visible while reading.
 */

import { X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { RulesManual } from "@/components/rules/rules-manual";

export function RulesManualPanel() {
  const closeRulesManualPanel = useUiStore((s) => s.closeRulesManualPanel);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[95vw] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      role="dialog"
      aria-label="Rules manual"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Rules Manual
        </h2>
        <button
          onClick={closeRulesManualPanel}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          aria-label="Close manual"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <RulesManual />
      </div>
    </aside>
  );
}
