/**
 * start-tour.ts — the one way to launch a tour.
 *
 * Several places offer them (the New Project screen, the first-run prompt, the
 * User Manual drawer) and all must do the same thing: put what the tour is
 * written against on screen, then start it. The per-tour details live in
 * `registry.ts`; this is the one function that acts on them.
 *
 * Kept out of the step definitions so those stay free of store-mutation
 * imports.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { loadSampleBundle } from "@/lib/samples";
import { createEmptyProject } from "@/lib/new-project";
import { TOURS, type TourId } from "@/lib/tour/registry";
import { markTourOffered } from "@/hooks/useFirstRun";

/**
 * Put the tour's starting point on screen and begin. **Replaces whatever
 * project is open** — a sample-based tour loads its example, and the build tour
 * starts an empty one, because its early steps gate on the *shape* of the
 * stores ("a Category exists", "an edge exists") and on a populated project
 * they would be satisfied on arrival. Entry points reachable over real work
 * warn first, with the registry's `discards` line.
 *
 * A missing or unparseable sample is not a reason to withhold a tour: the steps
 * still point at the right controls, they just have nothing to act on.
 *
 * @param projectName Name for the new project, when the tour starts from empty.
 */
export async function startTour(id: TourId, projectName?: string): Promise<void> {
  const { start } = TOURS[id];

  if ("empty" in start) {
    createEmptyProject(projectName);
  } else {
    const bundle = await loadSampleBundle(start.sample);
    if (bundle) {
      useCanvasStore.getState().fromProject(bundle.project);
      useConfigStore.getState().loadConfig(bundle.config);
    }
  }

  // However the user got here, they have now been offered a tour — the
  // first-run prompt must not appear on top of one, or after it.
  markTourOffered();
  useUiStore.getState().startTour(id);
}
