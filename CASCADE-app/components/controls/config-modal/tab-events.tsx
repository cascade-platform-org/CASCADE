"use client";

import { Plus, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { TextInput, NumberInput, ColBtn, CollapsibleSection } from "./primitives";
import { IconPickerButton } from "./icon-picker";
import {
  DirectDamageEditor,
  VulnerabilityLevelsEditor,
  AttributeMutationsEditor,
} from "./event-editors";

export function TabEvents() {
  const events = useConfigStore(useShallow((s) => s.draft.events));
  const addEvent = useConfigStore((s) => s.addEvent);
  const removeEvent = useConfigStore((s) => s.removeEvent);
  const updateEvent = useConfigStore((s) => s.updateEvent);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        First 5 events appear in the Action Bar. Events 6+ appear in &ldquo;More ▼&rdquo;.
      </p>

      {events.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No events defined yet.</p>
      )}

      <div className="space-y-3">
        {events.map((ev, idx) => (
          <div key={ev.id} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
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
                    updateEvent(ev.id, { type: e.target.value as "hazard" | "disservice" })
                  }
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="hazard">Hazard</option>
                  <option value="disservice">Disservice</option>
                </select>
              </div>
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

            <CollapsibleSection
              label="Vulnerability levels"
              badgeFromStore={ev.id}
            >
              <VulnerabilityLevelsEditor eventId={ev.id} />
            </CollapsibleSection>

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
              label="Attribute mutations"
              badge={Object.keys(ev.attribute_mutations ?? {}).length || undefined}
            >
              <AttributeMutationsEditor
                mutations={ev.attribute_mutations ?? {}}
                onChange={(next) => updateEvent(ev.id, { attribute_mutations: next })}
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
            attribute_mutations: {},
          })
        }
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add event
      </button>
    </div>
  );
}
