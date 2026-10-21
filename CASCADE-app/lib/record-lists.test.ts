import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { RECORD_LISTS } from "./record-lists";
import { ProjectFieldsSchema } from "./schemas/network";
import { ModelConfigurationSchema } from "./schemas/config";

type Inner = { def: { type: string; out?: Inner }; unwrap?: () => Inner };

/** The fields of a schema that hold a list, under any optional, default, refinement or preprocessing. */
function listFields(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([, field]) => {
      let s = field as unknown as Inner;
      while (s.def.type !== "array" && (s.unwrap || s.def.out)) s = s.unwrap ? s.unwrap() : s.def.out!;
      return s.def.type === "array";
    })
    .map(([key]) => key);
}

describe("the record lists", () => {
  it("name every list the project and the Model Configuration hold, or say why one is left out", () => {
    // Lists of values, or with an undo of their own, that no row describes.
    const notRecords = new Set(["update_history", "functionality_scale", "level_scale", "flow_ratio_thresholds"]);
    const rows = (at: string) => RECORD_LISTS.filter((l) => l.at === at).map((l) => l.key).sort();
    expect(listFields(ProjectFieldsSchema.shape).filter((k) => !notRecords.has(k)).sort()).toEqual(rows("project"));
    expect(listFields(ModelConfigurationSchema.shape).filter((k) => !notRecords.has(k)).sort()).toEqual(rows("config"));
  });
});
