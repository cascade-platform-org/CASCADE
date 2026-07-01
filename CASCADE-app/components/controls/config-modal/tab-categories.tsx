"use client";

import { Plus, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { TextInput, ColBtn } from "./primitives";
import { IconPickerButton } from "./icon-picker";

// ---------------------------------------------------------------------------
// CategoryRow
// ---------------------------------------------------------------------------

function CategoryRow({
  cat,
  onChangeName,
  onChangeType,
  onChangeIcon,
  onRemove,
}: {
  cat: { name: string; category_type: string; icon?: string };
  onChangeName: (v: string) => void;
  onChangeType: (v: string) => void;
  onChangeIcon: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
      <TextInput value={cat.name} onChange={onChangeName} className="w-28" placeholder="name" />
      <TextInput
        value={cat.category_type}
        onChange={onChangeType}
        className="flex-1"
        placeholder="category type (e.g. SourceToDemands)"
      />
      <IconPickerButton value={cat.icon} onChange={onChangeIcon} />
      <ColBtn variant="danger" onClick={onRemove}>
        <Trash2 size={12} />
      </ColBtn>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabCategories
// ---------------------------------------------------------------------------

export function TabCategories() {
  const categories = useConfigStore(useShallow((s) => s.draft.categories));
  const addCategory = useConfigStore((s) => s.addCategory);
  const removeCategoryAt = useConfigStore((s) => s.removeCategoryAt);
  const updateCategoryAt = useConfigStore((s) => s.updateCategoryAt);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Categories define resource types. <code className="font-mono">category_type</code> determines the engine heuristic.
      </p>

      {categories.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No categories defined yet.</p>
      )}

      <div className="space-y-2">
        {categories.map((cat, i) => (
          <CategoryRow
            key={i}
            cat={cat}
            onChangeName={(v) => updateCategoryAt(i, { name: v })}
            onChangeType={(v) => updateCategoryAt(i, { category_type: v })}
            onChangeIcon={(v) => updateCategoryAt(i, { icon: v })}
            onRemove={() => removeCategoryAt(i)}
          />
        ))}
      </div>

      <button
        onClick={() =>
          addCategory({ name: `category_${categories.length + 1}`, category_type: "SourceToDemands" })
        }
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add category
      </button>
    </div>
  );
}
