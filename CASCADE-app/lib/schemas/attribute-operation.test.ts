import { describe, expect, it } from "vitest";
import { ModelConfigurationSchema } from "./config";

const base = {
  version: "1",
  meta: { name: "t" },
  functionality_scale: [{ level: 1, label: "1", color: "#000" }, { level: 2, label: "2", color: "#fff" }],
  categories: [],
};

describe("retired attribute_mutations", () => {
  it("load as set operations, one per value, ahead of the Event's own (mirrors the backend)", () => {
    const parsed = ModelConfigurationSchema.parse({
      ...base,
      events: [{
        id: "e", label: "e", type: "disservice",
        attribute_mutations: { "J.12.A.functionality_time": 6, "J2.category_dependency_profiles": { water: { demand: 40 } } },
        attribute_operations: [{ element: "x", path: ["functionality"], op: "set", value: 1 }],
      }],
    });
    const [event] = parsed.events;
    expect(event).not.toHaveProperty("attribute_mutations");
    expect(event.attribute_operations).toEqual([
      { element: "J.12.A", path: ["functionality_time"], op: "set", value: 6 },
      { element: "J2", path: ["category_dependency_profiles", "water", "demand"], op: "set", value: 40 },
      { element: "x", path: ["functionality"], op: "set", value: 1 },
    ]);
  });

  it("leave an Event without them unchanged", () => {
    const parsed = ModelConfigurationSchema.parse({ ...base, events: [{ id: "r", label: "Repair", type: "restorative" }] });
    expect(parsed.events[0]).toMatchObject({ id: "r", type: "restorative" });
    expect(parsed.events[0].attribute_operations).toBeUndefined();
  });

  it("and a temporal_jump Event (time passing is a Phase's advance_hours now) is dropped", () => {
    const parsed = ModelConfigurationSchema.parse({ ...base, events: [{ id: "tj", label: "+24 h", type: "temporal_jump", duration_hours: 24 }, { id: "q", label: "Quake", type: "hazard" }] });
    expect(parsed.events.map((e) => e.id)).toEqual(["q"]);
  });
});
