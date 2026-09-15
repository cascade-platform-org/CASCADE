/**
 * Dynamically imported chunk that exposes ALL Lucide icons, once each.
 *
 * `import *` here prevents webpack from tree-shaking lucide-react, so the
 * resulting chunk contains every icon. This file is never imported statically —
 * only via `import("@/lib/lucide-all")` inside the icon-picker search path,
 * so the initial page bundle is unaffected.
 *
 * lucide-react exports every icon under THREE names — `Droplet`,
 * `DropletIcon` and `LucideDroplet` — plus deprecated aliases pointing at
 * renamed icons. Taking every capitalised export therefore produced 5874
 * entries for 1713 icons, and the picker listed each one three times over.
 * Grouping by `displayName` (which `createLucideIcon` sets to the canonical
 * name, and which every alias of one icon shares) collapses them back to one
 * entry apiece.
 */

import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Every export that is an icon, keyed by the name it was exported under —
 * aliases included. Not for listing: it is what resolves an icon name stored
 * in a project, which may be an alias a previous version of the picker
 * offered.
 */
export const iconsByAnyName: Record<string, LucideIcon> = Object.fromEntries(
  // Lucide icons are React.forwardRef objects (typeof === "object") with a
  // displayName string set by createLucideIcon. Filter on both to skip
  // non-icon exports (version strings, utility objects, etc.).
  Object.entries(LucideIcons as Record<string, unknown>).filter(([key, val]) => {
    if (!/^[A-Z]/.test(key)) return false;
    if (typeof val !== "object" || val === null) return false;
    return typeof (val as Record<string, unknown>)["displayName"] === "string";
  }),
) as Record<string, LucideIcon>;

/** One entry per icon, under its canonical name — what the picker lists. */
export const allIcons: Record<string, LucideIcon> = (() => {
  const out: Record<string, LucideIcon> = {};
  for (const [name, icon] of Object.entries(iconsByAnyName)) {
    const canonical = (icon as unknown as { displayName: string }).displayName;
    // The export whose name IS the displayName is the canonical one; keep it
    // even if an alias was seen first.
    if (!(canonical in out) || name === canonical) out[canonical] = icon;
  }
  return out;
})();
