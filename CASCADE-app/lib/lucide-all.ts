/**
 * Dynamically imported chunk that exposes ALL Lucide icons.
 *
 * `import *` here prevents webpack from tree-shaking lucide-react, so the
 * resulting chunk contains every icon. This file is never imported statically —
 * only via `import("@/lib/lucide-all")` inside the icon-picker search path,
 * so the initial page bundle is unaffected.
 */
 
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Lucide icons are React.forwardRef objects (typeof === "object") with a
// displayName string set by createLucideIcon. Filter on both to skip
// non-icon exports (version strings, utility objects, etc.).
export const allIcons: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(LucideIcons as Record<string, unknown>).filter(([key, val]) => {
    if (!/^[A-Z]/.test(key)) return false;
    if (typeof val !== "object" || val === null) return false;
    return typeof (val as Record<string, unknown>)["displayName"] === "string";
  }),
) as Record<string, LucideIcon>;
