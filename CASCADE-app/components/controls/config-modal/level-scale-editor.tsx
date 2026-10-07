"use client";

/**
 * LevelScaleEditor — the Level Scale (ADR-0019 §6), Client Configuration: how
 * Level Mode colours a Stock in a Temporal Simulation run by `value / reference`.
 * Bands run from the most negative ratio up; every band but the last has an
 * upper bound. Colours are brand tokens (a role and a ramp step), so a band can
 * only ever be painted in the palette (CLAUDE.md §5).
 */

import { Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useConfigStore } from "@/store/config-store";
import { brandColor, BRAND_HUE, type BrandRole, RAMP_STEPS } from "@/lib/brand";
import { DEFAULT_LEVEL_SCALE, levelScaleProblem, type LevelBand } from "@/lib/schemas/config";
import { NumberInput, TextInput } from "./primitives";

const ROLES = Object.keys(BRAND_HUE) as BrandRole[];

export function LevelScaleEditor() {
  const scale = useConfigStore(useShallow((s) => s.draft.level_scale));
  const setLevelScale = useConfigStore((s) => s.setLevelScale);
  const problem = levelScaleProblem(scale);
  const edit = (i: number, patch: Partial<LevelBand>) => setLevelScale(scale.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-zinc-500">
        In a Temporal Simulation run, Level Mode colours each Stock by its level (or its change over the period) divided by
        its reference: the Stock&apos;s own reference, else its bound max(|min|, |max|). Bands run from the lowest ratio up.
      </p>
      {scale.map((band, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: brandColor(band.role, band.step) }} />
          <TextInput value={band.label} onChange={(label) => edit(i, { label })} />
          <span className="shrink-0 text-[11px] text-zinc-400">below</span>
          {i < scale.length - 1 ? (
            <NumberInput value={band.below} step={0.1} onChange={(below) => edit(i, { below })} className="w-20" />
          ) : (
            <span className="w-20 text-[11px] text-zinc-400">(the rest)</span>
          )}
          <select className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800" value={band.role} onChange={(e) => edit(i, { role: e.target.value as BrandRole })}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800" value={band.step} onChange={(e) => edit(i, { step: Number(e.target.value) })}>
            {RAMP_STEPS.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <button
            type="button"
            title="Remove band"
            disabled={scale.length <= 1}
            className="text-zinc-400 hover:text-red-600 disabled:opacity-30"
            onClick={() => {
              const next = scale.filter((_, k) => k !== i);
              // The last band carries no bound.
              setLevelScale(next.map((b, k) => (k === next.length - 1 ? { ...b, below: undefined } : b)));
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => {
            const last = scale[scale.length - 1];
            const previous = scale[scale.length - 2]?.below ?? 0;
            setLevelScale([...scale.slice(0, -1), { ...last, below: previous + 0.5 }, { label: "new band", role: "accent", step: 800 }]);
          }}
        >
          <Plus size={12} /> Add band
        </button>
        <button type="button" className="text-xs text-zinc-500 hover:underline" onClick={() => setLevelScale(DEFAULT_LEVEL_SCALE)}>
          Restore the default five
        </button>
      </div>
      {problem && <p className="text-[11px] text-red-600 dark:text-red-400">{problem}</p>}
    </div>
  );
}
