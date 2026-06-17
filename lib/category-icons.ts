/**
 * Shared Lucide icon registry for category icons.
 *
 * ICON_REGISTRY   — map of icon name → LucideIcon component, used by both the
 *                   canvas renderer and the config-modal icon picker.
 * categoryToIcon  — resolves an icon for a category: stored name wins, then
 *                   keyword heuristic, then Tag fallback.
 */

import {
  Droplet,
  Zap,
  Network,
  Flame,
  Truck,
  HeartPulse,
  Thermometer,
  Wind,
  Building2,
  Waves,
  Tag,
  Factory,
  Wifi,
  Cpu,
  Leaf,
  Car,
  Train,
  Anchor,
  FlaskConical,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

export type { LucideIcon };

/** Every icon available in the category icon picker, keyed by display name. */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Droplet,
  Zap,
  Network,
  Flame,
  Truck,
  HeartPulse,
  Thermometer,
  Wind,
  Building2,
  Waves,
  Tag,
  Factory,
  Wifi,
  Cpu,
  Leaf,
  Car,
  Train,
  Anchor,
  FlaskConical,
  ShieldAlert,
};

/** Keyword heuristic — used as fallback when no icon is explicitly set. */
function byKeyword(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("water") || n.includes("acqua") || n.includes("idric") || n.includes("idrau")) return Droplet;
  if (n.includes("electric") || n.includes("power") || n.includes("energy") || n.includes("elettr") || n.includes("energ")) return Zap;
  if (n.includes("ict") || n.includes("telecom") || n.includes("internet") || n.includes("communicat") || n.includes("comunicaz") || n.includes("digital")) return Network;
  if (n.includes("gas") || n.includes("fuel") || n.includes("petroli") || n.includes("combustib")) return Flame;
  if (n.includes("transport") || n.includes("road") || n.includes("rail") || n.includes("traff") || n.includes("trasport") || n.includes("mobil")) return Truck;
  if (n.includes("health") || n.includes("medical") || n.includes("sanit") || n.includes("hospital") || n.includes("osped")) return HeartPulse;
  if (n.includes("heat") || n.includes("thermal") || n.includes("calore") || n.includes("distri")) return Thermometer;
  if (n.includes("wind") || n.includes("air") || n.includes("aria") || n.includes("vent")) return Wind;
  if (n.includes("waste") || n.includes("sewer") || n.includes("fogna") || n.includes("rifiut")) return Waves;
  if (n.includes("civil") || n.includes("struct") || n.includes("infrastruttura") || n.includes("edil")) return Building2;
  if (n.includes("factor") || n.includes("industri") || n.includes("produzione")) return Factory;
  return Tag;
}

/**
 * Populated once after the full Lucide icon set is loaded.
 * Enables canvas and action-bar to render any icon the user selects.
 */
let _allIconsCache: Record<string, LucideIcon> | null = null;

export function primeIconRegistry(icons: Record<string, LucideIcon>): void {
  _allIconsCache = icons;
}

/** Trigger a one-time background load of all icons. Safe to call multiple times. */
export async function loadAllIconsOnce(): Promise<void> {
  if (_allIconsCache) return;
  const { allIcons } = await import("@/lib/lucide-all");
  _allIconsCache = allIcons as Record<string, LucideIcon>;
}

/**
 * Resolve a Lucide icon by stored name.
 * Checks the full cache first (populated after the picker is opened), then
 * the 20-icon ICON_REGISTRY, then returns null if not found.
 */
export function resolveIcon(name: string): LucideIcon | null {
  if (_allIconsCache?.[name]) return _allIconsCache[name];
  if (ICON_REGISTRY[name]) return ICON_REGISTRY[name];
  return null;
}

/**
 * Resolve the Lucide icon for a category.
 * @param name  The category name string.
 * @param icon  The stored icon name from CategoryDefinition.icon (optional).
 */
export function categoryToIcon(name: string, icon?: string): LucideIcon {
  if (icon) {
    if (_allIconsCache?.[icon]) return _allIconsCache[icon];
    if (ICON_REGISTRY[icon]) return ICON_REGISTRY[icon];
  }
  return byKeyword(name);
}
