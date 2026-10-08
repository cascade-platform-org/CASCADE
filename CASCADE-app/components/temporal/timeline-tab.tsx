"use client";

import { useState } from "react";
import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import type { EventDefinition } from "@/lib/schemas/config";
import { useConfigStore } from "@/store/config-store";
import { newPhase, newStep, useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { EXAMPLE_LABEL, advanceLabel } from "@/lib/timeline-plan";
import { isScenarioEvent, temporalJumpHours } from "@/lib/event-application";
import { CalendarUnitSchema } from "@/lib/schemas/temporal-simulation";
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
import { NumberInput } from "@/components/ui/number-input";
import { Field, SmallButton, inputCls, useEventLookup } from "./fields";
import { TimelineGrid } from "./timeline-grid";
import { ProfileRowEditor } from "./profile-row-editor";

/** What "Create new Event" adds to Config → Events. */
const NEW_EVENT: Omit<EventDefinition, "id"> = {
  label: "New Temporal Simulation Event",
  type: "disservice",
  frequency_per_10y: 0,
  temporal_simulation_only: true,
  attribute_mutations: {},
};

/** Event picker: Temporal-Simulation-only Events first, then scenario Events. */
function EventOptions({ events }: { events: EventDefinition[] }) {
  const only = events.filter((e) => !isScenarioEvent(e));
  const scenario = events.filter(isScenarioEvent);
  const label = (e: EventDefinition) => {
    const hours = temporalJumpHours(e);
    return hours === undefined ? e.label : `${e.label} (+${hours} h)`;
  };
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
  const { byId, eventLabel } = useEventLookup();
  /** The profile row whose target, path and op are being edited. */
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  // Only the selected row: editing another row does not re-render the Steps below.
  const row = useTemporalSimulationStore((s) => s.profile.find((r) => r.id === selectedRow));
  const jumpHours = (id: string) => {
    const ev = byId.get(id);
    return ev && temporalJumpHours(ev);
  };

  function addStep() {
    const last = timeline.steps[timeline.steps.length - 1];
    const unit = last?.unit ?? "month";
    const label = (last && advanceLabel(last.label, last.unit, last.repeat)) ?? EXAMPLE_LABEL[unit];
    update((t) => { t.steps.push(newStep(label, unit)); });
    explain(explainAddStep(label));
  }

  /** Create an Event in Config → Events; on Save it joins Phase `pi` of Step `si`. */
  function createEvent(si: number, pi: number) {
    explain(EXPLAIN_CREATE_EVENT);
    openConfigModal("events", {
      template: NEW_EVENT,
      onSaved: (id) => {
        update((t) => { t.steps[si]?.phases[pi]?.events.push({ event: id, every: 1 }); });
        const ev = useConfigStore.getState().config.events.find((e) => e.id === id);
        if (ev) explain(explainPhaseEvent(ev.label, true, temporalJumpHours(ev)));
      },
    });
  }

  return (
    <div className="space-y-4">
      <Field label="Timeline name">
        <input className={inputCls} value={timeline.name} onChange={(e) => update((t) => { t.name = e.target.value; })} />
      </Field>

      <TimelineGrid selectedRow={row?.id ?? null} onSelectRow={setSelectedRow} />
      {row && <ProfileRowEditor row={row} onClose={() => setSelectedRow(null)} onSelect={setSelectedRow} />}

      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Steps</h3>

      {timeline.steps.map((step, si) => {
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
                    const u = CalendarUnitSchema.parse(e.target.value);
                    update((t) => { t.steps[si].unit = u; });
                    explain(explainUnit(u));
                  }}
                >
                  {CalendarUnitSchema.options.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="repeat">
                <NumberInput
                  min={1}
                  className={inputCls}
                  value={step.repeat}
                  onFocus={() => explain(explainRepeat(step.repeat))}
                  onChange={(v) => {
                    const r = Math.max(1, Math.floor(v));
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
                        explain(explainPropagate(on));
                      }}
                    />
                    then Propagate
                  </label>
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
                        {/* Shown whenever it can matter, so an every left above a shrunk repeat can be fixed here. */}
                        {(step.repeat > 1 || pe.every > 1) && (
                          <label className="flex items-center gap-0.5 text-[10px] text-zinc-400" title="Fires on this Step's periods N, 2N, 3N…">
                            every
                            <NumberInput
                              min={1}
                              max={step.repeat}
                              value={pe.every}
                              onFocus={() => explain(explainEventEvery(eventLabel(pe.event), pe.every, step.repeat))}
                              onChange={(v) => {
                                const n = Math.max(1, Math.floor(v));
                                update((t) => { t.steps[si].phases[pi].events[ei].every = n; });
                                explain(explainEventEvery(eventLabel(pe.event), n, step.repeat));
                              }}
                              className="w-8 rounded border border-zinc-200 bg-transparent py-0 px-0.5 dark:bg-transparent text-center text-[10px] text-zinc-700 focus:border-blue-400 focus:outline-none dark:border-zinc-600 dark:text-zinc-200"
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
                      onClick={() => createEvent(si, pi)}
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
