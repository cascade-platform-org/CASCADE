/**
 * new-project.ts — the one way to start an empty project.
 *
 * Two callers need exactly the same blank slate: the New Project screen's
 * "Create project" button, and the build-a-model tour, whose first step asks
 * the user to put a node on an empty Canvas. Keeping one implementation means
 * the tour can never start on a Canvas shaped differently from the one the
 * wizard makes — the steps are written against that shape.
 *
 * It replaces whatever is open, so every caller warns first.
 */

import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { CANVAS_PALETTE } from "@/lib/colors";
import type { Canvas } from "@/lib/schemas/network";

/**
 * The Canvas a new project starts with. Every one of these is editable in the
 * Inspector's Canvas Meta panel the moment the editor opens — name and colour
 * from the Topbar tab menu as well — which is why the wizard stopped asking.
 */
const FIRST_CANVAS_LABEL = "Main Network";

/** Discard the open project and start an empty one with the default config. */
export function createEmptyProject(name?: string, description?: string): void {
  const { loadConfig } = useConfigStore.getState();
  const { fromProject } = useCanvasStore.getState();

  loadConfig(DEFAULT_CONFIG);

  const canvas: Canvas = {
    id: `canvas-${nanoid(8)}`,
    label: FIRST_CANVAS_LABEL,
    color: CANVAS_PALETTE[0],
    georeferenced: false,
    graph: {
      graph_type: DEFAULT_CONFIG.graph_types[0]?.name ?? "default",
      node_ids: [],
      edge_ids: [],
    },
  };

  fromProject({
    version: "2.0",
    meta: {
      name: name?.trim() || "Untitled project",
      description: description?.trim() || undefined,
    },
    nodes: {},
    edges: {},
    canvases: [canvas],
    update_history: [],
    scorecard: [],
  });
}
