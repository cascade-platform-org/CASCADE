/**
 * element-edit.ts — the one writer for a field of one Element edited by hand:
 * the node and edge Inspectors, their Rules editors and the Active Rules panel.
 *
 * Every edit is an undoable Any Graph Update (through lib/run-with-history.ts).
 * The Inspector writes on every keystroke and every step of a slider, so a run
 * of edits to the same fields of the same Element is one entry (`coalesce`):
 * CTRL+Z undoes the whole label typed, not its last letter. A discrete action
 * (toggling one Rule, deleting one) passes `coalesce: false` and is a step of
 * its own.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { runWithHistory } from "@/lib/run-with-history";
import type { Edge, Node } from "@/lib/schemas/network";
import type { AnyUpdateEntry } from "@/lib/schemas/network";

interface EditOptions {
  /** The history label; by default "Edit <fields>". */
  label?: string;
  /** `manual_functionality_update` for an edit of the Element's condition; by default `graph_update`. */
  updateType?: Extract<AnyUpdateEntry["update_type"], "manual_functionality_update" | "graph_update">;
  /** Fold into the previous edit of the same fields of this Element (default true). */
  coalesce?: boolean;
}

export function editElement(kind: "node", id: string, patch: Partial<Node>, opts?: EditOptions): void;
export function editElement(kind: "edge", id: string, patch: Partial<Edge>, opts?: EditOptions): void;
export function editElement(kind: "node" | "edge", id: string, patch: Partial<Node> | Partial<Edge>, opts: EditOptions = {}): void {
  const fields = Object.keys(patch).sort().join(", ");
  const store = useCanvasStore.getState();
  runWithHistory(
    () => (kind === "node" ? store.updateNode(id, patch as Partial<Node>) : store.updateEdge(id, patch as Partial<Edge>)),
    opts.label ?? `Edit ${fields}`,
    {
      updateType: opts.updateType ?? "graph_update",
      ...(opts.coalesce === false ? {} : { coalesce: `${kind}:${id}:${fields}` }),
    },
  );
}
