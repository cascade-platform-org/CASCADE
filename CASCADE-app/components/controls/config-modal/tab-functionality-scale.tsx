"use client";

import { useRef } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { TextInput, NumberInput, ColBtn } from "./primitives";

export function TabFunctionalityScale() {
  const levels = useConfigStore(useShallow((s) => s.draft.functionality_scale));
  const addScaleLevel = useConfigStore((s) => s.addScaleLevel);
  const removeScaleLevel = useConfigStore((s) => s.removeScaleLevel);
  const updateScaleLevel = useConfigStore((s) => s.updateScaleLevel);
  const reorderScaleLevels = useConfigStore((s) => s.reorderScaleLevels);
  const thresholds = useConfigStore(useShallow((s) => s.draft.flow_ratio_thresholds));
  const setFlowRatioThresholds = useConfigStore((s) => s.setFlowRatioThresholds);

  // Worst first, which is the order the numbers run in.
  const ordered = [...levels].sort((a, b) => a.level - b.level);

  // N as the ENGINE derives it: the highest configured level, not the row count.
  // The scale need not be a contiguous 1..N, and the threshold table's required
  // length is N−1. See engine/propagation.py.
  const scaleSize = levels.reduce((m, l) => Math.max(m, l.level), 1);

  /** The linear split — the default, and what an absent table means. */
  const linearAt = (level: number) => level / scaleSize;

  /** Upper bound of each level, level 1 first. The top level's is always 1. */
  const bounds = ordered.map((l) =>
    l.level === scaleSize ? 1 : thresholds?.[l.level - 1] ?? linearAt(l.level),
  );

  const setThreshold = (level: number, value: number) => {
    const next = [...(thresholds ?? ordered.slice(0, -1).map((l) => linearAt(l.level)))];
    next[level - 1] = value;
    setFlowRatioThresholds(next);
  };

  /** Swap the row at `i` with its neighbour. */
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= ordered.length) return;
    const seq = ordered.map((l) => l.level);
    [seq[i], seq[j]] = [seq[j], seq[i]];
    reorderScaleLevels(seq);
  }

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Ordered levels: 1 = worst (critical), N = fully operational. Min 2 levels. Each
        band spans the delivered-ratio range that reads as that level — drag a divider to
        move the bound, click a band to recolour it.
      </p>

      <ScaleBar
        levels={ordered}
        bounds={bounds}
        onColor={(level, color) => updateScaleLevel(level, { color })}
        onBound={setThreshold}
      />

      <div className="space-y-2">
        {ordered.map((l, i) => (
          <div key={l.level} className="flex items-center gap-2">
            <span className="w-5 text-right text-xs font-mono text-zinc-400">{l.level}</span>
            <div className="flex flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move down the scale (towards critical)"
                className="rounded px-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:invisible dark:hover:bg-zinc-800"
              >
                <ChevronUp size={11} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === ordered.length - 1}
                title="Move up the scale (towards operational)"
                className="rounded px-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:invisible dark:hover:bg-zinc-800"
              >
                <ChevronDown size={11} />
              </button>
            </div>
            <TextInput
              value={l.label}
              onChange={(v) => updateScaleLevel(l.level, { label: v })}
              className="flex-1"
              placeholder="label"
            />
            <input
              type="color"
              value={l.color}
              onChange={(e) => updateScaleLevel(l.level, { color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            {/* Served-ratio upper bound for this level. The top level has none:
                it is whatever exceeds the one below, so a field there would
                imply a bound that does not exist. */}
            <div
              className="flex w-24 items-center gap-1 text-xs"
              title={
                l.level === scaleSize
                  ? `Level ${l.level} is any delivered ratio above the bound below it.`
                  : `A starved consumer reads as level ${l.level} when its delivered/demand ` +
                    `ratio is at most this. Default ${linearAt(l.level).toFixed(2)}.`
              }
            >
              {l.level === scaleSize ? (
                <span className="w-full text-right text-zinc-400">ratio &gt; below</span>
              ) : (
                <>
                  <span className="text-zinc-400">≤</span>
                  <NumberInput
                    value={thresholds?.[l.level - 1] ?? linearAt(l.level)}
                    onChange={(v) => setThreshold(l.level, v ?? 0)}
                    min={0}
                    max={1}
                    step={0.05}
                    className="flex-1"
                  />
                </>
              )}
            </div>
            <ColBtn
              variant="danger"
              onClick={() => removeScaleLevel(l.level)}
            >
              <Trash2 size={12} />
            </ColBtn>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={addScaleLevel}
          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
        >
          <Plus size={12} /> Add level
        </button>
        {thresholds !== undefined && (
          <button
            onClick={() => setFlowRatioThresholds(null)}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            Reset bounds to linear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The scale as a proportional band: each level's width IS its delivered-ratio
 * span, so an uneven table is visible at a glance rather than only readable
 * from the numbers beside it.
 *
 * Both editable properties are reachable here. Colour: a full-bleed
 * `input[type=color]` sits invisibly over each band, so clicking anywhere on a
 * band opens the picker. Bounds: the dividers between bands drag.
 *
 * `bounds[i]` is level i's UPPER edge; the last is always 1, and is not
 * draggable because the top level is defined as "whatever exceeds the bound
 * below it" rather than by a bound of its own.
 */
function ScaleBar({
  levels,
  bounds,
  onColor,
  onBound,
}: {
  levels: { level: number; label: string; color: string }[];
  bounds: number[];
  onColor: (level: number, color: string) => void;
  onBound: (level: number, value: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  /** Pointer x → ratio, clamped to stay inside the neighbouring bounds so a
   *  drag can never reorder the table or push a band past its siblings. */
  const dragTo = (i: number, clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const raw = (clientX - rect.left) / rect.width;
    const lower = i === 0 ? 0 : bounds[i - 1];
    const upper = bounds[i + 1] ?? 1;
    const clamped = Math.min(Math.max(raw, lower), upper);
    onBound(levels[i].level, Math.round(clamped * 100) / 100);
  };

  return (
    <div ref={barRef} className="relative mb-4 flex h-8 overflow-hidden rounded-md select-none">
      {levels.map((l, i) => {
        const span = bounds[i] - (i === 0 ? 0 : bounds[i - 1]);
        return (
          <div
            key={l.level}
            title={`${l.label} — ratio ${(i === 0 ? 0 : bounds[i - 1]).toFixed(2)} to ${bounds[i].toFixed(2)}`}
            className="relative min-w-0"
            style={{ flexGrow: Math.max(span, 0), flexBasis: 0, backgroundColor: l.color }}
          >
            <input
              type="color"
              value={l.color}
              onChange={(e) => onColor(l.level, e.target.value)}
              aria-label={`Colour for ${l.label}`}
              className="h-full w-full cursor-pointer opacity-0"
            />
          </div>
        );
      })}

      {/* Dividers. Absolutely positioned so they sit exactly on the bound
          regardless of how the flex growth rounds the band widths. */}
      {levels.slice(0, -1).map((l, i) => (
        <div
          key={`div-${l.level}`}
          role="separator"
          aria-label={`Bound between ${l.label} and ${levels[i + 1].label}`}
          title={`≤ ${bounds[i].toFixed(2)} reads as ${l.label} — drag to move`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) dragTo(i, e.clientX);
          }}
          className="absolute top-0 h-full w-2 -translate-x-1/2 cursor-col-resize"
          style={{ left: `${bounds[i] * 100}%` }}
        >
          <div className="mx-auto h-full w-px bg-white/70 dark:bg-black/50" />
        </div>
      ))}
    </div>
  );
}
