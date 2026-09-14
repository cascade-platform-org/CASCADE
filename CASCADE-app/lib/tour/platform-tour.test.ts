/**
 * Gates and shape of "Analyse and decide".
 *
 * Its two gates are panel-open flags on the stores, which is the rename this
 * tour is exposed to: `scorecardPanelOpen` or `analysisPageOpen` moving leaves
 * the card rendering and never advancing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "@/store/ui-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { PLATFORM_TOUR } from "./platform-tour";
import { gate } from "./test-helpers";

beforeEach(() => {
  useUiStore.setState({ scorecardPanelOpen: false } as never);
  useAnalysisStore.setState({ analysisPageOpen: false } as never);
});

describe("platform tour — every step's gate", () => {
  it("'The Scorecard keeps the comparisons' opens when that panel does", () => {
    const open = gate(PLATFORM_TOUR, "The Scorecard keeps the comparisons");
    expect(open()).toBe(false);
    useUiStore.setState({ scorecardPanelOpen: true } as never);
    expect(open()).toBe(true);
  });

  it("'Analysis: structure versus consequence' opens when the Analysis window does", () => {
    const open = gate(PLATFORM_TOUR, "Analysis: structure versus consequence");
    expect(open()).toBe(false);
    useAnalysisStore.setState({ analysisPageOpen: true } as never);
    expect(open()).toBe(true);
  });
});

describe("platform tour — shape", () => {
  it("opens and closes with a step that asks for nothing", () => {
    expect(PLATFORM_TOUR[0].waitFor).toBeUndefined();
    expect(PLATFORM_TOUR[PLATFORM_TOUR.length - 1].waitFor).toBeUndefined();
  });

  it("gives every waiting step a hint, so the tour never looks stuck", () => {
    for (const step of PLATFORM_TOUR) {
      if (step.waitFor) expect(step.waitHint, `"${step.title}" waits with no hint`).toBeTruthy();
    }
  });

  it("stays walkable without a server", () => {
    // A guest has neither can_propagate nor engine evaluations. This tour
    // reads results rather than producing them, so almost nothing gates.
    const gated = PLATFORM_TOUR.filter((s) => s.waitFor).length;
    expect(gated).toBeLessThan(PLATFORM_TOUR.length / 3);
  });

});
