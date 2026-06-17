/**
 * Dynamically imported chunk that exposes ALL Lucide icons.
 *
 * `import *` here prevents webpack from tree-shaking lucide-react, so the
 * resulting chunk contains every icon. This file is never imported statically —
 * only via `import("@/lib/lucide-all")` inside the icon-picker search path,
 * so the initial page bundle is unaffected.
 */
// eslint-disable-next-line import/no-namespace
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Lucide icons are React.forwardRef objects (typeof === "object"), not functions.
// Filter: PascalCase name + has a displayName string (set by createLucideIcon).
export const allIcons: Record<string, LucideIcon> = Object.fromEntries(
  Object.entries(LucideIcons as Record<string, unknown>).filter(([key, val]) => {
    if (!/^[A-Z]/.test(key)) return false;
    if (typeof val === "function") return true; // plain function components
    if (typeof val === "object" && val !== null) {
      const obj = val as Record<string, unknown>;
      return typeof obj["displayName"] === "string"; // forwardRef components set displayName
    }
    return false;
  }),
) as Record<string, LucideIcon>;
