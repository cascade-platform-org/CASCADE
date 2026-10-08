"use client";

import { useEffect } from "react";
import { Bot, CheckCheck, Plus, Sparkles, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import type { EventDefinition } from "@/lib/schemas/config";
import { isVulnerabilityEvent } from "@/lib/event-application";
import { confirmed } from "@/lib/provenance";
import { useShallow } from "zustand/react/shallow";
import { TextInput, NumberInput, ColBtn, CollapsibleSection } from "./primitives";
import { IconPickerButton } from "./icon-picker";
import { AttributeOperationsEditor } from "./attribute-operations-editor";
import {
  DirectDamageEditor,
  VulnerabilityLevelsEditor,
} from "./event-editors";

export function TabEvents() {
  const events = useConfigStore(useShallow((s) => s.draft.events));
  const addEvent = useConfigStore((s) => s.addEvent);
  const removeEvent = useConfigStore((s) => s.removeEvent);
  const updateEvent = useConfigStore((s) => s.updateEvent);
  const focusEventId = useUiStore((s) => s.configModalFocusEventId);
  const isDirty = useConfigStore((s) => s.isDirty);

  // Red-team in LLM Design; the modal closes, so its unsaved edits would be lost.
  function redTeam() {
    useUiStore.getState().closeConfigModal();
    useUiStore.getState().openLlmDesign({ recipe: "red-team" });
  }

  // "Create new Event" from the Temporal Simulation window lands here: bring
  // the new Event into view.
  useEffect(() => {
    if (focusEventId) document.querySelector(`[data-event-id="${CSS.escape(focusEventId)}"]`)?.scrollIntoView({ block: "center" });
  }, [focusEventId]);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        The first 5 Scenario events appear in the Action Bar, the rest in &ldquo;More ▼&rdquo;.
        Events marked <em>Temporal Simulation only</em> are hidden there and used in Timelines.
      </p>
      <button
        type="button"
        onClick={redTeam}
        disabled={isDirty}
        title={isDirty ? "Save or discard your edits first: this closes the Configuration" : "An LLM with no stake in the organisation proposes Events across sectors (LLM Design)"}
        className="mb-3 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-zinc-400 dark:text-blue-400"
      >
        <Bot size={12} /> Red-team Events with an LLM
      </button>

      {events.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No events defined yet.</p>
      )}

      <div className="space-y-3">
        {events.map((ev, idx) => (
          <div key={ev.id} data-event-id={ev.id} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500">#{idx + 1}</span>
              <div className="flex items-center gap-1">
                <IconPickerButton
                  value={ev.icon}
                  onChange={(v) => updateEvent(ev.id, { icon: v })}
                />
                <ColBtn variant="danger" onClick={() => removeEvent(ev.id)}>
                  <Trash2 size={12} />
                </ColBtn>
              </div>
            </div>

            {ev.provenance && (
              <div className={ev.provenance.confirmed
                ? "mb-2 text-[11px] text-zinc-500"
                : "mb-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"}
              >
                <p className="flex items-center gap-1 font-medium">
                  <Sparkles size={11} /> Added through LLM Design{ev.provenance.confirmed ? "" : ", unconfirmed: its frequency is an estimate"}
                  {!ev.provenance.confirmed && (
                    <button type="button" onClick={() => updateEvent(ev.id, { provenance: confirmed(ev.provenance!) })} className="ml-auto flex items-center gap-0.5 rounded bg-white/70 px-1.5 py-0.5 hover:bg-white dark:bg-zinc-800">
                      <CheckCheck size={11} /> Confirm
                    </button>
                  )}
                </p>
                {ev.provenance.rationale && <p className="mt-0.5 italic">{ev.provenance.rationale}</p>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Label</label>
                <TextInput
                  value={ev.label}
                  onChange={(v) => updateEvent(ev.id, { label: v })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Type</label>
                <select
                  value={ev.type}
                  onChange={(e) =>
                    updateEvent(ev.id, { type: e.target.value as EventDefinition["type"] })
                  }
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="hazard">Hazard</option>
                  <option value="disservice">Disservice</option>
                  <option value="restorative">Restorative</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Used in</label>
                <select
                  value={ev.temporal_simulation_only ? "temporal-simulation" : "scenario"}
                  onChange={(e) => updateEvent(ev.id, { temporal_simulation_only: e.target.value === "temporal-simulation" || undefined })}
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="scenario">Scenario (Action Bar)</option>
                  <option value="temporal-simulation">Temporal Simulation only</option>
                </select>
              </div>
              {/* Frequency belongs to an Event that strikes; a Restorative Event has none. */}
              {isVulnerabilityEvent(ev) && (
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Frequency / 10y{ev.provenance && !ev.provenance.confirmed ? " (estimate)" : ""}</label>
                  <NumberInput
                    value={ev.frequency_per_10y}
                    min={0}
                    step={0.1}
                    className="w-full"
                    onChange={(v) => updateEvent(ev.id, { frequency_per_10y: v })}
                  />
                </div>
              )}
              {ev.type === "disservice" && (
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Recovery time (h)</label>
                  <NumberInput
                    value={ev.expected_recovery_time}
                    min={0}
                    className="w-full"
                    onChange={(v) => updateEvent(ev.id, { expected_recovery_time: v })}
                  />
                </div>
              )}
            </div>

            {isVulnerabilityEvent(ev) && (
              <CollapsibleSection
                label="Vulnerability levels"
                badgeFromStore={ev.id}
              >
                <VulnerabilityLevelsEditor eventId={ev.id} />
              </CollapsibleSection>
            )}

            {ev.type === "hazard" && (
              <CollapsibleSection
                label="Direct damage"
                badge={
                  (ev.default_repair_time !== undefined ? 1 : 0) +
                  Object.keys(ev.direct_damage_effects ?? {}).length || undefined
                }
              >
                <DirectDamageEditor
                  defaultRepairTime={ev.default_repair_time}
                  effects={ev.direct_damage_effects ?? {}}
                  onChangeDefault={(v) => updateEvent(ev.id, { default_repair_time: v })}
                  onChangeEffects={(next) => updateEvent(ev.id, { direct_damage_effects: next })}
                />
              </CollapsibleSection>
            )}

            <CollapsibleSection
              label="Attribute operations"
              badge={ev.attribute_operations?.length || undefined}
            >
              <AttributeOperationsEditor
                operations={ev.attribute_operations ?? []}
                onChange={(next) => updateEvent(ev.id, { attribute_operations: next.length > 0 ? next : undefined })}
              />
            </CollapsibleSection>
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          addEvent({
            label: "New Event",
            type: "hazard",
            frequency_per_10y: 0,
          })
        }
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add event
      </button>
    </div>
  );
}
