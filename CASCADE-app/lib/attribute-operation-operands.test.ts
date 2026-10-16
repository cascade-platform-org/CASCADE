/**
 * An Attribute Operation's operand (ADR-0021, revised 2026-10-09 and
 * 2026-10-12): `value` times each factor it names — a Parameter, a Series at
 * this Element and the period, and the number the Element holds at `of`. The
 * `of` cases express a rule on a remembered value (the Coop Noncello Art. 8
 * payout, run end to end through the step operator); the Parameter and Series
 * cases check precedence and every refusal.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { applyOperationTo, eventContext, NO_CONTEXT, type OperandContext } from "./attribute-operations";
import { applyEventToSnapshot } from "./event-application";
import { dryRunProblems } from "./temporal-dry-run";
import type { Series } from "./schemas/series";
import type { EventDefinition } from "./schemas/config";
import { runTimeline } from "./step-operator";
import { planTimeline } from "./timeline-plan";
import { runTable } from "./temporal-metrics";
import { docToDraft, draftToDoc, llmContext } from "./temporal-simulation-text";
import { AttributeOperationSchema, type AttributeOperation } from "./schemas/attribute-operation";
import type { GraphSnapshot, Node } from "./schemas/network";
import type { TemporalSimulation } from "./schemas/temporal-simulation";

const N = 3;
const bank = (id: string, balance: number): Node => ({ id, label: id, node_type: "Infrastructure", functionality: N, properties: { balance } });
const el = (balance: number, opening?: number) => ({ id: "a", functionality: N, properties: { balance, ...(opening === undefined ? {} : { opening }) } });

describe("an operation with of", () => {
  it("copies a field with set, and scales the operand by what the Element holds", () => {
    const set = applyOperationTo(el(80), "node", { element: "a", path: ["properties", "opening"], op: "set", value: 1, of: ["properties", "balance"] }, N);
    expect("element" in set && set.element.properties).toEqual({ balance: 80, opening: 80 });
    const add = applyOperationTo(el(120, 80), "node", { element: "a", path: ["properties", "balance"], op: "add", value: -0.5, of: ["properties", "opening"] }, N);
    expect("element" in add && (add.element.properties as { balance: number }).balance).toBe(80);
  });

  it("is refused when the Element holds no number there", () => {
    const r = applyOperationTo(el(10), "node", { element: "a", path: ["properties", "balance"], op: "add", value: 1, of: ["properties", "missing"] }, N);
    expect(r).toEqual({ error: "properties › balance: of properties › missing: the Element holds no value there" });
  });

  it("needs a number value, its factor", () => {
    expect(AttributeOperationSchema.safeParse({ element: "a", path: ["p"], op: "set", value: "x", of: ["q"] }).success).toBe(false);
  });
});

describe("the Art. 8 rule as a Temporal Simulation", () => {
  const doc: TemporalSimulation = {
    format: "cascade.temporal-simulation/v1",
    parameters: [],
    timeline: { name: "Art. 8", steps: [{ label: "2024-01", unit: "month", repeat: 12, phases: [{ events: [], propagate: false }] }] },
    profile: {
      // January: remember the opening balance, kept only when positive.
      "2024-01": [
        { where: { kind: "node" }, path: ["properties", "opening"], op: "set", value: 1, of: ["properties", "balance"] },
        { where: { kind: "node" }, path: ["properties", "opening"], op: "at_least", value: 0 },
      ],
      "2024-03": [{ where: { kind: "node" }, path: ["properties", "balance"], op: "add", value: 40 }],
      // June: pay out half of it.
      "2024-06": [{ where: { kind: "node" }, path: ["properties", "balance"], op: "add", value: -0.5, of: ["properties", "opening"] }],
    },
    metrics: [{ name: "Total", target: { kind: "node" }, path: ["properties", "balance"], read: "state", aggregate: "sum" }],
    standard_metrics: [],
    scope: "global",
  };

  it("pays 50% of each positive opening balance in June, whatever happened in between", async () => {
    const start: GraphSnapshot = { nodes: { a: bank("a", 100), b: bank("b", -20) }, edges: {}, canvases: [] };
    const record = await runTimeline({
      start, plan: planTimeline(doc.timeline), profile: doc.profile, events: [], n: N,
      propagate: async (s) => ({ snapshot: s, flow: { served_ratio: {}, stored: {} } }),
    });
    const total = runTable(record, doc.metrics, N, []).rows.map((r) => r.values[0]);
    // 80 at start; +80 in March; −50 (half of a's 100; b's −20 pays nothing) in June.
    expect(total[0]).toBe(80);
    expect(total[2]).toBe(160);
    expect(total[5]).toBe(110);
  });

  it("keeps of through the Timeline grid's rows", () => {
    let id = 0;
    expect(draftToDoc(docToDraft(doc, () => String(id++))).profile).toEqual(doc.profile);
  });
});

describe("the Simulation's LLM context", () => {
  it("lists each Element's properties, where a model keeps its own quantities", () => {
    const op: AttributeOperation = { element: "a", path: ["properties", "balance"], op: "add", value: 1 };
    const text = llmContext(
      { format: "cascade.temporal-simulation/v1", timeline: { name: "t", steps: [] }, profile: { x: [op] }, metrics: [], standard_metrics: [], scope: "global", parameters: [] },
      { events: [], categories: [], functionality_scale: DEFAULT_CONFIG.functionality_scale },
      { nodes: { a: bank("a", 10007) }, edges: {}, canvases: {} },
    );
    expect(text).toContain('properties: {"balance":10007}');
  });
});

describe("an operand with a Parameter and a Series", () => {
  const worked: Series = { name: "worked_h", rows: { a: { "2024-01": 100, "2024-02": 120 }, "*": { "2024-01": 7, "2024-03": 9 } } };
  const ctx = (over: Partial<OperandContext> = {}): OperandContext => ({ period: "2024-01", parameters: { share: 0.5 }, series: [worked], ...over });
  const op = (over: Partial<AttributeOperation>): AttributeOperation => ({ element: "a", path: ["properties", "balance"], op: "add", value: 1, ...over });
  const balance = (r: ReturnType<typeof applyOperationTo>) => ("element" in r ? (r.element.properties as { balance: number }).balance : r.error);

  it("is value × parameter × series × of", () => {
    expect(balance(applyOperationTo(el(10, 4), "node", op({ value: 2, parameter: "share", series: "worked_h", of: ["properties", "opening"] }), N, ctx()))).toBe(10 + 2 * 0.5 * 100 * 4);
  });

  it("reads the Element's own row, the * row only when it has none, and never 0 for a gap", () => {
    const other = { id: "b", functionality: N, properties: { balance: 0 } };
    expect(balance(applyOperationTo(other, "node", op({ element: "b", series: "worked_h" }), N, ctx()))).toBe(7);
    expect(balance(applyOperationTo(el(0), "node", op({ series: "worked_h" }), N, ctx({ period: "2024-03" })))).toBe(
      "properties › balance: Series worked_h has no value for this Element in 2024-03",
    );
    expect(balance(applyOperationTo(other, "node", op({ element: "b", series: "worked_h" }), N, ctx({ period: "2024-02" })))).toBe(
      "properties › balance: Series worked_h has no value for its * row in 2024-02",
    );
  });

  it("refuses each factor without a value, with its reason", () => {
    const refused = (o: Partial<AttributeOperation>, c: OperandContext) => balance(applyOperationTo(el(0), "node", op(o), N, c));
    expect(refused({ parameter: "missing" }, ctx())).toMatch(/Parameter missing has no value here/);
    expect(refused({ series: "nope" }, ctx())).toMatch(/no Series nope/);
    expect(refused({ series: "worked_h" }, ctx({ period: undefined }))).toMatch(/read only inside a Temporal Simulation run/);
    expect(refused({ series: "worked_h" }, { ...ctx(), series: [{ name: "worked_h", rows: { z: {} } }] })).toMatch(/no row for this Element and no \* row/);
    expect(refused({ parameter: "share" }, NO_CONTEXT)).toMatch(/Parameter share has no value here/);
  });

  it("gives a run's Parameter precedence over an Event's default, which serves a hand-fired Event", () => {
    const event = { parameter_defaults: { share: 0.25, only_default: 3 } };
    expect(eventContext(ctx(), event).parameters).toEqual({ share: 0.5, only_default: 3 });
    expect(eventContext(NO_CONTEXT, event).parameters).toEqual({ share: 0.25, only_default: 3 });
  });

  it("applies a hand-fired Event with its defaults, refusing what reads a Series", () => {
    const snapshot: GraphSnapshot = { nodes: { a: bank("a", 10) }, edges: {}, canvases: [] };
    const event: EventDefinition = {
      id: "pay", label: "Pay", type: "restorative", frequency_per_10y: 0, parameter_defaults: { share: 0.1 },
      attribute_operations: [op({ value: 100, parameter: "share" }), op({ series: "worked_h" })],
    };
    const out = applyEventToSnapshot(snapshot, event, N, { parameters: {}, series: [worked] });
    expect((out.snapshot.nodes.a.properties as { balance: number }).balance).toBe(20);
    expect(out.warnings).toEqual([expect.stringMatching(/Series worked_h is read only inside a Temporal Simulation run/)]);
  });

  it("runs a profile reading a Series per period label and an Event reading the Simulation's Parameter", async () => {
    const start: GraphSnapshot = { nodes: { a: bank("a", 0) }, edges: {}, canvases: [] };
    const pay: EventDefinition = { id: "pay", label: "Pay", type: "restorative", frequency_per_10y: 0, parameter_defaults: { share: 0.1 }, attribute_operations: [op({ value: 1000, parameter: "share" })] };
    const timeline = { name: "t", steps: [{ label: "2024-01", unit: "month" as const, repeat: 2, phases: [{ events: [{ event: "pay", every: 2 }], propagate: false }] }] };
    const profile = { "2024-01": [op({ series: "worked_h" })], "2024-02": [op({ series: "worked_h" })] };
    const record = await runTimeline({
      start, plan: planTimeline(timeline), profile, events: [pay], n: N, parameters: { share: 0.5 }, series: [worked],
      propagate: async (s) => ({ snapshot: s, flow: { served_ratio: {}, stored: {} } }),
    });
    const metric = { name: "b", target: { kind: "node" as const }, path: ["properties", "balance"], read: "state" as const, aggregate: "sum" as const };
    expect(runTable(record, [metric], N, []).rows.map((r) => r.values[0])).toEqual([100, 100 + 120 + 500]);
    expect(record.warnings).toEqual([]);
  });

  it("is checked before a run: a gap in a Series and an undeclared Parameter are reported", () => {
    const model = { nodes: { a: bank("a", 0) }, edges: {}, canvases: {} };
    const doc: TemporalSimulation = {
      format: "cascade.temporal-simulation/v1", parameters: [], metrics: [], standard_metrics: [], scope: "global",
      timeline: { name: "t", steps: [{ label: "2024-01", unit: "month", repeat: 3, phases: [] }] },
      profile: { "2024-03": [op({ series: "worked_h" })], "2024-02": [op({ parameter: "share" })] },
    };
    const out = dryRunProblems(doc, [], model, N, [worked]).join("\n");
    expect(out).toMatch(/Series worked_h has no value for this Element in 2024-03/);
    expect(out).toMatch(/Parameter share has no value here/);
  });
});
