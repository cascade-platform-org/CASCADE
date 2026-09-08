"use client";

/**
 * GuidedTour — runs the first-run tour over the real editor UI.
 *
 * Mounted permanently in EditorShell and inert until `ui-store.activeTour` is
 * set; `startTour()` closes any open drawer first so nothing covers a target.
 * driver.js (MIT) owns the spotlight and tooltip positioning; everything here
 * is lifecycle — start on flag, always clear `activeTour` on the way out so the
 * flag can never be left stuck on.
 */

import { useEffect } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useUiStore } from "@/store/ui-store";
import { FIRST_RUN_TOUR, missingTourAnchors } from "@/lib/tour/first-run-tour";

export function GuidedTour() {
  const activeTour = useUiStore((s) => s.activeTour);
  const endTour = useUiStore((s) => s.endTour);

  useEffect(() => {
    if (activeTour !== "first-run") return;

    if (process.env.NODE_ENV !== "production") {
      const missing = missingTourAnchors();
      if (missing.length) {
        console.warn(
          `[tour] no element carries data-tour for: ${missing.join(", ")}. ` +
            "Those steps will render centred.",
        );
      }
    }

    // Steps whose anchor is absent fall back to a centred tooltip rather than
    // being dropped, so the narrative survives a renamed anchor.
    const steps = FIRST_RUN_TOUR.map((step) => {
      const el =
        step.anchor && document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      return {
        element: el || undefined,
        popover: {
          title: step.title,
          description: step.body,
          side: step.side,
          align: "start" as const,
        },
      };
    });

    const instance: Driver = driver({
      steps,
      showProgress: true,
      allowClose: true,
      overlayOpacity: 0.55,
      // A stray click on the backdrop advances rather than killing the tour;
      // Esc and the close button are the deliberate ways out.
      overlayClickBehavior: "nextStep",
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      onDestroyed: () => endTour(),
    });

    instance.drive();
    return () => instance.destroy();
  }, [activeTour, endTour]);

  return null;
}
