/**
 * record-lists.ts — the project's and the Model Configuration's lists of
 * records, one row each. Pure.
 *
 * A row says where the list lives, the subject kind of its items, the field
 * that identifies one, and what the app does with it. The undo history
 * (lib/model-diff.ts), plain changes (lib/model-text-v2.ts), the preview's
 * subjects (lib/model-text.ts) and Provenance (lib/provenance.ts) all read
 * their lists from here, so a new kind of list is one row.
 */

interface RecordList {
  at: "project" | "config";
  key: string;
  kind: string;
  /** The field that identifies an item: an Event by `id`, a Category by `name`. */
  idField: "id" | "name";
  /** A project may lack the list until its first item; it is then left out of the file. */
  optional?: true;
  /** The undo history records it item by item; Canvases and the Scorecard have histories of their own. */
  modelPart?: true;
  /** Plain changes add, update and delete its items (`{ "add": kind }`). */
  changes?: true;
  /** Its items carry Provenance: what LLM Design or an agent adds is marked unconfirmed. */
  provenance?: true;
}

export const RECORD_LISTS = [
  { at: "config", key: "events", kind: "event", idField: "id", modelPart: true, changes: true, provenance: true },
  { at: "config", key: "categories", kind: "category", idField: "name", modelPart: true, changes: true },
  { at: "config", key: "graph_types", kind: "graph_type", idField: "name", modelPart: true },
  { at: "project", key: "canvases", kind: "canvas", idField: "id", changes: true },
  { at: "project", key: "scorecard", kind: "scorecard", idField: "id" },
  { at: "project", key: "temporal_simulations", kind: "simulation", idField: "id", optional: true, modelPart: true, changes: true },
  { at: "project", key: "series", kind: "series", idField: "name", optional: true, modelPart: true, changes: true },
  { at: "project", key: "expectations", kind: "expectation", idField: "id", optional: true, modelPart: true, changes: true, provenance: true },
] as const satisfies readonly RecordList[];

type Row = (typeof RECORD_LISTS)[number];

/** The kinds plain changes can add, update and delete, besides nodes and edges. */
export type ListKind = Extract<Row, { changes: true }>["kind"];
export const LIST_KINDS = RECORD_LISTS.flatMap((l) => ("changes" in l ? [l.kind] : [])) as ListKind[];

/** The project lists the undo history records item by item; their keys are a model snapshot's parts. */
type ProjectPart = Extract<Row, { at: "project"; modelPart: true }>;
export const PROJECT_PARTS = RECORD_LISTS.filter((l): l is ProjectPart => l.at === "project" && "modelPart" in l);
export const CONFIG_PARTS = RECORD_LISTS.filter((l) => l.at === "config" && "modelPart" in l);

/** The subject kind of a list's items, by the list's key. */
export const SUBJECT_OF: Readonly<Record<string, string>> = Object.fromEntries(RECORD_LISTS.map((l) => [l.key, l.kind]));
