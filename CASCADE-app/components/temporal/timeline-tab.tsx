"use client";

import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
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
  explainPeriodic,
  explainPhaseEvent,
  explainPropagate,
  explainRepeat,
  explainUnit,
} from "@/lib/temporal-simulation-explainers";
import { Field, SmallButton, inputCls } from "./fields";

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
      <div className="flex items-end gap-2">
        <Field label="Timeline name" className="flex-1">
          <input className={inputCls} value={timeline.name} onChange={(e) => update((t) => { t.name = e.target.value; })} />
        </Field>
        <SmallButton
          onClick={() => { explain(EXPLAIN_CREATE_EVENT); openConfigModal("events", "new-temporal-simulation-event"); }}
          title="Create a Temporal-Simulation-only Event in Config → Events"
        >
          <CalendarPlus size={11} /> Create Event
        </SmallButton>
      </div>

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
                <div key={pi} className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Phase {pi + 1}</span>
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
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
                    {pi === lastPropagating && (
                      <span
                        className="cursor-help rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        onClick={() => explain(explainPropagate(true, true))}
                      >
                        Stocks integrate after this Phase
                      </span>
                    )}
                    <span className="flex-1" />
                    <select
                      className={`${inputCls} w-40`}
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        update((t) => { t.steps[si].phases[pi].events.push(id); });
                        explain(explainPhaseEvent(eventLabel(id), true, jumpHours(id)));
                      }}
                    >
                      <option value="">+ add Event…</option>
                      <EventOptions events={events} />
                    </select>
                    <button
                      type="button"
                      title="Remove Phase"
                      className="text-zinc-400 hover:text-red-600"
                      onClick={() => { update((t) => { t.steps[si].phases.splice(pi, 1); }); explain(EXPLAIN_REMOVE_PHASE); }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {phase.events.length === 0 && <span className="text-[11px] italic text-zinc-400">No Events{events.length === 0 ? " — use Create Event first" : ""}</span>}
                    {phase.events.map((id, ei) => (
                      <span key={ei} className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-200">
                        {eventLabel(id)}
                        <button
                          type="button"
                          className="text-zinc-400 hover:text-red-600"
                          onClick={() => { update((t) => { t.steps[si].phases[pi].events.splice(ei, 1); }); explain(explainPhaseEvent(eventLabel(id), false)); }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
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

      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
        <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">Periodic rules</p>
        {timeline.every.map((rule, ri) => (
          <div key={ri} className="mb-2 flex flex-wrap items-end gap-2">
            <Field label="every N periods" className="w-28">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={rule.every}
                onFocus={() => explain(explainPeriodic(rule.every, rule.phase))}
                onChange={(e) => {
                  const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                  update((t) => { t.every[ri].every = n; });
                  explain(explainPeriodic(n, rule.phase));
                }}
              />
            </Field>
            <Field label="in Phase" className="w-20">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={rule.phase}
                onFocus={() => explain(explainPeriodic(rule.every, rule.phase))}
                onChange={(e) => {
                  const p = Math.max(1, Math.floor(Number(e.target.value) || 1));
                  update((t) => { t.every[ri].phase = p; });
                  explain(explainPeriodic(rule.every, p));
                }}
              />
            </Field>
            <Field label="Events" className="flex-1">
              <select
                className={inputCls}
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  update((t) => { t.every[ri].events.push(id); });
                  explain(explainPeriodic(rule.every, rule.phase));
                }}
              >
                <option value="">{rule.events.length ? rule.events.map(eventLabel).join(", ") : "+ add Event…"}</option>
                <EventOptions events={events} />
              </select>
            </Field>
            <button type="button" className="mb-1 text-zinc-400 hover:text-red-600" onClick={() => update((t) => { t.every.splice(ri, 1); })}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <SmallButton
          onClick={() => { update((t) => { t.every.push({ every: 3, phase: 1, events: [] }); }); explain(explainPeriodic(3, 1)); }}
        >
          <Plus size={11} /> Add Periodic rule
        </SmallButton>
      </div>
    </div>
  );
}
