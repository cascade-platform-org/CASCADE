/**
 * test-helpers.ts — shared by the tour specs.
 *
 * A tour gate is armed when its step appears: `waitFor()` captures the state it
 * found and returns the predicate. Every spec needs to do that by step title,
 * so it lives here rather than in three copies that could arm differently.
 */

import type { TourStep } from "@/lib/tour/types";

/** Arm the gate of the step with this title, and return its predicate. */
export function gate(steps: TourStep[], title: string): () => boolean {
  const step = steps.find((s) => s.title === title);
  if (!step?.waitFor) throw new Error(`No step titled "${title}" carries a waitFor`);
  return step.waitFor();
}
