/**
 * ui-anchors.ts — ids for the controls a panel flies back into when it closes.
 *
 * A panel and the button that reopens it live in different components, so the
 * panel needs some way to find that button's position on screen. An id shared
 * through one module keeps the pair honest: rename the constant and both sides
 * move, rather than a string literal drifting out of sync in one of them.
 */

/** The Status Bar's "Rules: N active" control — home of the Active Rules panel. */
export const RULES_ANCHOR_ID = "cascade-rules-anchor";

/** The Topbar's "Scorecard" button — home of the Scorecard window. */
export const SCORECARD_ANCHOR_ID = "cascade-scorecard-anchor";

/** The Action Bar's "Time" button — home of the Temporal Jump window. */
export const TEMPORAL_ANCHOR_ID = "cascade-temporal-anchor";

/** The Topbar's "Help" button — home of the User Manual window. */
export const HELP_ANCHOR_ID = "cascade-help-anchor";

/** The Active Rules window's "Manual" button — home of the Rules Manual window. */
export const RULES_MANUAL_ANCHOR_ID = "cascade-rules-manual-anchor";
