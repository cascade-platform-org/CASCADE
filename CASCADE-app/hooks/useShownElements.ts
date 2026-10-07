"use client";

import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import type { Edge, Node } from "@/lib/schemas/network";

/**
 * The Element registries the canvas paints: the selected period's reconstructed
 * state while a Temporal Simulation run is shown (the Run View, ADR-0019 §3), the
 * model otherwise. Only painting and the Inspector read through this; anything
 * that edits or saves reads the model, which a run never writes.
 */
export function useShownElements(): { nodes: Record<string, Node>; edges: Record<string, Edge> } {
  const shown = useTemporalSimulationStore((s) => s.shown);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  return shown ? { nodes: shown.nodes, edges: shown.edges } : { nodes, edges };
}
