"use client";

/**
 * RulesManualPanel — the {@link RulesManual} in a {@link FloatingWindow}.
 *
 * Same move as the User Manual, and for a sharper reason: it is opened from
 * the Active Rules window, and as a right-edge drawer it landed on top of the
 * rule being written. Two windows can sit side by side. Closing flies it back
 * into the "Manual" button in the Active Rules title bar.
 */

import { BookOpen } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { FloatingWindow } from "@/components/ui/floating-window";
import { RULES_MANUAL_ANCHOR_ID } from "@/lib/ui-anchors";
import { RulesManual } from "@/components/rules/rules-manual";

export function RulesManualPanel() {
  const closeRulesManualPanel = useUiStore((s) => s.closeRulesManualPanel);

  return (
    <FloatingWindow
      open
      onClose={closeRulesManualPanel}
      title="Rules Manual"
      icon={<BookOpen size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
      flyToOnClose={RULES_MANUAL_ANCHOR_ID}
      storageKey="cascade.rules-manual.window"
      defaultSize={{ w: 520, h: 620 }}
      minSize={{ w: 360, h: 280 }}
    >
      <div className="flex-1 overflow-y-auto p-4">
        <RulesManual />
      </div>
    </FloatingWindow>
  );
}
