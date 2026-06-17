"use client";

import { Plus, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { TextInput, ColBtn } from "./primitives";

export function TabFunctionalityScale() {
  const levels = useConfigStore(useShallow((s) => s.draft.functionality_scale));
  const addScaleLevel = useConfigStore((s) => s.addScaleLevel);
  const removeScaleLevel = useConfigStore((s) => s.removeScaleLevel);
  const updateScaleLevel = useConfigStore((s) => s.updateScaleLevel);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Ordered levels: 1 = worst (critical), N = fully operational. Min 2 levels.
      </p>

      <div className="mb-4 flex h-6 overflow-hidden rounded-md">
        {[...levels].sort((a, b) => a.level - b.level).map((l) => (
          <div
            key={l.level}
            title={l.label}
            className="flex-1"
            style={{ backgroundColor: l.color }}
          />
        ))}
      </div>

      <div className="space-y-2">
        {[...levels].sort((a, b) => a.level - b.level).map((l) => (
          <div key={l.level} className="flex items-center gap-2">
            <span className="w-5 text-right text-xs font-mono text-zinc-400">{l.level}</span>
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
    </div>
  );
}
