/**
 * index.ts — a project bundle as `.xlsx` / `.ods` bytes and back (ADR-0023):
 * the codec and the file adapter together. Loaded on demand by `lib/file-io.ts`.
 */

import type { ProjectBundle } from "@/lib/schemas/bundle";
import { decodeWorkbook, describeProblem, encodeWorkbook, parseDecoded } from "./codec";
import { readBytes, writeBytes, type WorkbookKind } from "./sheetjs-adapter";

export type { WorkbookKind };

/** The bundle as a Workbook file; throws (WorkbookLossError) rather than write a file that would lose anything. */
export async function bundleToWorkbook(bundle: ProjectBundle, kind: WorkbookKind): Promise<Uint8Array> {
  return writeBytes(encodeWorkbook(bundle), kind);
}

export interface OpenedWorkbook {
  bundle: ProjectBundle | null;
  /** Errors (the file did not open), then warnings, each naming its cell. */
  errors: string[];
  warnings: string[];
  /** Reading notes: values read as a spreadsheet saves them, places where an edit replaced what CASCADE wrote. */
  notes: string[];
}

/** A Workbook file as a bundle, with what was refused, repaired or noted, each naming its cell. */
export async function workbookToBundle(bytes: Uint8Array): Promise<OpenedWorkbook> {
  const model = await readBytes(bytes);
  const decoded = decodeWorkbook(model);
  const { bundle, problems } = parseDecoded(decoded, model);
  const of = (severity: string) => problems.filter((p) => p.severity === severity).map(describeProblem);
  const notes = of("note");
  if (decoded.stale > 0) notes.push(`${decoded.stale} place${decoded.stale === 1 ? "" : "s"} edited in the spreadsheet replaced what CASCADE had kept there.`);
  return { bundle, errors: of("error"), warnings: of("warning"), notes };
}
