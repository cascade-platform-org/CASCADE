"use client";

/**
 * inspector/cause-banner.tsx — Prominent banner that explains WHY an Element's
 * Functionality is compromised.
 *
 * Renders nothing when the Element is at full Functionality (>= N).
 * Distinguishes: propagation cascade (responsibility_share), Event application,
 * and manual Functionality edit.
 */

import { AlertTriangle } from "lucide-react";
import { useHistoryStore } from "@/store/history-store";
import type { AnyUpdateEntry, Node, Edge } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Helpers (internal to this module)
// ---------------------------------------------------------------------------

/** Resolve a responsibility-share key (ElementId or EventId) to a readable label. */
function resolveCauseLabel(
  id: string,
  allNodes: Record<string, Node>,
  allEdges: Record<string, Edge> | undefined,
  events: { id: string; label: string }[],
): string {
  if (allNodes[id]) return allNodes[id].label ?? id;
  const edge = allEdges?.[id];
  if (edge) {
    const s = allNodes[edge.source]?.label ?? edge.source;
    const t = allNodes[edge.target]?.label ?? edge.target;
    return `${s} → ${t}`;
  }
  const event = events.find((e) => e.id === id);
  if (event) return `Event: ${event.label}`;
  return id;
}

/** True when this entry changed `functionality` on this Element. */
function changedFunctionality(entry: AnyUpdateEntry, elementId: string): boolean {
  // A Graph Diff already IS "what changed" (ADR-0017), so this consumer reads it
  // directly instead of comparing two whole Scenarios field by field.
  if (entry.diff) {
    for (const group of [entry.diff.nodes, entry.diff.edges]) {
      const record = group.find((r) => r.id === elementId);
      if (record?.op === "update" && record.fields.some((f) => f.field === "functionality")) {
        return true;
      }
    }
    return false;
  }
  // Legacy entry (pre-ADR-0017): the snapshot pair is all there is.
  const before = entry.before?.nodes[elementId] ?? entry.before?.edges[elementId];
  const after = entry.after?.nodes[elementId] ?? entry.after?.edges[elementId];
  return !!before && !!after && before.functionality !== after.functionality;
}

/**
 * Find the most recent history entry that changed this element's Functionality,
 * for elements degraded by an Event or manual edit (no propagation share).
 */
function findDirectCause(
  elementId: string,
  history: readonly AnyUpdateEntry[],
): { kind: "event"; eventId?: string } | { kind: "manual" } | null {
  for (const entry of history) {
    if (entry.update_type === "event_applied" && changedFunctionality(entry, elementId)) {
      return { kind: "event", eventId: entry.event_id };
    }
    if (entry.update_type === "manual_functionality_update" && changedFunctionality(entry, elementId)) {
      return { kind: "manual" };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CauseBanner component
// ---------------------------------------------------------------------------

export function CauseBanner({
  element,
  n,
  allNodes,
  allEdges,
  events,
}: {
  element: Node | Edge;
  n: number;
  allNodes: Record<string, Node>;
  allEdges?: Record<string, Edge>;
  events: { id: string; label: string }[];
}) {
  const history = useHistoryStore((s) => s.updateHistory);
  if ((element.functionality ?? n) >= n) return null;

  const share = element.responsibility_share ?? {};
  const entries = Object.entries(share).sort((a, b) => b[1] - a[1]);

  let body: React.ReactNode;
  if (entries.length > 0) {
    body = (
      <div className="space-y-1">
        {entries.map(([id, weight]) => (
          <div key={id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-900 dark:text-amber-200">
              {resolveCauseLabel(id, allNodes, allEdges, events)}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-amber-700 dark:text-amber-300">
              {Math.round(weight * 100)}%
            </span>
          </div>
        ))}
      </div>
    );
  } else {
    const direct = findDirectCause(element.id, history);
    if (direct?.kind === "event") {
      const label = direct.eventId
        ? resolveCauseLabel(direct.eventId, allNodes, allEdges, events)
        : "an Event";
      body = (
        <div className="text-xs text-amber-900 dark:text-amber-200">
          Compromised by {label}
        </div>
      );
    } else if (direct?.kind === "manual") {
      body = (
        <div className="text-xs text-amber-900 dark:text-amber-200">
          Compromised by a manual change
        </div>
      );
    } else {
      body = (
        <div className="text-xs text-amber-900 dark:text-amber-200">
          Compromised (cause not recorded)
        </div>
      );
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/30">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
        <AlertTriangle size={12} /> Cause
      </div>
      {body}
    </div>
  );
}
