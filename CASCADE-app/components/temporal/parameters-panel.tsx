"use client";

/**
 * ParametersPanel — the selected Temporal Simulation's Parameters: named
 * numbers its profile rows and the Events it fires read (ADR-0019, revised
 * 2026-10-12). Each shows how many operations read it.
 */

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useConfigStore } from "@/store/config-store";
import { EXPLAIN_PARAMETERS, explainParameter } from "@/lib/temporal-simulation-explainers";
import { OPERAND_NAME_PATTERN, freshOperandName } from "@/lib/schemas/operand";
import { parameterReads } from "@/lib/temporal-sweep";
import { NumberInput } from "@/components/ui/number-input";
import { cn } from "@/lib/utils";
import { SmallButton, TextBackedInput, inputCls } from "./fields";

export function ParametersPanel() {
  const parameters = useTemporalSimulationStore((s) => s.parameters);
  const profile = useTemporalSimulationStore((s) => s.profile);
  const steps = useTemporalSimulationStore((s) => s.timeline.steps);
  const events = useConfigStore((s) => s.config.events);
  const { explain, updateParameters, renameParameter } = useTemporalSimulationStore.getState();

  // How many operations read each name: this Simulation's profile rows, and the Events its Phases fire.
  const reads = useMemo(() => {
    const eventOps = (id: string) => events.find((e) => e.id === id)?.attribute_operations ?? [];
    return new Map(parameters.map((p) => [p.name, parameterReads(profile, steps, p.name, eventOps)]));
  }, [parameters, profile, steps, events]);

  return (
    <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700" onFocus={() => explain(EXPLAIN_PARAMETERS)}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Parameters</h3>
        <span className="text-[11px] text-zinc-400">named numbers its operations read</span>
        <span className="flex-1" />
        <SmallButton
          onClick={() => {
            const name = freshOperandName("param", parameters.map((p) => p.name));
            updateParameters((ps) => { ps.push({ name, value: 0 }); });
            explain(explainParameter(name, 0, 0));
          }}
        >
          <Plus size={11} /> Parameter
        </SmallButton>
      </div>
      {parameters.length === 0 ? (
        <p className="text-[11px] text-zinc-400">None yet. A Parameter keeps a policy&apos;s number (a share, a threshold) in one place, and Compare can sweep it.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400">
              <th className="pb-1 pr-2 font-semibold">Name</th>
              <th className="pb-1 pr-2 font-semibold">Value</th>
              <th className="pb-1 pr-2 font-semibold">Description</th>
              <th className="pb-1 pr-2 text-right font-semibold">Read by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {parameters.map((p, i) => {
              const valid = OPERAND_NAME_PATTERN.test(p.name);
              const n = reads.get(p.name) ?? 0;
              return (
                <tr key={i} onFocus={() => explain(explainParameter(p.name, p.value, n))}>
                  <td className="py-0.5 pr-2">
                    <TextBackedInput
                      key={`${i}-${parameters.length}`}
                      initial={p.name}
                      className={cn(inputCls, "font-mono", !valid && "border-red-400 text-red-600")}
                      onCommit={(t) => renameParameter(p.name, t.trim())}
                    />
                  </td>
                  <td className="w-28 py-0.5 pr-2">
                    <NumberInput className={inputCls} value={p.value} onChange={(v) => updateParameters((ps) => { ps[i].value = v; })} />
                  </td>
                  <td className="py-0.5 pr-2">
                    <TextBackedInput
                      key={`${i}-d-${parameters.length}`}
                      initial={p.description ?? ""}
                      placeholder="what it is, e.g. Art. 8 share of the 1 January balance"
                      onCommit={(t) => updateParameters((ps) => {
                        if (t.trim()) ps[i].description = t;
                        else delete ps[i].description;
                      })}
                    />
                  </td>
                  <td className={cn("py-0.5 pr-2 text-right tabular-nums", n === 0 ? "text-zinc-400" : "text-zinc-700 dark:text-zinc-200")}>{n}</td>
                  <td className="py-0.5">
                    <button type="button" title="Remove Parameter" className="text-zinc-400 hover:text-red-600" onClick={() => updateParameters((ps) => { ps.splice(i, 1); })}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
