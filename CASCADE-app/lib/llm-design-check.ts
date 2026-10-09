/**
 * llm-design-check.ts — an LLM Design text checked against a bundle (ADR-0022). Pure.
 *
 * One gate for both kinds of text the window holds: an edited section, which
 * becomes patch operations (`sectionPatch`), and Bulk operations, plain
 * changes or a change set (`checkBulkText`). A passing result's `after` has
 * what the edit added marked with its provenance, so Apply writes the mark.
 */

import { checkChange, parseJsonText } from "@/lib/model-text";
import { asChangeSet, checkBulkText, type BulkResult } from "@/lib/model-text-v2";
import { findSection, sectionPatch, sectionTree } from "@/lib/model-text-sections";
import { markAdded } from "@/lib/provenance";
import type { ProjectBundle } from "@/lib/file-io";

/** What the text edits: Bulk operations (with the changes left out of it), or one section. */
export type DesignTarget = { bulk: true; leaveOut?: ReadonlySet<number> } | { bulk: false; sectionKey: string; label: string };

export function checkDesignText(full: ProjectBundle, target: DesignTarget, text: string): BulkResult {
  // The history is read-only to every text and kept by Apply: leave it out of the copies the check makes
  // (it is most of a large project's size).
  const bundle = { ...full, project: { ...full.project, update_history: [] } };
  const result = target.bulk ? checkBulkText(bundle, text, target.leaveOut) : checkSection(bundle, target, text);
  const r = result.checked;
  if (!r.ok) return result;
  // Each addition's why is the why of the change that made it.
  const why = new Map<string, string>();
  for (const g of result.groups ?? []) {
    const reason = g.why ?? result.notes;
    if (reason) for (const s of g.subjects) if (!why.has(s)) why.set(s, reason);
  }
  return { ...result, checked: { ...r, after: markAdded(bundle, r.after, why) } };
}

function checkSection(bundle: ProjectBundle, target: { sectionKey: string; label: string }, text: string): BulkResult {
  const json = parseJsonText(text);
  if (!json.ok) return { checked: json };
  const section = findSection(sectionTree(bundle), target.sectionKey);
  if (!section) return { checked: { ok: false, errors: [`${target.label} is no longer in the model.`] } };
  const patch = sectionPatch(bundle, section, json.value);
  if ("error" in patch) return { checked: { ok: false, errors: [patch.error] } };
  return { checked: checkChange(bundle, asChangeSet(patch.patch)) };
}
