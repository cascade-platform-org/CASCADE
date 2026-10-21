/**
 * expectations.ts — run an Expectation's check on a copy of the model (ADR-0023). Pure.
 *
 * The person states what their system does ("grid down → the hospital holds on
 * its generators, then fails"); the check says whether the model agrees. A
 * scenario check applies its Events to the Reset model, Propagates, optionally
 * lets hours pass and Propagates again, then compares Elements' fields. A
 * simulation check runs a Temporal Simulation through the step operator and
 * compares one column of its Run table. Every engine call goes through the
 * injected `propagate`, as model-based Analysis does, so the tests need no
 * engine and the app passes `propagateSnapshot` (lib/propagation-call.ts). The
 * model is never written; nothing here is a Rule or a Propagation of its own.
 *
 * The result is words an LLM or a person reads: one line per Element checked,
 * the actual value against the expected one, and for a degraded Element what
 * caused it, which is what a calibration loop needs to choose the next edit.
 */

import { readPath } from "@/lib/attribute-operations";
import { applyEventToSnapshot, passTime } from "@/lib/event-application";
import { canvasesById, filterLabel, matchElements } from "@/lib/element-filter";
import { runTimeline, type Propagated } from "@/lib/step-operator";
import { planTimeline } from "@/lib/timeline-plan";
import { checkDoc } from "@/lib/temporal-simulation-text";
import { runTable } from "@/lib/temporal-metrics";
import { compareRuns } from "@/lib/temporal-comparison";
import { parameterValues, type StoredTemporalSimulation } from "@/lib/schemas/temporal-simulation";
import type { ElementAssertion, Expectation, ScenarioCheck, SimulationCheck } from "@/lib/schemas/expectation";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { GraphSnapshot } from "@/lib/schemas/network";
import type { PropagationScope } from "@/lib/schemas/primitives";
import type { Series } from "@/lib/schemas/series";

/** The scope one engine call runs at. */
interface CheckScope {
  scope: PropagationScope;
  canvasId: string | null;
}

/** What a check reads, captured once before the checks run. */
export interface ExpectationEnv {
  /** The model, Reset (both halves): every check starts from it. */
  start: GraphSnapshot;
  config: ModelConfiguration;
  series: readonly Series[];
  simulations: readonly StoredTemporalSimulation[];
  /** One engine call. */
  propagate: (snapshot: GraphSnapshot, scope: CheckScope) => Promise<Propagated>;
  signal?: AbortSignal;
}

type ExpectationStatus = "pass" | "fail" | "error";

export interface ExpectationResult {
  id: string;
  status: ExpectationStatus;
  /** What was checked, one line each; for `error`, why the check could not run. */
  lines: string[];
  /** Engine Evaluations it spent (ADR-0008). */
  engineCalls: number;
}

type Cmp = ElementAssertion["cmp"];

/** A field's value when an Element does not store it: what the app reads it as. */
const IMPLICIT: Record<string, unknown> = { functionality_time: 0, direct_damage: false };

export function compare(actual: number | boolean | string, cmp: Cmp, expected: number | boolean | string, tolerance = 0): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    switch (cmp) {
      case "<": return actual < expected;
      case "<=": return actual <= expected;
      case ">": return actual > expected;
      case ">=": return actual >= expected;
      case "==": return Math.abs(actual - expected) <= tolerance;
      case "!=": return Math.abs(actual - expected) > tolerance;
    }
  }
  if (cmp === "==") return actual === expected;
  if (cmp === "!=") return actual !== expected;
  return false;
}

const SYMBOL: Record<Cmp, string> = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", "==": "=", "!=": "≠" };

const isFunctionality = (path: readonly string[]): boolean => path.length === 1 && path[0] === "functionality";

/** A Functionality level in words: `2 (operational_warning)`. */
function levelText(level: number, config: ModelConfiguration): string {
  const label = config.functionality_scale[level - 1]?.label;
  return label ? `${level} (${label})` : String(level);
}

/** The expected value as a comparable one: a scale label read as its level. */
function expectedValue(a: ElementAssertion, config: ModelConfiguration): { value: number | boolean | string } | { error: string } {
  if (typeof a.value !== "string" || !isFunctionality(a.path)) return { value: a.value };
  const index = config.functionality_scale.findIndex((l) => l.label === a.value);
  if (index < 0) return { error: `"${a.value}" is not a level of the Functionality scale (${config.functionality_scale.map((l) => l.label).join(", ")})` };
  return { value: index + 1 };
}

function shown(value: unknown, path: readonly string[], config: ModelConfiguration): string {
  return isFunctionality(path) && typeof value === "number" ? levelText(value, config) : JSON.stringify(value);
}

/** Who caused an Element's state, by name, from its Responsibility Share. */
function causeText(el: { responsibility_share?: Record<string, number> }, snapshot: GraphSnapshot, config: ModelConfiguration): string {
  const share = el.responsibility_share;
  if (!share || Object.keys(share).length === 0) return "";
  const events = new Map(config.events.map((e) => [e.id, e.label]));
  const name = (id: string) => events.get(id) ?? (id in snapshot.nodes || id in snapshot.edges ? filterLabel(id, snapshot) : id);
  return `; cause: ${Object.entries(share).sort((x, y) => y[1] - x[1]).map(([id, s]) => `${name(id)} ${Math.round(s * 100)}%`).join(", ")}`;
}

/** Each assertion's lines, and whether it passed. */
function assertOn(snapshot: GraphSnapshot, a: ElementAssertion, config: ModelConfiguration): { pass: boolean; lines: string[] } | { error: string } {
  const expected = expectedValue(a, config);
  if ("error" in expected) return expected;
  const model = { nodes: snapshot.nodes, edges: snapshot.edges, canvases: canvasesById(snapshot.canvases) };
  const ids = a.element !== undefined ? [a.element] : matchElements(a.where!, model);
  if (a.element !== undefined && !(a.element in snapshot.nodes) && !(a.element in snapshot.edges)) return { error: `no Element ${a.element}` };
  if (ids.length === 0) return { error: "the filter selects no Element" };
  const field = a.path.join(".");
  const want = `${SYMBOL[a.cmp]} ${shown(expected.value, a.path, config)}`;
  const outcomes = ids.map((id) => {
    const el = snapshot.nodes[id] ?? snapshot.edges[id];
    if (!el) return { pass: false, line: `✗ ${id}: no such Element` };
    const read = readPath(el as unknown as Record<string, unknown>, a.path);
    const actual = "value" in read ? (read.value === undefined && a.path.length === 1 ? IMPLICIT[field] : read.value) : undefined;
    const label = filterLabel(id, snapshot);
    if (actual === undefined || (typeof actual !== "number" && typeof actual !== "boolean" && typeof actual !== "string")) {
      return { pass: false, line: `✗ ${label}: has no ${field}, expected ${want}` };
    }
    const pass = compare(actual, a.cmp, expected.value);
    const cause = isFunctionality(a.path) && typeof actual === "number" && actual < config.functionality_scale.length ? causeText(el, snapshot, config) : "";
    return { pass, line: `${pass ? "✓" : "✗"} ${label}: ${field} ${shown(actual, a.path, config)}, expected ${want}${cause}` };
  });
  const pass = a.quantifier === "any" ? outcomes.some((o) => o.pass) : outcomes.every((o) => o.pass);
  const lines = outcomes.map((o) => o.line);
  if (a.quantifier === "any" && ids.length > 1) lines.unshift(`${pass ? "✓" : "✗"} at least one of ${ids.length}:`);
  return { pass, lines };
}

async function runScenario(id: string, check: ScenarioCheck, env: ExpectationEnv): Promise<ExpectationResult> {
  const { config } = env;
  const n = config.functionality_scale.length;
  const byId = new Map(config.events.map((e) => [e.id, e]));
  const unknown = check.events.filter((e) => !byId.has(e));
  if (unknown.length) return { id, status: "error", lines: [`Unknown Event ids: ${unknown.join(", ")}`], engineCalls: 0 };
  if (check.scope === "local" && !env.start.canvases.some((c) => c.id === check.canvas)) {
    return { id, status: "error", lines: [`no Canvas ${check.canvas}`], engineCalls: 0 };
  }
  const scope: CheckScope = { scope: check.scope, canvasId: check.canvas ?? null };

  const lines: string[] = [];
  let snapshot = env.start;
  for (const eventId of check.events) {
    const applied = applyEventToSnapshot(snapshot, byId.get(eventId)!, n, { parameters: {}, series: env.series });
    snapshot = applied.snapshot;
    lines.push(...applied.warnings.map((w) => `! ${w}`));
  }
  let engineCalls = 0;
  snapshot = (await env.propagate(snapshot, scope)).snapshot;
  engineCalls++;
  if (check.advance_hours > 0) {
    if (env.signal?.aborted) throw new Error("Cancelled");
    snapshot = passTime(snapshot, check.advance_hours, "time").snapshot;
    snapshot = (await env.propagate(snapshot, scope)).snapshot;
    engineCalls++;
    lines.push(`after ${check.advance_hours} h:`);
  }

  let pass = true;
  for (const a of check.assertions) {
    const outcome = assertOn(snapshot, a, config);
    if ("error" in outcome) return { id, status: "error", lines: [...lines, outcome.error], engineCalls };
    pass &&= outcome.pass;
    lines.push(...outcome.lines);
  }
  return { id, status: pass ? "pass" : "fail", lines, engineCalls };
}

async function runSimulation(id: string, check: SimulationCheck, env: ExpectationEnv): Promise<ExpectationResult> {
  const stored = env.simulations.find((s) => s.id === check.simulation);
  if (!stored) return { id, status: "error", lines: [`no Temporal Simulation ${check.simulation}`], engineCalls: 0 };
  const { id: _id, ...raw } = stored;
  const checked = checkDoc(raw);
  if (!checked.ok) return { id, status: "error", lines: [`the Temporal Simulation is invalid: ${checked.errors[0]}`], engineCalls: 0 };
  const doc = checked.doc;
  const plan = planTimeline(doc.timeline);
  if (plan.errors.length > 0 || plan.periods.length === 0) {
    return { id, status: "error", lines: [plan.errors[0] ?? "its Timeline has no period"], engineCalls: 0 };
  }
  const n = env.config.functionality_scale.length;
  const scope: CheckScope = { scope: doc.scope, canvasId: doc.canvas ?? null };
  const record = await runTimeline({
    start: env.start,
    plan,
    profile: doc.profile,
    events: env.config.events,
    n,
    parameters: parameterValues(doc),
    series: env.series,
    propagate: (snapshot) => env.propagate(snapshot, scope),
    signal: env.signal,
  });
  const table = runTable(record, doc.metrics, n, doc.standard_metrics);
  const column = table.columns.findIndex((c) => c.label === check.column);
  if (column < 0) {
    return { id, status: "error", lines: [`no column "${check.column}"; the Run table has: ${table.columns.map((c) => c.label).join(", ")}`], engineCalls: plan.engineCalls };
  }
  let actual: number | null;
  let where: string;
  if (check.period !== undefined) {
    const row = table.rows.find((r) => r.label === check.period);
    if (!row) return { id, status: "error", lines: [`no period "${check.period}"`], engineCalls: plan.engineCalls };
    actual = row.values[column];
    where = `at ${check.period}`;
  } else {
    actual = compareRuns([{ id: stored.id, name: doc.timeline.name, table, warnings: [] }]).rows[0].stats[check.column][check.statistic!];
    where = `${check.statistic} over the run`;
  }
  const want = `${SYMBOL[check.cmp]} ${check.value}${check.tolerance > 0 && (check.cmp === "==" || check.cmp === "!=") ? ` ± ${check.tolerance}` : ""}`;
  const warnings = record.warnings.map((w) => `! ${w}`);
  if (actual === null) return { id, status: "fail", lines: [...warnings, `✗ ${check.column} ${where}: no value, expected ${want}`], engineCalls: plan.engineCalls };
  const pass = compare(actual, check.cmp, check.value, check.tolerance);
  return { id, status: pass ? "pass" : "fail", lines: [...warnings, `${pass ? "✓" : "✗"} ${check.column} ${where}: ${round(actual)}, expected ${want}`], engineCalls: plan.engineCalls };
}

const round = (v: number): string => (Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, ""));

/** Run one Expectation's check. An engine error is the result's `error`, never a throw, unless cancelled. */
export async function runExpectation(expectation: Expectation, env: ExpectationEnv): Promise<ExpectationResult> {
  try {
    const { check } = expectation;
    return check.kind === "scenario" ? await runScenario(expectation.id, check, env) : await runSimulation(expectation.id, check, env);
  } catch (e) {
    if (env.signal?.aborted) throw e;
    return { id: expectation.id, status: "error", lines: [e instanceof Error ? e.message : String(e)], engineCalls: 0 };
  }
}

/** Every Expectation in order; `onResult` hears each as it finishes. */
export async function runExpectations(
  expectations: readonly Expectation[],
  env: ExpectationEnv,
  onResult?: (result: ExpectationResult) => void,
): Promise<ExpectationResult[]> {
  const results: ExpectationResult[] = [];
  for (const e of expectations) {
    if (env.signal?.aborted) break;
    const result = await runExpectation(e, env);
    results.push(result);
    onResult?.(result);
  }
  return results;
}

/** Results as text for an LLM or a log: one block per Expectation, with its statement. */
export function resultsText(expectations: readonly Expectation[], results: readonly ExpectationResult[]): string {
  const byId = new Map(expectations.map((e) => [e.id, e]));
  const passed = results.filter((r) => r.status === "pass").length;
  const blocks = results.map((r) => {
    const e = byId.get(r.id);
    const mark = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERROR";
    const unconfirmed = e?.provenance && !e.provenance.confirmed ? " (unconfirmed)" : "";
    return [`[${mark}] ${r.id}${unconfirmed}: ${e?.statement ?? ""}`, ...r.lines.map((l) => `  ${l}`)].join("\n");
  });
  return [`${passed} of ${results.length} Expectations pass.`, ...blocks].join("\n\n");
}

/** A check in words, for the list: "Grid cut, then 8 h · 2 assertions" / "Banca ore · Payout at 2025-06 = 100 ± 5". */
export function describeCheck(
  check: Expectation["check"],
  names: { event: (id: string) => string; simulation: (id: string) => string },
): string {
  if (check.kind === "scenario") {
    const events = check.events.length ? check.events.map(names.event).join(" + ") : "no Event";
    const hours = check.advance_hours > 0 ? `, then ${check.advance_hours} h` : "";
    const scope = check.scope === "local" ? " (local)" : "";
    return `${events}${hours}${scope} · ${check.assertions.length} assertion${check.assertions.length === 1 ? "" : "s"}`;
  }
  const at = check.period !== undefined ? `at ${check.period}` : check.statistic;
  const tol = check.tolerance > 0 && (check.cmp === "==" || check.cmp === "!=") ? ` ± ${check.tolerance}` : "";
  return `${names.simulation(check.simulation)} · ${check.column} ${at} ${SYMBOL[check.cmp]} ${check.value}${tol}`;
}

/** A starting check for a new Expectation, on the model's own ids. */
export function templateCheck(eventId: string | undefined, elementId: string | undefined): Expectation["check"] {
  return {
    kind: "scenario",
    events: eventId ? [eventId] : [],
    advance_hours: 0,
    scope: "global",
    assertions: [{ element: elementId ?? "element-id", quantifier: "all", path: ["functionality"], cmp: ">=", value: 1 }],
  };
}
