/**
 * primitives.ts — branded type aliases used throughout CASCADE.
 *
 * These are plain strings/numbers at runtime. The alias name makes the
 * intent visible in every function signature without any runtime cost.
 * Example: a function `f(id: ElementId)` is clearer than `f(id: string)`.
 */

/** Integer 1..N. 1 = worst (critical), N = best (operational). Never a string. */
export type FunctionalityLevel = number;

/** Always integer hours. Convert to other units only at the display layer. */
export type Hours = number;

/** Unique identifier for a node or edge. */
export type ElementId = string;

/** A category name — must match a name in ModelConfig.categories */
export type CategoryName = string;

/** An Event (Hazard or Disservice) ID — must match an id in ModelConfiguration.events */
export type EventId = string;

/** "local" = current Canvas only; "global" = full multi-canvas */
export type PropagationScope = "local" | "global";

export type NodeType = "Source" | "Infrastructure" | "Service" | "Personnel";

/** Discriminates between the two Event subtypes. */
export type EventKind = "hazard" | "disservice";

export type RuleKind = "specific" | "intracategorical" | "intercategorical";

/** ISO 8601 datetime string, e.g. "2026-05-11T08:00:00Z". Always UTC. */
export type ISOTimestamp = string;

/**
 * Which propagation algorithm governs a category.
 * Open string union so future types can be added in config without code changes.
 */
export type CategoryType = "SourceToDemands" | "Requisite" | (string & {});
