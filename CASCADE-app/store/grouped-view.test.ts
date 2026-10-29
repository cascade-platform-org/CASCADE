import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import type { Project } from "@/lib/schemas/network";

const ui = () => useUiStore.getState();

describe("grouped view state (session only)", () => {
  beforeEach(() => ui().resetGroupedView());

  it("toggles a Canvas collapsed and back", () => {
    ui().toggleGroupedCollapsed("cv_0");
    ui().toggleGroupedCollapsed("cv_1");
    ui().toggleGroupedCollapsed("cv_0");
    expect(ui().groupedCollapsed).toEqual(["cv_1"]);
  });

  it("remembers where Canvases were dragged until Re-arrange", () => {
    ui().moveGroupedCanvases({ cv_0: { x: 10, y: 20 } });
    ui().moveGroupedCanvases({ cv_1: { x: 30, y: 40 } });
    expect(ui().groupedMoved).toEqual({ cv_0: { x: 10, y: 20 }, cv_1: { x: 30, y: 40 } });
    ui().clearGroupedMoves();
    expect(ui().groupedMoved).toEqual({});
  });

  it("forgets the arrangement when another project loads (imported models reuse cv_0, cv_1…)", () => {
    ui().toggleGroupedCollapsed("cv_0");
    ui().moveGroupedCanvases({ cv_0: { x: 1, y: 2 } });
    useCanvasStore.getState().fromProject({
      version: "2.0", meta: { name: "another" }, nodes: {}, edges: {}, canvases: [],
    } as unknown as Project);
    expect(ui().groupedCollapsed).toEqual([]);
    expect(ui().groupedMoved).toEqual({});
  });
});
