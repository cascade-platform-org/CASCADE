/** Parameters in the window, the Event editor and the text forms (ADR-0019/0021, revised 2026-10-12). */

import { beforeEach, describe, expect, it } from "vitest";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { handFiringNotes } from "@/components/controls/config-modal/attribute-operations-editor";
import { describeOperand } from "./temporal-simulation-explainers";
import { EXAMPLE_DOC, checkDoc, llmContext, serializeDoc } from "./temporal-simulation-text";
import { DEFAULT_CONFIG } from "@/store/config-store";

const store = () => useTemporalSimulationStore.getState();

beforeEach(() => store().loadFromProject(undefined));

describe("Parameters in the window", () => {
  it("are saved with the Simulation, and a rename follows into the profile rows that read it", () => {
    store().updateParameters((ps) => { ps.push({ name: "share", value: 0.5 }); });
    store().updateProfile((rows) => {
      rows.push({ id: "r", element: "a", path: ["properties", "x"], op: "add", parameter: "share", values: { "2023-01": 1 } });
    });
    store().renameParameter("share", "art8_share");
    const saved = store().simulations[0];
    expect(saved.parameters).toEqual([{ name: "art8_share", value: 0.5 }]);
    expect(saved.profile["2023-01"]).toEqual([{ element: "a", path: ["properties", "x"], op: "add", value: 1, parameter: "art8_share" }]);
  });

  it("keep the last valid definition while a name is not an identifier", () => {
    store().updateParameters((ps) => { ps.push({ name: "ok", value: 1 }); });
    store().renameParameter("ok", "1bad");
    expect(store().unsaved.join(" ")).toMatch(/letters, digits and _/);
    expect(store().simulations[0].parameters[0].name).toBe("ok");
  });
});

describe("an Event fired by hand", () => {
  const op = { element: "a", path: ["p"], op: "add" as const, value: 1 };
  it("is noted when an operation reads a Parameter without a default or a Series", () => {
    expect(handFiringNotes({ attribute_operations: [{ ...op, parameter: "share" }, { ...op, series: "worked_h" }] })).toEqual([
      "Fired by hand, operation 1 is refused: Parameter share has no default here.",
      "Fired by hand, operation 2 is refused: Series worked_h is read only inside a Temporal Simulation run.",
    ]);
    expect(handFiringNotes({ attribute_operations: [{ ...op, parameter: "share" }], parameter_defaults: { share: 0.5 } })).toEqual([]);
    expect(handFiringNotes({ attribute_operations: [{ ...op, series: "worked_h" }], temporal_simulation_only: true })).toEqual([]);
  });
});

describe("the operand in words and in text", () => {
  it("names each factor, with a Parameter's value when known", () => {
    expect(describeOperand({ value: -1, parameter: "threshold", of: ["capacity", "level_reference"] }, { threshold: 0.2 })).toBe(
      "-1 × Parameter threshold (0.2) × the Element's capacity › level_reference",
    );
    expect(describeOperand({ value: 3 })).toBe("3");
  });

  it("writes parameters only when there are some, and the worked example is valid", () => {
    expect(serializeDoc({ ...EXAMPLE_DOC, parameters: [] })).not.toMatch(/"parameters"/);
    expect(checkDoc(JSON.parse(serializeDoc(EXAMPLE_DOC)))).toMatchObject({ ok: true, doc: { parameters: EXAMPLE_DOC.parameters } });
  });

  it("lists the project's Series for an LLM by name and range, never their values", () => {
    const text = llmContext(EXAMPLE_DOC, DEFAULT_CONFIG, { nodes: {}, edges: {}, canvases: {} }, [
      { name: "worked_h", unit: "h", rows: { a: { "2023-01": 12345, "2023-02": 1 }, "*": { "2023-01": 0 } } },
    ]);
    expect(text).toMatch(/- worked_h — h — 2 rows \(with a \* row for every other Element\) — 2023-01 … 2023-02 \(2\)/);
    expect(text).not.toMatch(/12345/);
    expect(text).toMatch(/"parameter": ParameterName/);
  });
});
