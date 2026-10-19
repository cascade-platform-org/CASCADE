/**
 * element-edit — hand edits of one Element are undoable, and a run of them is
 * one undo step. The Inspector writes on every keystroke; before, most of its
 * fields and every Active Rules action wrote with no history at all.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { editElement } from "./element-edit";
import { runWithHistory } from "./run-with-history";

const history = () => useHistoryStore.getState().updateHistory;
const node = (id = "a") => useCanvasStore.getState().nodes[id];

beforeEach(() => {
  useCanvasStore.getState().reset();
  useHistoryStore.getState().loadHistory([]);
  const canvas = useCanvasStore.getState();
  canvas.addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
  canvas.upsertNode({ id: "a", label: "A", functionality: 4, rules: ["x"] });
  canvas.upsertNode({ id: "b", label: "B", functionality: 4 });
  useHistoryStore.getState().loadHistory([]);
});

describe("editElement", () => {
  it("records a label typed letter by letter as one step, and undo puts the whole label back", () => {
    for (const label of ["Ab", "Abc", "Abcd"]) editElement("node", "a", { label });
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ update_type: "graph_update", label: "Edit label" });
    useCanvasStore.getState().undo();
    expect(node()?.label).toBe("A");
    useCanvasStore.getState().redo();
    expect(node()?.label).toBe("Abcd");
  });

  it("starts a new step for another field, another Element, or anything recorded in between", () => {
    editElement("node", "a", { label: "A1" });
    editElement("node", "a", { importance: 2 });
    editElement("node", "b", { importance: 2 });
    runWithHistory(() => useCanvasStore.getState().updateNode("b", { functionality: 1 }), "Manual functionality edit");
    editElement("node", "b", { importance: 3 });
    expect(history().map((e) => e.label)).toEqual(["Edit importance", "Manual functionality edit", "Edit importance", "Edit importance", "Edit label"]);
  });

  it("keeps every discrete action a step of its own", () => {
    editElement("node", "a", { rules: ["// x"] }, { label: "Toggle rule", coalesce: false });
    editElement("node", "a", { rules: ["x"] }, { label: "Toggle rule", coalesce: false });
    expect(history()).toHaveLength(2);
    useCanvasStore.getState().undo();
    expect(node()?.rules).toEqual(["// x"]);
  });

  it("leaves no step for a run that ends where it began", () => {
    editElement("node", "a", { label: "AB" });
    editElement("node", "a", { label: "A" });
    expect(history()).toHaveLength(0);
    editElement("node", "a", { label: "AC" });
    expect(history()).toHaveLength(1);
  });

  it("records an edit of the Element's condition as a manual Functionality update", () => {
    editElement("node", "a", { direct_damage: true }, { updateType: "manual_functionality_update" });
    expect(history()[0]?.update_type).toBe("manual_functionality_update");
  });
});
