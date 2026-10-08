import { describe, expect, it } from "vitest";
import { remapConfigEventIds } from "./merge-import";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { Project } from "@/lib/schemas/network";

const source = {
  nodes: { "J.1": { id: "J.1", functionality: 3 }, R1: { id: "R1", functionality: 3 } },
  edges: { R1: { id: "R1", source: "J.1", target: "R1", functionality: 3 } },
} as unknown as Project;

const config = (events: ModelConfiguration["events"]) => ({ events }) as unknown as ModelConfiguration;

describe("remapConfigEventIds", () => {
  it("remaps an operation's element and a filter's exclude, each in its own namespace", () => {
    const out = remapConfigEventIds(
      config([
        {
          id: "e",
          label: "e",
          type: "disservice",
          frequency_per_10y: 0,
          attribute_operations: [
            { element: "J.1", path: ["supply_capacity", "water"], op: "mul", value: 0.5 },
            { where: { kind: "edge", exclude: ["R1"] }, path: ["capacity"], op: "mul", value: 2 },
            { where: { kind: "node", exclude: ["R1"] }, path: ["functionality"], op: "set", value: 1 },
          ],
        },
      ]),
      source,
      { "J.1": "J.1-2", R1: "R1-n" },
      { R1: "R1-e" },
    );
    const ev = out.events[0];
    expect(ev.attribute_operations?.[0].element).toBe("J.1-2");
    expect(ev.attribute_operations?.[1].where?.exclude).toEqual(["R1-e"]);
    expect(ev.attribute_operations?.[2].where?.exclude).toEqual(["R1-n"]);
  });
});
