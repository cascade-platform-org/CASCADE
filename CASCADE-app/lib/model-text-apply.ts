/**
 * model-text-apply.ts — the store-facing side of the LLM Design (ADR-0022).
 *
 * `lib/model-text.ts` checks a change set (or a Workbook import, ADR-0023)
 * against a copy and previews it; this file reads the current bundle and, once the person confirms, writes the
 * checked result through the same loaders a project file uses. Before writing,
 * the whole current bundle is kept as a version ("Before LLM Design edit") and
 * handed back, so the window can offer Undo this edit and Versions keeps it.
 * Refused while a Temporal Simulation run is shown, like every model edit.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { modelLocked } from "@/lib/model-lock";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { pushAutoSnapshot, type ProjectBundle } from "@/lib/file-io";

/** What the project file and the configuration file would hold now. */
export function currentBundle(): ProjectBundle {
  return { project: useCanvasStore.getState().toProject(), config: useConfigStore.getState().config };
}

/** Load a bundle into the stores, keeping the active Canvas when it still exists. */
function load(bundle: ProjectBundle): void {
  const active = useCanvasStore.getState().activeCanvasId;
  useCanvasStore.getState().loadProject(bundle.project);
  useConfigStore.getState().loadConfig(bundle.config);
  if (active && active in useCanvasStore.getState().canvases) useCanvasStore.setState({ activeCanvasId: active });
  useUiStore.getState().markDirty();
}

/**
 * Write a checked bundle. Returns the bundle it replaced (for Undo this edit),
 * or null when a shown run keeps the model read-only. `label` names the
 * version kept first ("Before LLM Design edit", "Before importing Coop.xlsx").
 */
export function applyModelBundle(after: ProjectBundle, label = "Before LLM Design edit"): ProjectBundle | null {
  if (modelLocked()) return null;
  const before = currentBundle();
  pushAutoSnapshot(before, `${label} — ${before.project.meta.name}`);
  // The history is the app's record and the text cannot change it; keep the live one.
  load({ ...after, project: { ...after.project, update_history: before.project.update_history } });
  return before;
}

/** Undo this edit: put back the bundle `applyModelBundle` replaced. */
export function restoreModelBundle(before: ProjectBundle): boolean {
  if (modelLocked()) return false;
  load(before);
  return true;
}
