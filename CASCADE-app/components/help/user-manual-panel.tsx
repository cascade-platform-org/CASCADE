"use client";

/**
 * UserManualPanel — the {@link UserManual} in a {@link FloatingWindow}.
 *
 * It was a right-edge drawer, pinned full height and immovable. The manual is
 * read *while* working — "set a Demand under Category Dependency Profiles" is
 * an instruction you carry out in the Inspector, which the drawer sat on top
 * of. As a window it can be moved off whatever it covers, resized down to a
 * column beside the canvas, or collapsed to its title bar and reopened where
 * it was left. Closing flies it back into the Topbar's Help button.
 *
 * Toggled from that button via `userManualPanelOpen`. Its §2 hands off to the
 * Rules Manual window, which is the grammar reference.
 */

import { BookOpen } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { FloatingWindow } from "@/components/ui/floating-window";
import { HELP_ANCHOR_ID } from "@/lib/ui-anchors";
import { UserManual } from "@/components/help/user-manual";
import { startTour } from "@/lib/tour/start-tour";
import { TOURS, type TourId } from "@/lib/tour/registry";

export function UserManualPanel() {
  const closeUserManualPanel = useUiStore((s) => s.closeUserManualPanel);
  const openRulesManualPanel = useUiStore((s) => s.openRulesManualPanel);

  return (
    <FloatingWindow
      open
      onClose={closeUserManualPanel}
      title="User Manual"
      icon={<BookOpen size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
      flyToOnClose={HELP_ANCHOR_ID}
      storageKey="cascade.user-manual.window"
      defaultSize={{ w: 560, h: 640 }}
      minSize={{ w: 360, h: 280 }}
    >
      <div className="flex-1 overflow-y-auto p-4">
        {/* Every tour points at the Canvas and the Inspector, and the window
            may be sitting on either — so it closes before one starts. And
            unlike the New Project screen, this entry point is reachable over
            real work: each tour replaces the open project, so each asks
            first, in its own words (registry `discards`). */}
        <UserManual
          onOpenRulesManual={openRulesManualPanel}
          onStartTour={(id: TourId) => {
            if (!window.confirm(TOURS[id].discards)) return;
            closeUserManualPanel();
            void startTour(id);
          }}
        />
      </div>
    </FloatingWindow>
  );
}
