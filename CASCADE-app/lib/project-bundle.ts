/**
 * project-bundle.ts — a whole project file in and out of the app's stores.
 *
 * A project file is a ProjectBundle: the Project and its Model Configuration.
 * The app holds it across six stores. `currentBundle()` reads it back.
 * `openBundle()` is the one way a whole project, or one of its two parts,
 * reaches them:
 * - File → Open (`.json`, `.xlsx`, `.ods`), the New Project screen, a sample, a tour;
 * - Recent saves, a cloud version, the Working Copy, the restore prompt;
 * - an EPANET import that replaces the project;
 * - LLM Design and Import changes.
 * Before, each of those wired the loaders by hand, and they disagreed: some
 * ran the reference checks and some did not, and only one kept the active Canvas.
 *
 * It takes a bundle already checked against the schemas. That check belongs
 * where the data enters (a file, the server, localStorage), which is where a
 * bad value can still be refused with a reason. `openBundle` returns the
 * reference problems `validateBundle` finds, so the caller decides whether to
 * show them. A problem never stops a project from opening.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { validateBundle, type ValidationIssue } from "@/lib/project-validation";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import type { Project } from "@/lib/schemas/network";
import type { ModelConfiguration } from "@/lib/schemas/config";

/** What the project file would hold now: the Project and its Model Configuration. */
export function currentBundle(): ProjectBundle {
  return { project: useCanvasStore.getState().toProject(), config: useConfigStore.getState().config };
}

/** A whole bundle, or one part of it; the other part stays as it is. */
export type BundlePart =
  | { project: Project; config?: ModelConfiguration }
  | { project?: Project; config: ModelConfiguration };

/**
 * Load `part` into the stores and return what `validateBundle` finds in the
 * project as it is now open. Either part ends a shown Temporal Simulation run:
 * the Run View would show a run of a model that is no longer open. The first
 * Canvas becomes active, unless `keepActiveCanvas` is set and the active one
 * still exists.
 */
export function openBundle(part: BundlePart, opts: { keepActiveCanvas?: boolean } = {}): ValidationIssue[] {
  const active = useCanvasStore.getState().activeCanvasId;
  useTemporalSimulationStore.getState().endRun();
  if (part.config) useConfigStore.getState().loadConfig(part.config);
  if (part.project) {
    useCanvasStore.getState().fromProject(part.project);
    if (opts.keepActiveCanvas && active && active in useCanvasStore.getState().canvases) {
      useCanvasStore.setState({ activeCanvasId: active });
    }
  }
  return validateBundle(currentBundle());
}
