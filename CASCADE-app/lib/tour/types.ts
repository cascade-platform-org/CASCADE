/**
 * types.ts — what every tour is made of.
 *
 * The step shape, the anchor names a step may point at, and the two helpers
 * every tour needs. This used to live inside `first-run-tour.ts`, which made
 * the contract for all tours a detail of the first one: each new tour imported
 * its type from there and then pasted its own copy of `awaitUpdate` and
 * `missingTourAnchors`.
 */

import { useHistoryStore } from "@/store/history-store";

/**
 * Every `data-tour` attribute the app renders. `TourStep.anchor` is typed
 * against it, so a mistyped or removed anchor is a compile error rather than a
 * step that silently renders centred with a dev-only console warning.
 *
 * Kept in sync with the `data-tour` attributes in `components/`.
 */
export const TOUR_ANCHORS = [
  "canvas",
  "inspector",
  "events",
  "propagate",
  "reset",
  "temporal",
  "help",
  "config",
  "analyse",
  "scorecard",
  "repair",
  "file",
  "rules",
  "global-view",
  "add-canvas",
  "fit-view",
  "legend",
  "tool-add-node",
  "tool-add-edge",
  "tool-inter-canvas-edge",
] as const;

type TourAnchor = (typeof TOUR_ANCHORS)[number];

export interface TourStep {
  /** Value of the target's `data-tour` attribute. Omit for a centred step. */
  anchor?: TourAnchor;
  /**
   * Finer spotlight than `anchor` can express, resolved when the tour starts.
   * Falls back to `anchor` when it returns null.
   */
  resolve?: () => HTMLElement | null;
  title: string;
  body: string;
  side?: "top" | "bottom" | "left" | "right";
  /**
   * `data-tour` anchor to position the card against, when sitting next to the
   * ringed target would cover what the step asks the user to use — a control
   * that opens a panel over its own surroundings. The ring stays on the target.
   */
  cardAnchor?: TourAnchor;
  /**
   * Called when the step appears; returns a predicate re-checked on every store
   * change. The step advances by itself once the predicate turns true.
   */
  waitFor?: () => () => boolean;
  /** Shown under the body while waiting, in place of a plain "click Next". */
  waitHint?: string;
  /**
   * A tour to hand over to, offered as a button on this step (a closing step,
   * in practice). Typed as a plain string rather than `TourId` so the step
   * files stay independent of the registry that collects them — the runner
   * looks it up and shows nothing if it does not resolve.
   */
  nextTour?: string;
}

/**
 * Waits for a *new* history entry of the given kind. Comparing entry ids rather
 * than just the type is what stops a pre-loaded scenario from satisfying the
 * step before the user has done anything: the tour's sample ships with an Event
 * already applied, so an absolute check like "the latest entry is an event"
 * would be true on arrival and the step would skip itself.
 *
 * `updateHistory` is latest-first, so entry 0 is the most recent action.
 */
export function awaitUpdate(type: string): () => () => boolean {
  return () => {
    const armedAt = useHistoryStore.getState().updateHistory[0]?.id;
    return () => {
      const latest = useHistoryStore.getState().updateHistory[0];
      return !!latest && latest.id !== armedAt && latest.update_type === type;
    };
  };
}

/**
 * Anchors a tour names that are not currently in the DOM. Dev guard — the
 * Inspector steps are why it is checked at run time rather than in a test: that
 * panel only exists once something is selected.
 */
export function missingTourAnchors(steps: TourStep[]): string[] {
  if (typeof document === "undefined") return [];
  const named = steps.flatMap((s) => [s.anchor, s.cardAnchor]);
  return [...new Set(named.filter((a): a is TourAnchor => !!a))].filter(
    (a) => !document.querySelector(`[data-tour="${a}"]`),
  );
}
