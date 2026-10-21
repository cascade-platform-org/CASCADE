/**
 * model-diff.ts — what an edit changed beyond the graph, as an invertible diff
 * (ADR-0017, revised 2026-10-19). Pure.
 *
 * The project's parts other than the graph (Temporal Simulations, Series, Expectations,
 * the Model Configuration, the project's settings) are laid out
 * as one registry of records keyed by subject, the keys LLM Design's preview
 * and Import changes already use (`simulation:<id>`, `series:<name>`,
 * `event:<id>`, `scale:level`, `settings:config`…). The Graph Diff's own
 * differ and applier (`diffRegistry`, `applyToRegistry`) then record and undo
 * a change field by field, so a typed Parameter or a pasted profile cell costs
 * the few values it moved, and a list's order is kept when it changed.
 *
 * A snapshot may hold only some parts (the Temporal Simulation store records
 * its own); a diff only ever names the parts its snapshots held.
 */

import { applyToRegistry, deepEqual, diffRegistry, type DiffDirection } from "@/lib/graph-diff";
import { CONFIG_PARTS, PROJECT_PARTS } from "@/lib/record-lists";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { ModelDiff } from "@/lib/schemas/network";
import type { Series } from "@/lib/schemas/series";
import type { Expectation } from "@/lib/schemas/expectation";
import type { StoredTemporalSimulation } from "@/lib/schemas/temporal-simulation";

/** The project's settings an edit can change: its name, description and the Global view's graph type. */
interface ProjectSettings {
  name: string;
  description?: string;
  global_graph_type?: string;
}

/** The parts of the project beyond the graph, each optional: a snapshot holds the parts its writer can change. */
export interface ModelSnapshot {
  settings?: ProjectSettings;
  temporal_simulations?: StoredTemporalSimulation[];
  series?: Series[];
  expectations?: Expectation[];
  config?: ModelConfiguration;
}

type Rec = Record<string, unknown>;

/** Config fields with subjects of their own; the rest are `settings:config`. A scale is wrapped, a record needing an object. */
const CONFIG_OWN = new Set([...CONFIG_PARTS.map((l) => l.key), "node_defaults", "functionality_scale", "level_scale"]);

/** The snapshot as one registry by subject, and each list's order of ids. */
function layout(m: ModelSnapshot): { records: Record<string, Rec>; orders: Record<string, string[]> } {
  const records: Record<string, Rec> = {};
  const orders: Record<string, string[]> = {};
  const list = (key: string, kind: string, items: readonly unknown[], idField: string) => {
    orders[key] = items.map((x) => {
      const k = String((x as Rec)[idField]);
      records[`${kind}:${k}`] = x as Rec;
      return k;
    });
  };
  if (m.settings) records["settings:project"] = m.settings as unknown as Rec;
  for (const l of PROJECT_PARTS) {
    const items = m[l.key];
    if (items) list(l.key, l.kind, items, l.idField);
  }
  if (m.config) {
    const c = m.config as unknown as Rec;
    for (const l of CONFIG_PARTS) list(l.key, l.kind, (c[l.key] as unknown[] | undefined) ?? [], l.idField);
    for (const [name, t] of Object.entries((c.node_defaults as Record<string, Rec> | undefined) ?? {})) records[`template:${name}`] = t;
    records["scale:functionality"] = { levels: c.functionality_scale };
    if (c.level_scale !== undefined) records["scale:level"] = { bands: c.level_scale };
    records["settings:config"] = Object.fromEntries(Object.entries(c).filter(([k]) => !CONFIG_OWN.has(k)));
  }
  return { records, orders };
}

/** Everything that changed between two snapshots of the same parts. */
export function diffModel(before: ModelSnapshot, after: ModelSnapshot): ModelDiff {
  const b = layout(before);
  const a = layout(after);
  const orders: ModelDiff["orders"] = [];
  for (const key of Object.keys(a.orders)) {
    const was = b.orders[key];
    const now = a.orders[key];
    // Any change to the sequence, an addition or a removal included: each side then comes back in its own order.
    if (was && !deepEqual(was, now)) orders.push({ key, before: was, after: now });
  }
  return { records: diffRegistry(b.records, a.records), orders };
}

export const isEmptyModelDiff = (d: ModelDiff): boolean => d.records.length === 0 && d.orders.length === 0;

/** A snapshot with a diff applied: `backward` is undo, `forward` is redo; untouched records keep their identity. */
export function applyModelDiff(m: ModelSnapshot, diff: ModelDiff, dir: DiffDirection): ModelSnapshot {
  if (isEmptyModelDiff(diff)) return m;
  const { records: was, orders } = layout(m);
  const records = applyToRegistry(was, diff.records, dir);
  const recorded = new Map(diff.orders.map((o) => [o.key, dir === "forward" ? o.after : o.before]));
  /** A list in its recorded order, or its own with the records the diff added at the end. */
  const rebuild = (key: string, kind: string): Rec[] => {
    const prefix = `${kind}:`;
    const ids = Object.keys(records).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    const order = recorded.get(key) ?? orders[key] ?? [];
    const seen = new Set(order);
    return [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !seen.has(id))].map((id) => records[`${prefix}${id}`]);
  };

  const out: ModelSnapshot = { ...m };
  if (m.settings && records["settings:project"]) out.settings = records["settings:project"] as unknown as ProjectSettings;
  for (const l of PROJECT_PARTS) {
    if (m[l.key]) (out as Rec)[l.key] = rebuild(l.key, l.kind);
  }
  if (m.config) {
    const c = m.config as unknown as Rec;
    const templates = Object.fromEntries(Object.keys(records).filter((k) => k.startsWith("template:")).map((k) => [k.slice("template:".length), records[k]]));
    const level = records["scale:level"]?.bands;
    out.config = {
      ...(records["settings:config"] ?? {}),
      ...Object.fromEntries(CONFIG_PARTS.map((l) => [l.key, rebuild(l.key, l.kind)])),
      ...(c.node_defaults !== undefined || Object.keys(templates).length > 0 ? { node_defaults: templates } : {}),
      functionality_scale: records["scale:functionality"]?.levels ?? c.functionality_scale,
      ...(level !== undefined ? { level_scale: level } : {}),
    } as unknown as ModelConfiguration;
  }
  return out;
}
