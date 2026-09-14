"use client";

import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { TextInput, ColBtn } from "./primitives";

export function TabFunctionalityScale() {
  const levels = useConfigStore(useShallow((s) => s.draft.functionality_scale));
  const addScaleLevel = useConfigStore((s) => s.addScaleLevel);
  const removeScaleLevel = useConfigStore((s) => s.removeScaleLevel);
  const updateScaleLevel = useConfigStore((s) => s.updateScaleLevel);
  const reorderScaleLevels = useConfigStore((s) => s.reorderScaleLevels);

  // Worst first, which is the order the numbers run in.
  const ordered = [...levels].sort((a, b) => a.level - b.level);

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
        Ordered levels: 1 = worst (critical), N = fully operational. Min 2 levels.
      </p>

      <div className="mb-4 flex h-6 overflow-hidden rounded-md">
        {ordered.map((l) => (
          <div
            key={l.level}
            title={l.label}
            className="flex-1"
            style={{ backgroundColor: l.color }}
          />
        ))}
      </div>

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
            <ColBtn
              variant="danger"
              onClick={() => removeScaleLevel(l.level)}
            >
              <Trash2 size={12} />
            </ColBtn>
          </div>
        ))}
      </div>

      <button
        onClick={addScaleLevel}
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add level
      </button>

      <p className="mt-3 text-xs text-zinc-400">
        The numbers stay 1..N: elements store one of them as their Functionality. Moving a
        level moves its label and colour, so an element sitting at 2 keeps 2 and takes
        whatever now sits there.
      </p>
    </div>
  );
}
