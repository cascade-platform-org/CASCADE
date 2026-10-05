"use client";

import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import type { EventDefinition } from "@/lib/schemas/config";
import { useConfigStore } from "@/store/config-store";
import { newPhase, newStep, useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { advanceLabel } from "@/lib/timeline-plan";
import type { CalendarUnit } from "@/lib/temporal-simulation-schema";
import {
  EXPLAIN_ADD_PHASE,
  EXPLAIN_CREATE_EVENT,
  EXPLAIN_REMOVE_PHASE,
  EXPLAIN_REMOVE_STEP,
  explainAddStep,
  explainLabel,
  explainEventEvery,
  explainPhaseEvent,
  explainPropagate,
  explainRepeat,
  explainUnit,
} from "@/lib/temporal-simulation-explainers";
import { Field, SmallButton, inputCls } from "./fields";
import { TimelineStrip } from "./timeline-strip";

const UNITS: CalendarUnit[] = ["day", "week", "month", "quarter", "year", "none"];

/** Event picker: Temporal-Simulation-only Events first, then scenario Events. */
function EventOptions({ events }: { events: EventDefinition[] }) {
  const only = events.filter((e) => e.temporal_simulation_only);
  const scenario = events.filter((e) => !e.temporal_simulation_only);
  const label = (e: EventDefinition) => (e.type === "temporal_jump" ? `${e.label} (+${e.duration_hours ?? 1} h)` : e.label);
  return (
    <>
      {only.length > 0 && <optgroup label="Temporal Simulation only">{only.map((e) => <option key={e.id} value={e.id}>{label(e)}</option>)}</optgroup>}
      {scenario.length > 0 && <optgroup label="Scenario Events">{scenario.map((e) => <option key={e.id} value={e.id}>{label(e)}</option>)}</optgroup>}
    </>
  );
}

export function TimelineTab() {
  const timeline = useTemporalSimulationStore((s) => s.timeline);
  const update = useTemporalSimulationStore((s) => s.updateTimeline);
  const explain = useTemporalSimulationStore((s) => s.explain);
  const events = useConfigStore((s) => s.config.events);
  const openConfigModal = useUiStore((s) => s.openConfigModal);
  const setPendingEventTarget = useTemporalSimulationStore((s) => s.setPendingEventTarget);
  const eventLabel = (id: string) => events.find((e) => e.id === id)?.label ?? id;
  const jumpHours = (id: string) => {
    const ev = events.find((e) => e.id === id);
    return ev?.type === "temporal_jump" ? ev.duration_hours ?? 1 : undefined;
  };

  function addStep() {
    const last = timeline.steps[timeline.steps.length - 1];
    const label = last ? advanceLabel(last.label, last.unit, Math.max(1, last.repeat)) ?? "2024-01" : "2023-01";
    update((t) => { t.steps.push({ ...newStep(label), unit: last?.unit ?? "month" }); });
    explain(explainAddStep(label));
  }

  return (
    <div className="space-y-4">
      <Field label="Timeline name">
        <input className={inputCls} value={timeline.name} onChange={(e) => update((t) => { t.name = e.target.value; })} />
      </Field>

      <TimelineStrip />

      {timeline.steps.map((step, si) => {
        const lastPropagating = step.phases.map((p) => p.propagate).lastIndexOf(true);
        const labelValid = advanceLabel(step.label, step.unit, 0) !== null;
        return (
          <div key={si} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                Step {si + 1}
                <span className="ml-2 font-normal text-zinc-400">
                  {step.repeat > 1 ? `${step.label} → ${advanceLabel(step.label, step.unit, step.repeat - 1) ?? "?"}` : step.label}
                </span>
              </span>
              <SmallButton
                tone="danger"
                onClick={() => { update((t) => { t.steps.splice(si, 1); }); explain(EXPLAIN_REMOVE_STEP); }}
              >
                <Trash2 size={11} /> Remove Step
              </SmallButton>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Label">
                <input
                  className={labelValid ? inputCls : `${inputCls} border-red-400`}
                  value={step.label}
                  onFocus={() => explain(explainLabel(step.label, step.unit, labelValid))}
                  onChange={(e) => {
                    const v = e.target.value;
                    update((t) => { t.steps[si].label = v; });
                    explain(explainLabel(v, step.unit, advanceLabel(v, step.unit, 0) !== null));
                  }}
                />
              </Field>
              <Field label="Unit">
                <select
                  className={inputCls}
                  value={step.unit}
                  onFocus={() => explain(explainUnit(step.unit))}
                  onChange={(e) => {
                    const u = e.target.value as CalendarUnit;
                    update((t) => { t.steps[si].unit = u; });
                    explain(explainUnit(u));
                  }}
                >
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="repeat">
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={step.repeat}
                  onFocus={() => explain(explainRepeat(step.repeat))}
                  onChange={(e) => {
                    const r = Math.max(1, Math.floor(Number(e.target.value) || 1));
                    update((t) => { t.steps[si].repeat = r; });
                    explain(explainRepeat(r));
                  }}
                />
              </Field>
            </div>

            <div className="mt-3 space-y-2">
              {step.phases.map((phase, pi) => (
                <div key={pi} className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/60">
                  <span className="w-14 shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-300">Phase {pi + 1}</span>
                  <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
                    <input
                      type="checkbox"
                      checked={phase.propagate}
                      onChange={(e) => {
                        const on = e.target.checked;
                        update((t) => { t.steps[si].phases[pi].propagate = on; });
                        const flags = step.phases.map((p, i) => (i === pi ? on : p.propagate));
                        explain(explainPropagate(on, flags.lastIndexOf(true) === pi));
                      }}
                    />
                    then Propagate
                  </label>
                  <span
                    title={pi === lastPropagating ? "Stocks integrate after this Phase" : undefined}
                    className={cn("w-3 shrink-0 cursor-help text-xs font-semibold text-blue-700 dark:text-blue-300", pi !== lastPropagating && "invisible")}
                    onClick={() => explain(explainPropagate(true, true))}
                  >
                    ∫
                  </span>
                  <button
                    type="button"
                    title="Remove Phase"
                    className="shrink-0 text-zinc-400 hover:text-red-600"
                    onClick={() => { update((t) => { t.steps[si].phases.splice(pi, 1); }); explain(EXPLAIN_REMOVE_PHASE); }}
                  >
                    <Trash2 size={12} />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 border-l border-zinc-200 pl-2 dark:border-zinc-700">
                    {phase.events.map((pe, ei) => (
                      <span
                        key={ei}
                        className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-200"
                      >
                        {eventLabel(pe.event)}
                        {step.repeat > 1 && (
                          <label className="flex items-center gap-0.5 text-[10px] text-zinc-400" title="Fires on this Step's periods N, 2N, 3N…">
                            every
                            <input
                              type="number"
                              min={1}
                              max={step.repeat}
                              value={pe.every}
                              onFocus={() => explain(explainEventEvery(eventLabel(pe.event), pe.every, step.repeat))}
                              onChange={(e) => {
                                const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                                update((t) => { t.steps[si].phases[pi].events[ei].every = n; });
                                explain(explainEventEvery(eventLabel(pe.event), n, step.repeat));
                              }}
                              className="w-8 rounded border border-zinc-200 bg-transparent px-0.5 text-center text-[10px] text-zinc-700 focus:border-blue-400 focus:outline-none dark:border-zinc-600 dark:text-zinc-200"
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          className="text-zinc-400 hover:text-red-600"
                          onClick={() => { update((t) => { t.steps[si].phases[pi].events.splice(ei, 1); }); explain(explainPhaseEvent(eventLabel(pe.event), false)); }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    <select
                      className="max-w-40 rounded-md border border-dashed border-zinc-300 bg-transparent px-1.5 py-0.5 text-[11px] text-zinc-500 focus:border-blue-400 focus:outline-none dark:border-zinc-600"
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        update((t) => { t.steps[si].phases[pi].events.push({ event: id, every: 1 }); });
                        explain(explainPhaseEvent(eventLabel(id), true, jumpHours(id)));
                      }}
                    >
                      <option value="">+ add Event…</option>
                      <EventOptions events={events} />
                    </select>
                    <button
                      type="button"
                      title="Create a Temporal-Simulation-only Event in Config → Events; it joins this Phase when you save"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                      onClick={() => {
                        setPendingEventTarget({ step: si, phase: pi });
                        explain(EXPLAIN_CREATE_EVENT);
                        openConfigModal("events", "new-temporal-simulation-event");
                      }}
                    >
                      <CalendarPlus size={11} /> Create new Event
                    </button>
                  </div>
                </div>
              ))}
              <SmallButton onClick={() => { update((t) => { t.steps[si].phases.push(newPhase(true)); }); explain(EXPLAIN_ADD_PHASE); }}>
                <Plus size={11} /> Add Phase
              </SmallButton>
            </div>
          </div>
        );
      })}

      <SmallButton tone="accent" onClick={addStep}>
        <Plus size={11} /> Add Step
      </SmallButton>

    </div>
  );
}
