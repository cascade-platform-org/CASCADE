import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepEqual } from "@/lib/graph-diff";
import { parseBundle } from "@/lib/file-io";
import { applyModelDiff, diffModel, isEmptyModelDiff, type ModelSnapshot } from "./model-diff";

const bundle = parseBundle(JSON.parse(readFileSync("samples/public/IJDRR_example.json", "utf8")))!;
const base: ModelSnapshot = {
  settings: { name: bundle.project.meta.name },
  temporal_simulations: bundle.project.temporal_simulations ?? [],
  series: [{ name: "worked_h", rows: { "*": { "2024-01": 1 } } }],
  config: bundle.config,
};
const copy = (m: ModelSnapshot): ModelSnapshot => JSON.parse(JSON.stringify(m));

/** Undo gives back `before`, redo gives back `after`. */
function roundTrips(before: ModelSnapshot, after: ModelSnapshot) {
  const d = diffModel(before, after);
  expect(deepEqual(applyModelDiff(after, d, "backward"), before)).toBe(true);
  expect(deepEqual(applyModelDiff(before, d, "forward"), after)).toBe(true);
  return d;
}

describe("Model Diff", () => {
  it("is empty when nothing changed", () => {
    expect(isEmptyModelDiff(diffModel(base, copy(base)))).toBe(true);
  });

  it("records a typed field as that field alone", () => {
    const after = copy(base);
    after.temporal_simulations![0].timeline.name = "Renamed";
    const d = roundTrips(base, after);
    expect(d.records).toEqual([{ id: `simulation:${base.temporal_simulations![0].id}`, op: "update", fields: [{ field: "timeline", path: ["name"], before: base.temporal_simulations![0].timeline.name, after: "Renamed" }] }]);
  });

  it("undoes an added, a removed and a reordered record", () => {
    const after = copy(base);
    after.config!.events = [...after.config!.events].reverse();
    after.config!.events.push({ id: "new", label: "New", type: "hazard", frequency_per_10y: 1 });
    after.config!.categories = after.config!.categories.slice(1);
    after.series = [];
    const d = roundTrips(base, after);
    expect(d.orders.map((o) => o.key).sort()).toEqual(["categories", "events", "series"]);
  });

  it("undoes the scales, the templates and the settings", () => {
    const after = copy(base);
    after.config!.functionality_scale = after.config!.functionality_scale.slice(0, 2).map((l, i) => ({ ...l, level: i + 1 }));
    after.config!.level_scale = [{ label: "Low", below: 0, role: "deficit" } as never];
    after.config!.node_defaults = { Pump: { label: "Pump" } as never };
    after.settings = { name: "Other", global_graph_type: "x" };
    roundTrips(base, after);
  });

  it("applies to a snapshot holding only some parts, naming only those", () => {
    const only: ModelSnapshot = { temporal_simulations: base.temporal_simulations };
    const after = copy(only);
    after.temporal_simulations![0].parameters = [{ name: "share", value: 0.5 }];
    const d = roundTrips(only, after);
    expect(d.records.every((r) => r.id.startsWith("simulation:"))).toBe(true);
  });
});
