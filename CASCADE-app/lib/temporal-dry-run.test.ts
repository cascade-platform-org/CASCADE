/**
 * temporal-dry-run — a valid Temporal Simulation that cannot work on this
 * model is reported before a run (ADR-0019 §7): refused operations grouped by
 * reason with the Elements they hit, and Metrics nothing can answer.
 */

import { describe, expect, it } from "vitest";
import { dryRunProblems } from "./temporal-dry-run";
import type { FilterableModel } from "./element-filter";
import type { TemporalSimulation } from "./schemas/temporal-simulation";

const N = 3;
const bank = (id: string, balance?: number) => ({ id, label: `Bank ${id}`, node_type: "Infrastructure", functionality: N, ...(balance === undefined ? {} : { properties: { balance } }) });
const model: FilterableModel = { nodes: { a: bank("a", 100), b: bank("b", -10) }, edges: {}, canvases: {} };

const doc = (profile: TemporalSimulation["profile"], metrics: TemporalSimulation["metrics"] = []): TemporalSimulation => ({
  format: "cascade.temporal-simulation/v1",
  timeline: { name: "t", steps: [{ label: "2024-01", unit: "month", repeat: 6, phases: [{ events: [], propagate: false }] }] },
  profile,
  metrics,
  standard_metrics: [],
  scope: "global",
});
const all = { where: { kind: "node" as const } };

describe("dryRunProblems", () => {
  it("groups the operations a run would refuse, naming the Elements and the first period", () => {
    const out = dryRunProblems(doc({ "2024-01": [{ ...all, path: ["supply_capacity", "bank", "level"], op: "add", value: 5 }] }), [], model, N);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^profile: supply_capacity › bank › level: add on an absent value/);
    expect(out[0]).toMatch(/2 Elements \(Bank a, Bank b\), first in 2024-01/);
  });

  it("is silent when an earlier operation creates the field", () => {
    const out = dryRunProblems(doc({
      "2024-01": [{ ...all, path: ["properties", "opening"], op: "set", value: 1, of: ["properties", "balance"] }],
      "2024-06": [{ ...all, path: ["properties", "balance"], op: "add", value: -0.5, of: ["properties", "opening"] }],
    }), [], model, N);
    expect(out).toEqual([]);
  });

  it("reports a Metric that no matched Element can answer", () => {
    const out = dryRunProblems(doc({}, [{ name: "Total", target: { kind: "node" }, path: ["properties", "missing"], read: "state", aggregate: "sum" }]), [], model, N);
    expect(out).toEqual(['metrics[0] ("Total"): none of its 2 Elements holds a number at properties › missing, so it shows "—".']);
  });

  it("applies the attribute operations of the Events that fire", () => {
    const d = doc({});
    d.timeline.steps[0].phases[0].events = [{ event: "e", every: 1 }];
    const out = dryRunProblems(d, [{ id: "e", label: "Payday", type: "disservice", frequency_per_10y: 0, attribute_operations: [{ element: "a", path: ["properties", "nope"], op: "mul", value: 2 }] }], model, N);
    expect(out[0]).toMatch(/^Event "Payday": properties › nope: mul on an absent value/);
  });
});
