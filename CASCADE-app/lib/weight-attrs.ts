/**
 * The keys that are never a numeric weight, shared by the two places that scan
 * Elements for weight candidates.
 *
 * Both scanners walk an Element's own fields looking for numbers, so both have
 * to exclude the numbers that are identity or layout rather than magnitude —
 * `x`, `y`, an id. That part is the same question and lives here once.
 *
 * What each scanner adds on top is NOT the same question, which is why this
 * module exports a base rather than a finished list:
 *
 *  - Weight expressions (`lib/topological-analysis.ts`) exclude `source` and
 *    `target`, which exist only on edges.
 *  - Operativity weighting (`lib/oi-weight-attrs.ts`) excludes `functionality`,
 *    because the Operativity Score is a weighted mean OF functionality and
 *    weighting it by itself is circular. Weight expressions, which compute
 *    something else entirely, offer it deliberately.
 *
 * Keeping the deltas at their call sites means a future reader sees the reason
 * next to the exclusion, instead of one merged list that quietly serves two
 * different purposes.
 */

/** Identity, layout and Scenario bookkeeping — numeric, but never a magnitude. */
export const NON_WEIGHT_KEYS_BASE: readonly string[] = [
  "id",
  "type",
  "label",
  "canvas_id",
  "node_categories",
  "icon",
  "direct_damage",
  "functionality_time",
  "time_restored",
  "x",
  "y",
  "positionAbsolute",
];
