import { describe, expect, it } from "vitest";
import {
  computeRuleSuggestions,
  contextLabel,
  extractTargetFromRule,
  type RuleSuggestionCtx,
} from "./rule-suggestions";

const ctx: RuleSuggestionCtx = {
  elementLabels: ["Pump-1", "Hub"],
  categoryNames: ["water", "power"],
  functionalityLabels: ["not performed", "severe", "variable", "nominal"],
  functionalityN: 4,
};

const suggest = (text: string) => computeRuleSuggestions(text, text.length, ctx);
const hint = (text: string) => contextLabel(text, text.length);

describe("level offsets in propagation rules (ADR-0025)", () => {
  it("offers an offset sign beside 'propagates' after the function", () => {
    expect(suggest("worst_of(water, power) ")).toEqual(["propagates", "+", "-"]);
  });

  it("offers 1..N-1 levels after a sign", () => {
    expect(suggest("worst_of(water, power) + ")).toEqual(["1", "2", "3"]);
    expect(hint("worst_of(water, power) - ")).toBe("number of levels");
  });

  it("expects 'propagates' once the outer offset is written", () => {
    expect(suggest("worst_of(water, power) + 1 ")).toEqual(["propagates"]);
  });

  it("keeps suggesting arguments after an offset inside the function", () => {
    expect(suggest("worst_of(water + 1, ")).toEqual(["Pump-1", "Hub", "water", "power"]);
  });

  it("reads a hyphen in a Specific rule as part of a label", () => {
    expect(hint("if Pump-")).not.toBe("number of levels");
    expect(suggest("if Pump-1 ")).toContain("is");
  });

  it("finds the target of a rule with offsets", () => {
    expect(extractTargetFromRule("worst_of(a + 1, b) - 1 propagates to Hub")).toBe("Hub");
  });
});
