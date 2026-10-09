/**
 * Attribute Operations with `of` (ADR-0021, revised 2026-10-09): the operand
 * is `value` × the number the same Element holds at `of`, read just before. It
 * expresses a rule on a remembered value — the Coop Noncello Art. 8 payout,
 * "in June, 50% of the balance at 1 January, nothing when negative" — run here
 * end to end through the step operator.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { applyOperationTo } from "./attribute-operations";
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
      { format: "cascade.temporal-simulation/v1", timeline: { name: "t", steps: [] }, profile: { x: [op] }, metrics: [], standard_metrics: [], scope: "global" },
      { events: [], categories: [], functionality_scale: DEFAULT_CONFIG.functionality_scale },
      { nodes: { a: bank("a", 10007) }, edges: {}, canvases: {} },
    );
    expect(text).toContain('properties: {"balance":10007}');
  });
});
