"use client";

/**
 * GlobalViewToolbar — the All tab's layout switch (Merged | Grouped), at the
 * top centre of both layouts so it never sits under the Situation window
 * (top right). The grouped layout passes its collapse controls as children.
 */

import type { ReactNode } from "react";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

const LAYOUTS = [
  { mode: "merged", label: "Merged", title: "Every Canvas on one editable surface" },
  { mode: "grouped", label: "Grouped", title: "Each Canvas in its own region, collapsible into one node (read-only)" },
] as const;

export function GlobalViewToolbar({ children }: { children?: ReactNode }) {
  const layout = useUiStore((s) => s.globalViewLayout);
  const setLayout = useUiStore((s) => s.setGlobalViewLayout);
  return (
    <div
      data-export-ignore
      className="pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md bg-white/90 px-1 py-1 text-xs font-medium text-zinc-600 shadow-sm ring-1 ring-zinc-200 backdrop-blur-sm dark:bg-zinc-900/90 dark:text-zinc-300 dark:ring-zinc-700"
    >
      {LAYOUTS.map(({ mode, label, title }) => (
        <button
          key={mode}
          type="button"
          title={title}
          onClick={() => setLayout(mode)}
          className={cn(
            "rounded px-2 py-0.5 transition-colors",
            layout === mode
              ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
          )}
        >
          {label}
        </button>
      ))}
      {children && <span aria-hidden className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />}
      {children}
    </div>
  );
}
