"use client";

/**
 * TimelineStrip — the whole Timeline at a glance: one column per period,
 * grouped by Step, with each Phase's Events above a bar that is filled when
 * the Phase propagates, and ∫ where Stocks integrate. Built from the same plan
 * the Run tab uses (`planTimeline`), so the strip and a run cannot disagree.
 */

import { useMemo } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { planTimeline, type PlannedPeriod } from "@/lib/timeline-plan";
import { EXPLAIN_STRIP, explainSelectPeriod } from "@/lib/temporal-simulation-explainers";
import type { EventDefinition } from "@/lib/schemas/config";
import { useEventLookup } from "./fields";

const MAX_MARKERS = 3;

/** One Event in the strip and in its legend; an unknown Event is grey. */
function EventMarker({ type }: { type: EventDefinition["type"] | undefined }) {
  if (type === "temporal_jump") return <Clock size={9} className="shrink-0 text-blue-600 dark:text-blue-400" />;
  return (
    <span
      className={cn(
        "h-[7px] w-[7px] shrink-0 rounded-full",
        type === "hazard" ? "bg-red-500" : type === "disservice" ? "bg-amber-500" : "bg-zinc-400",
      )}
    />
  );
}

export function TimelineStrip() {
  const timeline = useTemporalSimulationStore((s) => s.timeline);
  const explain = useTemporalSimulationStore((s) => s.explain);
  const plan = useMemo(() => planTimeline(timeline), [timeline]);
  const { byId, eventLabel } = useEventLookup();
  const jumps = plan.periods.reduce((n, p) => n + p.phases.reduce((m, ph) => m + ph.events.filter((id) => byId.get(id)?.type === "temporal_jump").length, 0), 0);
  const labelEvery = Math.max(1, Math.ceil(plan.periods.length / 12));

  // Consecutive periods of one Step form one group.
  const groups: { stepIndex: number; periods: PlannedPeriod[] }[] = [];
  for (const p of plan.periods) {
    const last = groups[groups.length - 1];
    if (last && last.stepIndex === p.stepIndex) last.periods.push(p);
    else groups.push({ stepIndex: p.stepIndex, periods: [p] });
  }

  if (plan.periods.length === 0) {
    return <p className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-400 dark:border-zinc-600">No periods yet — add a Step.</p>;
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
      <button type="button" onClick={() => explain(EXPLAIN_STRIP)} className="mb-1.5 text-left text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">At a glance</span> — {plan.periods.length} periods ·{" "}
        {plan.engineCalls} Propagations · {jumps} time jump{jumps === 1 ? "" : "s"}
      </button>

      <div className="flex overflow-x-auto pb-1">
        {groups.map((g) => (
          <div key={`${g.stepIndex}-${g.periods[0].number}`} className="flex shrink-0 flex-col border-l-2 border-zinc-300 pl-1 pr-1 dark:border-zinc-600">
            <span className="mb-1 whitespace-nowrap text-[10px] font-medium text-zinc-500">
              Step {g.stepIndex + 1}{g.periods.length > 1 ? ` ×${g.periods.length}` : ""}
            </span>
            <div className="flex gap-0.5">
              {g.periods.map((p) => (
                <button
                  key={p.number}
                  type="button"
                  onClick={() => explain(explainSelectPeriod(p, eventLabel))}
                  title={`${p.label}: ${p.phases.map((ph) => `P${ph.index + 1} ${ph.events.map(eventLabel).join(", ") || "no Events"}${ph.propagate ? " → Propagate" : ""}`).join(" · ")}`}
                  className="flex min-w-[20px] flex-col items-stretch rounded px-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {/* Events, one sub-column per Phase */}
                  <span className="flex h-[30px] items-end gap-px">
                    {p.phases.map((ph) => (
                      <span key={ph.index} className="flex flex-1 flex-col-reverse items-center gap-px">
                        {ph.events.slice(0, MAX_MARKERS).map((id, i) => <EventMarker key={i} type={byId.get(id)?.type} />)}
                        {ph.events.length > MAX_MARKERS && <span className="text-[8px] leading-none text-zinc-500">+{ph.events.length - MAX_MARKERS}</span>}
                      </span>
                    ))}
                  </span>
                  {/* Phases: filled bar = propagates */}
                  <span className="mt-0.5 flex h-2 gap-px">
                    {p.phases.map((ph) => (
                      <span
                        key={ph.index}
                        className={cn("flex-1 rounded-sm", ph.propagate ? "bg-green-500" : "border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900")}
                      />
                    ))}
                  </span>
                  <span className="flex h-3 gap-px">
                    {p.phases.map((ph) => (
                      <span key={ph.index} className="flex-1 text-center text-[9px] font-semibold leading-3 text-blue-700 dark:text-blue-300">
                        {ph.integratesAfter ? "∫" : ""}
                      </span>
                    ))}
                  </span>
                  <span className="h-3 whitespace-nowrap text-left text-[9px] leading-3 text-zinc-500">
                    {(p.number - 1) % labelEvery === 0 || p.repetition === 0 ? p.label : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><EventMarker type="hazard" />hazard</span>
        <span className="flex items-center gap-1"><EventMarker type="disservice" />disservice</span>
        <span className="flex items-center gap-1"><EventMarker type="temporal_jump" />time jump</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-green-500" />Phase + Propagation</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm border border-zinc-300 dark:border-zinc-600" />Phase, Events only</span>
        <span className="flex items-center gap-1"><span className="font-semibold text-blue-700 dark:text-blue-300">∫</span>Stocks integrate</span>
      </div>
    </div>
  );
}
