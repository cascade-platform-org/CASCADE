/**
 * model-text-apply.ts — the store-facing side of the LLM Design (ADR-0022).
 *
 * `lib/model-text.ts` checks a change set (or a Workbook import, ADR-0023)
 * against a copy and previews it; once the person confirms, this file writes the
 * checked result through `openBundle`, the way every project file is opened. Before writing,
 * the whole current bundle is kept as a version ("Before LLM Design edit") and
 * handed back, so the window can offer Undo this edit and Versions keeps it.
 * Refused while a Temporal Simulation run is shown, like every model edit.
 */

import { modelLocked } from "@/lib/model-lock";
import { useUiStore } from "@/store/ui-store";
import { pushAutoSnapshot, type ProjectBundle } from "@/lib/file-io";
import { currentBundle, openBundle } from "@/lib/project-bundle";
import { runWithHistory } from "@/lib/run-with-history";

/** Open an edited bundle in place: the active Canvas kept, the project unsaved. */
function load(bundle: ProjectBundle): void {
  openBundle(bundle, { keepActiveCanvas: true });
  useUiStore.getState().markDirty();
}

/**
 * Write a checked bundle as one undo step named `label` ("LLM Design edit",
 * "Import changes from Coop.xlsx"). Returns the bundle it replaced (for Undo
 * this edit), or null when a shown run keeps the model read-only. A version
 * of the project before it is kept first.
 */
export function applyModelBundle(after: ProjectBundle, label = "LLM Design edit"): ProjectBundle | null {
  if (modelLocked()) return null;
  const before = currentBundle();
  pushAutoSnapshot(before, `Before ${label} — ${before.project.meta.name}`);
  // The history is the app's record and the text cannot change it; keep the live one. The step is
  // recorded on it, graph and model alike, so Ctrl+Z undoes the whole edit.
  runWithHistory(() => load({ ...after, project: { ...after.project, update_history: before.project.update_history } }), label, { updateType: "model_update", canvasId: null });
  return before;
}

/** Undo this edit: put back the bundle `applyModelBundle` replaced. */
export function restoreModelBundle(before: ProjectBundle): boolean {
  if (modelLocked()) return false;
  load(before);
  return true;
}
