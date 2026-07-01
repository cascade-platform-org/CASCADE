"use client";

/**
 * inspector/edge-inspector.tsx — Inspector panel for a single selected Edge.
 *
 * Sections: Identity · Functionality · Capacity · Vulnerability Levels ·
 *           Rules · Properties
 */

import { useCallback } from "react";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN, selectScaleLevels } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { useHistoryAction } from "@/hooks/useHistoryAction";
import type { Edge } from "@/lib/schemas/network";
import { Section, Field, NumberInput, Toggle, vulnHint } from "./primitives";
import { CauseBanner } from "./cause-banner";
import { RulesEditor, PropertiesEditor } from "./editors";

export function EdgeInspector({ edge }: { edge: Edge }) {
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const allNodes = useCanvasStore((s) => s.nodes);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const events = useConfigStore(useShallow((s) => s.config.events));
  const historyAction = useHistoryAction();

  const patch = useCallback(
    (partial: Partial<Edge>) => updateEdge(edge.id, partial),
    [edge.id, updateEdge],
  );

  const patchWithHistory = useCallback(
    (partial: Partial<Edge>, label: string) => {
      historyAction(() => updateEdge(edge.id, partial), label);
    },
    [edge.id, updateEdge, historyAction],
  );

  const srcLabel = allNodes[edge.source]?.label ?? edge.source;
  const tgtLabel = allNodes[edge.target]?.label ?? edge.target;

  return (
    <div className="overflow-y-auto">
      <CauseBanner element={edge} n={n} allNodes={allNodes} events={events} />

      <Section title="Identity" defaultOpen>
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-medium">{srcLabel}</span>
          <span className="mx-1 text-zinc-400">→</span>
          <span className="font-medium">{tgtLabel}</span>
        </div>
      </Section>

      <Section title="Functionality" defaultOpen>
        <Field label={`Functionality (1–${n})`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={n}
              value={edge.functionality}
              onChange={(e) =>
                patchWithHistory(
                  { functionality: Number(e.target.value) },
                  "Manual edge functionality edit",
                )
              }
              className="flex-1 accent-blue-500"
            />
            <span
              className="min-w-[2rem] rounded px-1.5 py-0.5 text-center text-xs font-medium text-white"
              style={{
                backgroundColor:
                  scaleLevels.find((l) => l.level === edge.functionality)?.color ?? "#94a3b8",
              }}
            >
              {edge.functionality}
            </span>
          </div>
        </Field>
        <Field label="Functionality Time (hours)">
          <NumberInput
            value={edge.functionality_time}
            min={0}
            onChange={(v) =>
              patchWithHistory({ functionality_time: v }, "Manual edge functionality_time edit")
            }
          />
        </Field>
        <div className="mb-2">
          <Toggle
            value={edge.direct_damage ?? false}
            onChange={(v) => patch({ direct_damage: v })}
            label="Direct damage"
          />
        </div>
        {edge.direct_damage && (
          <Field label="Expected repair time (hours)">
            <NumberInput
              value={edge.expected_repair_time}
              min={0}
              onChange={(v) => patch({ expected_repair_time: v })}
            />
          </Field>
        )}
      </Section>

      <Section title="Capacity">
        <Field label="Capacity">
          <NumberInput value={edge.capacity} min={0} onChange={(v) => patch({ capacity: v })} />
        </Field>
      </Section>

      {events.length > 0 && (
        <Section title="Vulnerability Levels">
          {events.map((ev) => {
            const level = edge.vulnerability_levels?.[ev.id] ?? 0;
            return (
              <Field key={ev.id} label={ev.label}>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={n - 1}
                    value={level}
                    onChange={(e) =>
                      patch({
                        vulnerability_levels: {
                          ...(edge.vulnerability_levels ?? {}),
                          [ev.id]: Number(e.target.value),
                        },
                      })
                    }
                    className="flex-1 accent-orange-500"
                  />
                  <span className="min-w-[1.5rem] text-right text-xs text-zinc-600 dark:text-zinc-400">
                    {level}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-400">{vulnHint(level, n)}</div>
              </Field>
            );
          })}
        </Section>
      )}

      <Section title="Rules">
        <RulesEditor rules={edge.rules ?? []} onChange={(rules) => patch({ rules })} />
      </Section>

      <Section title="Properties">
        <PropertiesEditor
          properties={edge.properties ?? {}}
          onChange={(properties) => patch({ properties })}
        />
      </Section>
    </div>
  );
}
