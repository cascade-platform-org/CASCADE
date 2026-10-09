"use client";

/**
 * ProvenanceBanner — what LLM Design added, in the Inspector (ADR-0022).
 *
 * One Element: "Added through LLM Design", its why, and Confirm while it is
 * unconfirmed. A selection: how many of it are unconfirmed, confirmed at once.
 * Confirming is an undoable edit like any other.
 */

import { CheckCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Provenance } from "@/lib/schemas/provenance";
import { useCanvasStore } from "@/store/canvas-store";
import { runWithHistory } from "@/lib/run-with-history";
import { confirmed, isUnconfirmed } from "@/lib/provenance";

export function ProvenanceBanner({ nodeIds, edgeIds }: { nodeIds: readonly string[]; edgeIds: readonly string[] }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const items = [
    ...nodeIds.flatMap((id) => (nodes[id] ? [{ kind: "node" as const, el: nodes[id] }] : [])),
    ...edgeIds.flatMap((id) => (edges[id] ? [{ kind: "edge" as const, el: edges[id] }] : [])),
  ];
  const open = items.filter((x) => isUnconfirmed(x.el));

  function confirmAll() {
    const s = useCanvasStore.getState();
    runWithHistory(() => {
      for (const { kind, el } of open) {
        if (!el.provenance) continue;
        if (kind === "node") s.updateNode(el.id, { provenance: confirmed(el.provenance) });
        else s.updateEdge(el.id, { provenance: confirmed(el.provenance) });
      }
    }, open.length === 1 ? "Confirm an Element LLM Design added" : `Confirm ${open.length} Elements LLM Design added`, { updateType: "graph_update" });
  }

  if (items.length === 1) {
    const p = items[0].el.provenance;
    return p ? <ProvenanceNote provenance={p} onConfirm={confirmAll} className="border-b px-4 py-1.5" /> : null;
  }
  if (open.length === 0) return null;
  return (
    <p className="flex items-center gap-1 border-b border-amber-100 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
      <Sparkles size={11} /> {open.length} of the selected {open.length === 1 ? "was" : "were"} added through LLM Design, unconfirmed.
      <button type="button" onClick={confirmAll} className="ml-auto flex items-center gap-0.5 rounded bg-white/70 px-1.5 py-0.5 hover:bg-white dark:bg-zinc-800 dark:hover:bg-zinc-700">
        <CheckCheck size={11} /> Confirm all
      </button>
    </p>
  );
}

/**
 * One thing's mark: "Added through LLM Design", its why, and Confirm while it
 * is unconfirmed. Shared by the Inspector and the Events tab; `unconfirmedNote`
 * says what is still an estimate.
 */
export function ProvenanceNote({ provenance: p, onConfirm, unconfirmedNote, className }: {
  provenance: Provenance;
  onConfirm: () => void;
  unconfirmedNote?: string;
  className?: string;
}) {
  return (
    <div className={cn(
      "text-[11px]",
      p.confirmed
        ? "border-zinc-100 text-zinc-500 dark:border-zinc-800"
        : "border-amber-100 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200",
      className,
    )}
    >
      <p className="flex items-center gap-1 font-medium">
        <Sparkles size={11} /> Added through LLM Design{p.confirmed ? "" : `, unconfirmed${unconfirmedNote ? `: ${unconfirmedNote}` : ""}`}
        {!p.confirmed && (
          <button type="button" onClick={onConfirm} className="ml-auto flex items-center gap-0.5 rounded bg-white/70 px-1.5 py-0.5 hover:bg-white dark:bg-zinc-800 dark:hover:bg-zinc-700">
            <CheckCheck size={11} /> Confirm
          </button>
        )}
      </p>
      {p.rationale && <p className="mt-0.5 italic">{p.rationale}</p>}
    </div>
  );
}
