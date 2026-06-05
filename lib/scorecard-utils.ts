/**
 * scorecard-utils.ts — pure client-side helpers for the Scorecard feature.
 *
 * All functions are free of React/store imports — they operate on plain data
 * structures and can be called from any context.
 */

import type { GraphSnapshot, ScorecardEntry, AnyUpdateEntry } from "@/lib/schemas/network";
import type { ModelConfiguration } from "@/lib/schemas/config";
import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Operativity Score
// ---------------------------------------------------------------------------

/**
 * Compute the Operativity Score for a snapshot.
 *
 * Formula: Σ(importance_i × functionality_i) / (Σ(importance_i) × N) × 100
 * Falls back to unweighted mean when all importances are 0.
 * Returns a value in [0, 100].
 *
 * Level thresholds: uniform N intervals. Level k = [(k-1)/N, k/N) × 100%.
 */
export function computeOperativityScore(snapshot: GraphSnapshot, n: number): number {
  const nodes = Object.values(snapshot.nodes);
  if (nodes.length === 0) return 100;

  const sumWeight = nodes.reduce((a, nd) => a + (nd.importance ?? 0), 0);
  if (sumWeight === 0) {
    // Unweighted fallback
    const sumFunc = nodes.reduce((a, nd) => a + (nd.functionality ?? n), 0);
    return (sumFunc / (nodes.length * n)) * 100;
  }
  const sumWF = nodes.reduce((a, nd) => a + (nd.importance ?? 0) * (nd.functionality ?? n), 0);
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
  return config.functionality_scale.find((l) => l.level === level)?.color ?? "#94a3b8";
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
  eventId: string | undefined;
  eventLabel: string;
  beforeSnapshot: GraphSnapshot;
  afterSnapshot: GraphSnapshot;
}

/**
 * Type 1: event_applied + propagation pairs in history not yet in Scorecard.
 *
 * A "session" is the slice of history between two consecutive propagations
 * (or between the start of history and the first propagation).
 * History is newest-first (entries are unshifted), so entries after index i
 * are older.
 *
 * A propagation is only flagged when its session contains at least one
 * event_applied entry. Pure manual edits (reset, manual functionality change)
 * without an event are not flagged — those are not domain events.
 */
export async function findUnsavedRuns(
  history: AnyUpdateEntry[],
  scorecard: ScorecardEntry[],
): Promise<UnsavedRun[]> {
  const savedHashes = new Set(
    await Promise.all(scorecard.map((e) => hashSnapshot(e.before_propagation))),
  );

  const runs: UnsavedRun[] = [];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry.update_type !== "propagation") continue;

    // "Session" = entries older than this propagation, up to (not including)
    // the next older propagation.
    const olderEntries = history.slice(i + 1);
    const prevPropIdx = olderEntries.findIndex((e) => e.update_type === "propagation");
    const sessionEntries = prevPropIdx === -1
      ? olderEntries
      : olderEntries.slice(0, prevPropIdx);

    // Only flag if an event was actually applied in this session.
    const eventEntry = sessionEntries.find((e) => e.update_type === "event_applied");
    if (!eventEntry) continue;

    const hash = await hashSnapshot(entry.before);
    if (savedHashes.has(hash)) continue;

    runs.push({
      eventEntryId: entry.id,
      eventId: eventEntry.event_id ?? undefined,
      eventLabel: eventEntry.label,
      beforeSnapshot: entry.before,
      afterSnapshot: entry.after,
    });
  }
  return runs;
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
  const coveredIds = new Set(scorecard.map((e) => e.event_id).filter(Boolean));
  return (config.events ?? [])
    .filter((ev) => ev.type !== "temporal_jump" && !coveredIds.has(ev.id))
    .map((ev) => ({ eventId: ev.id, eventLabel: ev.label, eventType: ev.type }));
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

export function generateMarkdown(
  entries: ScorecardEntry[],
  config: ModelConfiguration,
  projectName: string,
): string {
  const n = config.functionality_scale.length;
  const now = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];

  lines.push(`# Scorecard — ${projectName}`, "", `*Generated: ${now}*`, "");
  lines.push("---", "");

  // Summary table
  lines.push("## Summary", "");
  lines.push("| Event | Before O% | After O% | After Temporal O% |");
  lines.push("|---|---|---|---|");
  for (const e of entries) {
    const before = computeOperativityScore(e.before_propagation, n).toFixed(1);
    const after = e.after_propagation
      ? computeOperativityScore(e.after_propagation, n).toFixed(1)
      : "—";
    const temporal = e.after_temporal_jump
      ? computeOperativityScore(e.after_temporal_jump, n).toFixed(1)
      : "—";
    lines.push(`| ${e.label} | ${before}% | ${after}% | ${temporal}% |`);
  }
  lines.push("");

  // Per-entry sections
  for (const e of entries) {
    lines.push("---", "", `## ${e.label}`, "");
    lines.push(`**Saved:** ${new Date(e.created_at).toLocaleString()}`, "");

    lines.push("### Before Propagation", "");
    const scoreBefore = computeOperativityScore(e.before_propagation, n);
    lines.push(`**Operativity Score:** ${scoreBefore.toFixed(1)}%`, "");
    lines.push(`![Before Propagation](images/${e.id}-before.png)`, "");

    if (e.after_propagation) {
      lines.push("### After Propagation", "");
      const scoreAfter = computeOperativityScore(e.after_propagation, n);
      lines.push(`**Operativity Score:** ${scoreAfter.toFixed(1)}%`, "");
      lines.push(impactedNodesTable(e.before_propagation, e.after_propagation, n));
      lines.push("", `![After Propagation](images/${e.id}-after.png)`, "");
    }

    if (e.after_temporal_jump) {
      lines.push(`### After ${e.temporal_jump_hours ?? "?"}h Temporal Jump`, "");
      const scoreTemporal = computeOperativityScore(e.after_temporal_jump, n);
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
): Promise<void> {
  const zip = new JSZip();
  const imgFolder = zip.folder("images")!;

  const md = generateMarkdown(entries, config, projectName);
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
