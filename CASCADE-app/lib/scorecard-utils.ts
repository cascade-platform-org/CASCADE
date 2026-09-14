/**
 * scorecard-utils.ts — pure client-side helpers for the Scorecard feature.
 *
 * All functions are free of React/store imports — they operate on plain data
 * structures and can be called from any context.
 */

import { materialiseAround } from "@/lib/graph-diff";
import type { GraphSnapshot, ScorecardEntry, PropagationScorecardEntry, AnyUpdateEntry } from "@/lib/schemas/network";
import type { ModelConfiguration } from "@/lib/schemas/config";
import JSZip from "jszip";
import { brandColor } from "@/lib/brand";

function isPropagationEntry(e: ScorecardEntry): e is PropagationScorecardEntry {
  return e.type === "propagation";
}

// ---------------------------------------------------------------------------
// Operativity Score
// ---------------------------------------------------------------------------

/**
 * Compute the Operativity Score for a snapshot.
 *
 * Formula: Σ(w_i × functionality_i) / (Σ(w_i) × N) × 100
 * `weightAttr` names the node attribute used as w_i:
 *   - "constant" → uniform weight (unweighted mean)
 *   - any other string → reads that numeric field from the node or its `properties` bag;
 *     falls back to uniform if all resulting weights are zero or the attribute is absent.
 * Returns a value in [0, 100].
 */
export function computeOperativityScore(snapshot: GraphSnapshot, n: number, weightAttr = "constant"): number {
  const nodes = Object.values(snapshot.nodes);
  if (nodes.length === 0) return 100;

  if (weightAttr === "constant") {
    const sumFunc = nodes.reduce((a, nd) => a + (nd.functionality ?? n), 0);
    return (sumFunc / (nodes.length * n)) * 100;
  }

  const getWeight = (nd: Record<string, unknown>): number => {
    const v = nd[weightAttr];
    if (typeof v === "number" && v >= 0) return v;
    const props = nd["properties"];
    if (props && typeof props === "object") {
      const pv = (props as Record<string, unknown>)[weightAttr];
      if (typeof pv === "number" && pv >= 0) return pv;
    }
    return 0;
  };

  const sumWeight = nodes.reduce((a, nd) => a + getWeight(nd as Record<string, unknown>), 0);
  if (sumWeight === 0) {
    // All weights absent or zero — fall back to uniform
    const sumFunc = nodes.reduce((a, nd) => a + (nd.functionality ?? n), 0);
    return (sumFunc / (nodes.length * n)) * 100;
  }
  const sumWF = nodes.reduce(
    (a, nd) => a + getWeight(nd as Record<string, unknown>) * (nd.functionality ?? n),
    0,
  );
  return (sumWF / (sumWeight * n)) * 100;
}

/**
 * Map an operativity percentage to a functionality level index (1..N).
 * Uses uniform intervals: level k = ceil(P × N / 100), clamped to [1, N].
 */
export function operativityToLevel(pct: number, n: number): number {
  return Math.min(n, Math.max(1, Math.ceil((pct / 100) * n)));
}

/**
 * Colour for a given operativity percentage, derived from the config scale.
 */
export function operativityColor(pct: number, config: ModelConfiguration): string {
  const level = operativityToLevel(pct, config.functionality_scale.length);
  return config.functionality_scale.find((l) => l.level === level)?.color ?? brandColor("neutral", 400);
}

// ---------------------------------------------------------------------------
// Deduplication hash
// ---------------------------------------------------------------------------

/**
 * Stable SHA-256 hash of a GraphSnapshot for deduplication.
 * Sorts keys at every level to produce a canonical representation.
 */
export async function hashSnapshot(snapshot: GraphSnapshot): Promise<string> {
  const text = stableStringify(snapshot);
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(val: unknown): string {
  if (val === null || typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map(stableStringify).join(",") + "]";
  const sorted = Object.keys(val as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`);
  return "{" + sorted.join(",") + "}";
}

// ---------------------------------------------------------------------------
// Missing computation detection
// ---------------------------------------------------------------------------

export interface UnsavedRun {
  eventEntryId: string;
  /** EventDefinition.id for every Event stacked in this session, newest-applied first. */
  eventIds: string[];
  eventLabel: string;
  beforeSnapshot: GraphSnapshot;
  afterSnapshot: GraphSnapshot;
}

/**
 * Type 1: event_applied + propagation pairs in history not yet in Scorecard.
 *
 * A "session" is the slice of history between two consecutive propagations
 * (or between the start of history and the first propagation). A session may
 * contain several event_applied entries when the user stacks multiple Events
 * before running one Propagation (requirements §12.3a).
 * History is newest-first (entries are unshifted), so entries after index i
 * are older.
 *
 * A propagation is only flagged when its session contains at least one
 * event_applied entry. Pure manual edits (reset, manual functionality change)
 * without an event are not flagged — those are not domain events.
 */
/**
 * True when the entry at `index` sits inside a window of Temporal Jumps that
 * was later reverted — i.e. some newer `temporal_jump_revert` rewound history
 * to a point older than it. History is newest-first, so "newer" is a smaller
 * index and the boundary it names is a larger one.
 */
function wasReverted(history: AnyUpdateEntry[], index: number): boolean {
  for (let j = 0; j < index; j++) {
    const entry = history[j];
    if (entry.update_type !== "temporal_jump_revert") continue;
    const boundary = entry.reverts_to_entry_id;
    if (!boundary) continue;
    const at = history.findIndex((e) => e.id === boundary);
    if (at > index) return true;
  }
  return false;
}

export async function findUnsavedRuns(
  history: AnyUpdateEntry[],
  scorecard: ScorecardEntry[],
  live: GraphSnapshot,
): Promise<UnsavedRun[]> {
  const propEntries = scorecard.filter(isPropagationEntry);
  const savedHashes = new Set(
    await Promise.all(propEntries.map((e) => hashSnapshot(e.before_propagation))),
  );

  // Collected first, hashed second: the dedup hashes are independent of each
  // other, so they go through one Promise.all rather than blocking the scan on
  // each in turn — the same shape as `savedHashes` above.
  const candidates: UnsavedRun[] = [];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry.update_type !== "propagation") continue;
    // A Propagation that ran during Temporal Jumps the user has since reverted
    // describes a state the project is no longer in — offering to save it would
    // write a Scorecard entry for a scenario that was undone.
    if (wasReverted(history, i)) continue;

    // "Session" = entries older than this propagation, up to (not including)
    // the next older propagation or Reset (both end a scenario session — an
    // Event applied before a Reset must not be attributed to a Propagation
    // that ran on the reset graph). A temporal-jump revert ends one too.
    const olderEntries = history.slice(i + 1);
    const prevPropIdx = olderEntries.findIndex(
      (e) =>
        e.update_type === "propagation" ||
        e.update_type === "scenario_reset" ||
        e.update_type === "temporal_jump_revert",
    );
    const sessionEntries = prevPropIdx === -1
      ? olderEntries
      : olderEntries.slice(0, prevPropIdx);

    // Only flag if at least one event was applied in this session; collect all
    // of them (a session may stack several Events before this Propagation).
    const eventEntries = sessionEntries.filter((e) => e.update_type === "event_applied");
    if (eventEntries.length === 0) continue;

    // A history entry carries a Graph Diff, not whole Scenarios (ADR-0017), so
    // the pair is rebuilt by walking the live graph back through the newer
    // entries. `live` is passed in rather than read here so this stays a pure
    // function over its inputs — it is the dedup hash's only anchor.
    const { before: beforeSnapshot, after: afterSnapshot } = materialiseAround(live, history, i);

    candidates.push({
      eventEntryId: entry.id,
      eventIds: eventEntries.map((e) => e.event_id).filter((id): id is string => Boolean(id)),
      eventLabel: eventEntries.map((e) => e.label.replace(/^Apply event:\s*/, "")).reverse().join(" + "),
      beforeSnapshot,
      afterSnapshot,
    });
  }

  const hashes = await Promise.all(candidates.map((c) => hashSnapshot(c.beforeSnapshot)));
  return candidates.filter((_, i) => !savedHashes.has(hashes[i]));
}

export interface UncoveredEvent {
  eventId: string;
  eventLabel: string;
  eventType: string;
}

/**
 * Type 3: EventDefinitions in config with no matching Scorecard entry.
 * Excludes temporal_jump events (system-generated, not user-authored).
 */
export function findUncoveredEvents(
  config: ModelConfiguration,
  scorecard: ScorecardEntry[],
): UncoveredEvent[] {
  const coveredIds = new Set(scorecard.filter(isPropagationEntry).flatMap((e) => e.event_ids));
  return (config.events ?? [])
    .filter((ev) => ev.type !== "temporal_jump" && !coveredIds.has(ev.id))
    .map((ev) => ({ eventId: ev.id, eventLabel: ev.label, eventType: ev.type }));
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

function generateMarkdown(
  entries: ScorecardEntry[],
  config: ModelConfiguration,
  projectName: string,
  weightAttr = "constant",
): string {
  const n = config.functionality_scale.length;
  const now = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];

  const weightLabel = weightAttr === "constant" ? "equal (uniform)" : weightAttr.replace(/_/g, " ");
  lines.push(`# Scorecard — ${projectName}`, "", `*Generated: ${now}*`, "", `*Operativity weighting: ${weightLabel}*`, "");
  lines.push("---", "");

  // Summary table
  const propEntries = entries.filter(isPropagationEntry);

  lines.push("## Summary", "");
  lines.push("| Event | Before O% | After O% | After Temporal O% |");
  lines.push("|---|---|---|---|");
  for (const e of propEntries) {
    const before = computeOperativityScore(e.before_propagation, n, weightAttr).toFixed(1);
    const after = e.after_propagation
      ? computeOperativityScore(e.after_propagation, n, weightAttr).toFixed(1)
      : "—";
    const temporal = e.after_temporal_jump
      ? computeOperativityScore(e.after_temporal_jump, n, weightAttr).toFixed(1)
      : "—";
    lines.push(`| ${e.label} | ${before}% | ${after}% | ${temporal}% |`);
  }
  lines.push("");

  // Per-entry sections
  for (const e of propEntries) {
    lines.push("---", "", `## ${e.label}`, "");
    lines.push(`**Saved:** ${new Date(e.created_at).toLocaleString()}`, "");

    lines.push("### Before Propagation", "");
    const scoreBefore = computeOperativityScore(e.before_propagation, n, weightAttr);
    lines.push(`**Operativity Score:** ${scoreBefore.toFixed(1)}%`, "");
    lines.push(`![Before Propagation](images/${e.id}-before.png)`, "");

    if (e.after_propagation) {
      lines.push("### After Propagation", "");
      const scoreAfter = computeOperativityScore(e.after_propagation, n, weightAttr);
      lines.push(`**Operativity Score:** ${scoreAfter.toFixed(1)}%`, "");
      lines.push(impactedNodesTable(e.before_propagation, e.after_propagation, n));
      lines.push("", `![After Propagation](images/${e.id}-after.png)`, "");
    }

    if (e.after_temporal_jump) {
      lines.push(`### After ${e.temporal_jump_hours ?? "?"}h Temporal Jump`, "");
      const scoreTemporal = computeOperativityScore(e.after_temporal_jump, n, weightAttr);
      lines.push(`**Operativity Score:** ${scoreTemporal.toFixed(1)}%`, "");
      lines.push(`![After Temporal Jump](images/${e.id}-temporal.png)`, "");
    }
  }

  return lines.join("\n");
}

function impactedNodesTable(before: GraphSnapshot, after: GraphSnapshot, n: number): string {
  const rows = Object.values(after.nodes)
    .map((nd) => {
      const prev = before.nodes[nd.id];
      const delta = (prev?.functionality ?? n) - (nd.functionality ?? n);
      return { label: nd.label ?? nd.id, importance: nd.importance ?? 0, delta, func: nd.functionality ?? n };
    })
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.importance * b.delta - a.importance * a.delta)
    .slice(0, 10);

  if (rows.length === 0) return "";
  const header = "| Node | Importance | Δ Functionality |";
  const sep    = "|---|---|---|";
  const body   = rows.map((r) => `| ${r.label} | ${r.importance.toFixed(2)} | −${r.delta} |`);
  return [header, sep, ...body].join("\n");
}

// ---------------------------------------------------------------------------
// ZIP export
// ---------------------------------------------------------------------------

export async function exportScorecardZip(
  entries: ScorecardEntry[],
  config: ModelConfiguration,
  projectName: string,
  weightAttr = "constant",
): Promise<void> {
  const zip = new JSZip();
  const imgFolder = zip.folder("images")!;

  const md = generateMarkdown(entries, config, projectName, weightAttr);
  zip.file("scorecard.md", md);

  for (const e of entries) {
    for (const [key, filename] of [
      ["before_propagation_image", `${e.id}-before.png`],
      ["after_propagation_image",  `${e.id}-after.png`],
      ["after_temporal_jump_image",`${e.id}-temporal.png`],
    ] as const) {
      const dataUrl = (e as Record<string, unknown>)[key] as string | undefined;
      if (dataUrl) {
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        imgFolder.file(filename, base64, { base64: true });
      }
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = projectName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  a.download = `scorecard-${slug}-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
