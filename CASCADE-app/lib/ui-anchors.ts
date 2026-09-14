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
