"use client";

import { useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import type { EventDefinition } from "@/lib/schemas/config";
import { isVulnerabilityEvent } from "@/lib/event-application";
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
                  {/* A hand-fired jump comes from the Time control; a Timeline's jump is an Event. */}
                  {ev.temporal_simulation_only && <option value="temporal_jump">Temporal Jump</option>}
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Used in</label>
                <select
                  value={ev.temporal_simulation_only ? "temporal-simulation" : "scenario"}
                  onChange={(e) => {
                    const only = e.target.value === "temporal-simulation";
                    updateEvent(ev.id, {
                      temporal_simulation_only: only || undefined,
                      // A Temporal Jump exists only inside a Timeline.
                      ...(!only && ev.type === "temporal_jump" ? { type: "disservice" as const } : {}),
                    });
                  }}
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="scenario">Scenario (Action Bar)</option>
                  <option value="temporal-simulation">Temporal Simulation only</option>
                </select>
              </div>
              {ev.type === "temporal_jump" && (
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Advances time by (h)</label>
                  <NumberInput
                    value={ev.duration_hours}
                    min={1}
                    className="w-full"
                    onChange={(v) => updateEvent(ev.id, { duration_hours: v })}
                  />
                </div>
              )}
              {/* Frequency is not meaningful for a Temporal Jump (schema). */}
              {isVulnerabilityEvent(ev) && (
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Frequency / 10y</label>
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
