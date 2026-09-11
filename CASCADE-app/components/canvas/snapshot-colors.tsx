"use client";

/**
 * SnapshotColors — marks a React Flow subtree as a *snapshot* view rather than
 * the live canvas, and supplies the element colours it should use.
 *
 * Why a context and not a prop on the node data: node data is the schema type
 * (`CascadeNode`), and a rendering concern has no business being bolted onto it.
 * A context also says the right thing — "everything below here is a snapshot" —
 * to nodes and edges alike, without threading a flag through React Flow.
 *
 * Null (the default) means the live canvas: nodes fall back to the live Analysis
 * Heatmap in the store. Non-null means a snapshot: nodes use the map given here
 * and ignore the live heatmap entirely, so a saved Scorecard entry keeps showing
 * the Analysis it was saved with no matter what is painted on the canvas now.
 * An empty map is therefore meaningful — it says "snapshot, no heatmap".
 */

import { createContext, useContext } from "react";

const SnapshotColorsContext = createContext<Record<string, string> | null>(null);

export const SnapshotColorsProvider = SnapshotColorsContext.Provider;

/**
 * The heatmap colour for one element: the snapshot's own, or the live store's
 * when this is the live canvas. `liveColor` is passed in because the caller has
 * already subscribed to the store — hooks cannot be called conditionally.
 */
export function useElementHeatmapColor(id: string | undefined, liveColor: string | null): string | null {
  const snapshotColors = useContext(SnapshotColorsContext);
  if (snapshotColors === null) return liveColor;
  return (id && snapshotColors[id]) ?? null;
}
