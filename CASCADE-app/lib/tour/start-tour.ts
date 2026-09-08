/**
 * start-tour.ts — the one way to launch the guided tour.
 *
 * Three places offer it (the wizard, the first-run prompt, the User Manual
 * drawer) and all three must do the same thing: load the worked example the
 * steps are written against, then start. Kept out of `first-run-tour.ts` so the
 * step definitions stay free of store-mutation imports.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { loadSampleBundle } from "@/lib/samples";
import { TOUR_SAMPLE_FILE } from "@/lib/tour/first-run-tour";
import { markTourOffered } from "@/hooks/useFirstRun";

/**
 * Load the tour's example network and start the walkthrough. Replaces whatever
 * project is open — every caller warns the user first.
 *
 * A missing or unparseable sample is not a reason to withhold the tour: the
 * steps still point at the right controls, they just have nothing interesting
 * to break.
 */
export async function startGuidedTour(): Promise<void> {
  const bundle = await loadSampleBundle(TOUR_SAMPLE_FILE);
  if (bundle) {
    useCanvasStore.getState().fromProject(bundle.project);
    useConfigStore.getState().loadConfig(bundle.config);
  }
  // However the user got here, they have now been offered it — the first-run
  // prompt must not appear on top of the tour, or after it.
  markTourOffered();
  useUiStore.getState().startTour("first-run");
}
