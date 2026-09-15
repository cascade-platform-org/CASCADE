"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { ICON_REGISTRY, primeIconRegistry } from "@/lib/category-icons";
import { cn } from "./primitives";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

type IconMap = Record<string, React.FC<{ size?: number; strokeWidth?: number; color?: string }>>;

// ---------------------------------------------------------------------------
// Module-level icon cache — shared across all pickers in the session
// ---------------------------------------------------------------------------

let _iconCache: IconMap | null = null;

export async function loadIconsIntoCache(): Promise<IconMap> {
  if (_iconCache) return _iconCache;
  const { allIcons, iconsByAnyName } = await import("@/lib/lucide-all");
  _iconCache = allIcons as IconMap;
  primeIconRegistry(
    allIcons as Record<string, import("@/lib/category-icons").LucideIcon>,
    iconsByAnyName as Record<string, import("@/lib/category-icons").LucideIcon>,
  );
  return _iconCache;
}

/**
 * Names shown first in the picker (pinned as favourites).
 *
 * Under each icon's *canonical* name, not the name `ICON_REGISTRY` imports it
 * as: two of those imports are deprecated aliases (`Waves` is
 * `WavesHorizontal`, `Train` is `TramFront`), and the full pool lists icons
 * canonically — so keying favourites off the import names would silently drop
 * those two from the favourites row.
 */
export const FAVORITE_ICON_NAMES = Object.values(ICON_REGISTRY).map(
  (icon) => (icon as unknown as { displayName: string }).displayName,
);

// ---------------------------------------------------------------------------
// IconPickerButton — shared by category rows and event rows
// ---------------------------------------------------------------------------

export function IconPickerButton({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [iconPool, setIconPool] = useState<IconMap>(ICON_REGISTRY);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const Tag = ICON_REGISTRY["Tag"] as React.FC<{ size?: number; strokeWidth?: number }>;
  const CurrentIcon = value
    ? ((iconPool[value] ?? ICON_REGISTRY[value] ?? Tag) as React.FC<{ size?: number; strokeWidth?: number }>)
    : Tag;

  useEffect(() => {
    if (!open) return;
    if (_iconCache) { setIconPool(_iconCache); return; }
    loadIconsIntoCache().then((icons) => setIconPool(icons));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
    else setSearch("");
  }, [open]);

  const displayNames = useMemo(() => {
    const q = search.toLowerCase().trim();
    const allNames = Object.keys(iconPool);
    if (q) return allNames.filter((n) => n.toLowerCase().includes(q)).sort().slice(0, 100);
    const favSet = new Set(FAVORITE_ICON_NAMES);
    const rest = allNames.filter((n) => !favSet.has(n)).sort();
    return [...FAVORITE_ICON_NAMES.filter((n) => n in iconPool), ...rest];
  }, [search, iconPool]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Choose icon"
        className="flex h-7 w-7 items-center justify-center rounded border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        <CurrentIcon size={14} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 z-50 flex flex-col rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ width: 220 }}
        >
          <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search all Lucide icons…"
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
          </div>

          <div className="grid grid-cols-6 gap-0.5 overflow-y-auto p-1.5" style={{ maxHeight: 240 }}>
            {displayNames.map((iconName) => {
              const Icon = iconPool[iconName] as React.FC<{ size?: number; strokeWidth?: number }> | undefined;
              if (!Icon) return null;
              const active = (value ?? "") === iconName;
              return (
                <button
                  key={iconName}
                  title={iconName}
                  onClick={() => { onChange(iconName); setOpen(false); }}
                  className={cn(
                    "flex items-center justify-center rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                    active && "bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-900/40",
                  )}
                >
                  <Icon size={13} strokeWidth={2} />
                </button>
              );
            })}
            {displayNames.length === 0 && (
              <p className="col-span-6 py-3 text-center text-xs text-zinc-400">No icons found.</p>
            )}
          </div>

          {iconPool === ICON_REGISTRY && !search && (
            <p className="border-t border-zinc-100 px-2 py-1.5 text-xs text-zinc-400 dark:border-zinc-800">
              Loading icons…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
