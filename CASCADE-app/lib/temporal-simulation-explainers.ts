/**
 * temporal-simulation-explainers.ts — the "What this will do" texts of the
 * Temporal Simulation prototype window.
 *
 * PROTOTYPE. Every control in the window edits a local draft and shows one of
 * these texts instead of acting on the model. Each text states the behaviour
 * the specification commits to (ADR-0019/0020/0021, requirements §9.6), so
 * reading them while clicking through is a review of the specification itself.
 * Kept in one module so the wording can be reviewed in one place.
 */

import type { CalendarUnit, PlannedPeriod, TimelinePlan } from "@/lib/timeline-plan";

export interface Explanation {
  title: string;
  lines: string[];
  /** Where the behaviour is specified. */
  refs: string[];
}

export const EXPLAIN_INTRO: Explanation = {
  title: "Temporal Simulation (prototype)",
  lines: [
    "A Temporal Simulation is a saved, replayable run over many periods: a Timeline of Steps, each applying Events and Propagations and integrating Stocks.",
    "Nothing in this window changes your model or calls the engine. Each control edits a draft and explains here what the built feature will do.",
    "Tabs: Timeline (Steps and Phases), Profile (per-period inputs), Run (the plan, Level Mode, undo/clear/reset), Metrics (custom read-outs), Stock (the two formulas on a sample Stock).",
  ],
  refs: ["ADR-0019", "requirements §9.6"],
};

export const EXPLAIN_TAB: Record<string, Explanation> = {
  timeline: {
    title: "Timeline",
    lines: [
      "The Timeline is the saved input: an ordered table of Steps, each with ordered Phases, plus Periodic rules.",
      "It stores inputs only. Results live in a run record, a cache that can always be recomputed.",
      "Editing a Step in the middle replays the run forward from that period; earlier periods keep their recorded diffs.",
    ],
    refs: ["ADR-0019 §1", "ADR-0019 §3"],
  },
  profile: {
    title: "Profile",
    lines: [
      "The profile holds the per-period exogenous inputs (rates, inflows, demands) as Attribute Operations keyed by period label.",
      "Each period applies its profile operations first, before any Phase Event or Propagation reads them.",
      "It is the same mechanism as an Event's Attribute Operations, so it is validated and recorded the same way.",
    ],
    refs: ["ADR-0019 §1", "ADR-0021"],
  },
  run: {
    title: "Run",
    lines: [
      "Running first performs a Reset, then executes every period in order, calling the engine once per propagating Phase.",
      "The run lands in the undo history as ONE entry; the per-period detail lives in the run record.",
      "In this prototype, Run computes the plan only (labels, Phases, engine calls); no Propagation is sent.",
    ],
    refs: ["ADR-0019 §2", "ADR-0019 §3"],
  },
  metrics: {
    title: "Metrics",
    lines: [
      "A custom Metric is a view definition in Client Configuration: what to read, from which Elements, and how to aggregate it.",
      "Metrics are computed at read time from the run record and shown at every period. A Metric at period t reads periods up to t only.",
      "There is no formula language: the dropdowns are the whole surface.",
    ],
    refs: ["ADR-0019 §4"],
  },
  stock: {
    title: "Stock",
    lines: [
      "A Stock is the richer form of a supply rate: inside supply_capacity[category] (or an edge capacity) a number becomes an object with rate, inflow, level and bounds.",
      "Before each propagating Phase the Stock is turned into a plain supply number; the engine never sees a Stock.",
      "After the period's last propagating Phase the level is integrated once from what was delivered.",
    ],
    refs: ["ADR-0020 §1", "ADR-0020 §2"],
  },
};

// ---------------------------------------------------------------------------
// Timeline edits
// ---------------------------------------------------------------------------

export function explainAddStep(label: string): Explanation {
  return {
    title: "Add a Step",
    lines: [
      `A new Step starting at "${label}" is appended. A Step is one period, or the same period pattern repeated.`,
      "Saved Timelines are part of the project file. Adding a Step after a run marks the run stale; re-running replays only from the first changed period.",
    ],
    refs: ["ADR-0019 §1"],
  };
}

export const EXPLAIN_REMOVE_STEP: Explanation = {
  title: "Remove a Step",
  lines: [
    "The Step and all its periods leave the Timeline. Later Steps move up, and their labels stay as written.",
    "Profile entries keyed to labels that no period produces any more are kept and flagged unused.",
  ],
  refs: ["ADR-0019 §1"],
};

export function explainLabel(label: string, unit: CalendarUnit, valid: boolean): Explanation {
  return {
    title: "Step label",
    lines: valid
      ? [
          `"${label}" is the first period this Step represents.`,
          unit === "none"
            ? "With unit none, repeats are numbered label#2, label#3, …"
            : `Each repeat advances the label by one ${unit}. The profile is keyed by these labels.`,
        ]
      : [
          `"${label}" is not a valid ${unit} label. Expected ${LABEL_FORMATS[unit]}.`,
          "The run would refuse to start until every Step's label parses.",
        ],
    refs: ["ADR-0019 §1"],
  };
}

const LABEL_FORMATS: Record<CalendarUnit, string> = {
  day: "YYYY-MM-DD",
  week: "YYYY-Www (ISO week)",
  month: "YYYY-MM",
  quarter: "YYYY-Qn",
  year: "YYYY",
  none: "any text",
};

export function explainUnit(unit: CalendarUnit): Explanation {
  return {
    title: "Calendar unit",
    lines: [
      `Repeats advance the label by one ${unit === "none" ? "number" : unit}. Label format: ${LABEL_FORMATS[unit]}.`,
      "The unit only names periods. A period has no duration: time passes only through Temporal Jump Events you place in a Phase or a Periodic rule.",
    ],
    refs: ["ADR-0019 §1"],
  };
}

export function explainRepeat(repeat: number): Explanation {
  return {
    title: "repeat",
    lines: [
      `This Step runs ${repeat} consecutive period${repeat === 1 ? "" : "s"} with the same Phases.`,
      "Each repetition is a separate period with its own label, its own profile entries and its own recorded diffs.",
    ],
    refs: ["ADR-0019 §1"],
  };
}

export const EXPLAIN_ADD_PHASE: Explanation = {
  title: "Add a Phase",
  lines: [
    "A Phase applies its Events, then optionally runs one Propagation. Phases let an Event fire between two Propagations of one period.",
    "Use one to isolate an Event read on its own (a settlement) or to measure the same period twice. Each Propagation re-solves from scratch, so a Phase sets no preference between supplies.",
    "Each propagating Phase costs one Engine Evaluation per period.",
  ],
  refs: ["ADR-0019 §1"],
};

export const EXPLAIN_REMOVE_PHASE: Explanation = {
  title: "Remove a Phase",
  lines: ["The Phase and its Events leave every period of this Step. Periodic rules pointing at it stop firing (they are flagged)."],
  refs: ["ADR-0019 §1"],
};

export function explainPropagate(on: boolean, isLastPropagating: boolean): Explanation {
  return {
    title: on ? "Phase propagates" : "Phase only applies Events",
    lines: on
      ? [
          "Before this Phase's Propagation: Functionality and Responsibility Share return to what Events imposed in this run (shortage is recomputed), and every Stock becomes its supply number.",
          isLastPropagating
            ? "This is the period's last propagating Phase: right after it, every Stock is integrated once from what this Phase delivered."
            : "A later Phase propagates too, so Stocks are integrated after that one.",
        ]
      : [
          "This Phase applies its Events and records their diff without calling the engine.",
          "Placed after the last propagating Phase, it sees the period's integrated (closing) Stock levels — the place for a settlement.",
        ],
    refs: ["ADR-0019 §2", "ADR-0019 §2a"],
  };
}

export function explainPhaseEvent(label: string, added: boolean, jumpHours?: number): Explanation {
  if (added && jumpHours !== undefined) {
    return {
      title: "Temporal Jump added to a Phase",
      lines: [
        `"${label}" advances simulated time by ${jumpHours} h at this point of every period of the Step: it subtracts ${jumpHours} from every positive Functionality Time and expires a countdown reaching 0 to Functionality 1.`,
        "A period has no duration of its own; this jump is how much time it represents for backups. A model without backups needs no jump.",
        "An expired backup stays at Functionality 1 until a later Event restores it. A countdown keeps draining after its shortage ends — clear it with an Event (set functionality_time 0) in the period supply returns.",
        "Placed before the Phase's Propagation, that Propagation already sees the expiries; placed in a Phase after it, the next period does. Reserves count elapsed hours: a month is ~730 h.",
      ],
      refs: ["ADR-0019 §1", "ADR-0019 §2a"],
    };
  }
  return {
    title: added ? "Event added to a Phase" : "Event removed from a Phase",
    lines: [
      added
        ? `"${label}" fires in this Phase every period of the Step: vulnerabilities, then attribute_mutations, then Attribute Operations.`
        : `"${label}" no longer fires here.`,
      "An Event is the only edit handle on a Timeline. Functionality it imposes stands in later periods until another Event changes it (repair is an Event too).",
    ],
    refs: ["ADR-0019 §1", "ADR-0019 §2a", "ADR-0021"],
  };
}

export function explainPeriodic(every: number, phase: number): Explanation {
  return {
    title: "Periodic rule",
    lines: [
      `Its Events join Phase ${phase + 1} of periods ${every}, ${every * 2}, ${every * 3}, … counted from the run's start.`,
      "It saves writing the same Event into every N-th Step by hand. A rule pointing at a Phase no Step has never fires and is flagged.",
    ],
    refs: ["ADR-0019 §1"],
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function explainProfileRow(op: string, path: string, labelUsed: boolean): Explanation {
  return {
    title: "Profile operation",
    lines: [
      `At the start of its period: ${describeOp(op)} on ${path || "(path)"}.`,
      "path is a list (supply_capacity, category, field) so it can reach a Stock field and survives dotted ids.",
      labelUsed
        ? "A result outside the field's valid range, or a non-set on an absent field, is rejected with a warning."
        : "No period of the Timeline has this label, so this entry never applies; it is flagged unused.",
    ],
    refs: ["ADR-0019 §1", "ADR-0021"],
  };
}

function describeOp(op: string): string {
  switch (op) {
    case "set": return "set writes the value";
    case "add": return "add adds the value to the current one";
    case "mul": return "mul multiplies the current value";
    case "at_most": return "at_most caps the current value at the value";
    case "at_least": return "at_least raises the current value to the value";
    default: return op;
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export function explainRun(plan: TimelinePlan, eventLabel: (id: string) => string): Explanation {
  const first = plan.periods[0];
  return {
    title: "Run (dry)",
    lines: [
      "1. Reset — one undoable entry; the run starts from the authored model with every Element operational.",
      ...(first ? describePeriod(first, eventLabel).map((l) => `2. ${l}`) : ["2. (no periods)"]),
      `3. Repeat for all ${plan.periods.length} periods: ${plan.engineCalls} Propagations, each one Engine Evaluation against your role's budget (30 s timeout each).`,
      "4. Push ONE temporal_simulation_run entry (the run's net diff) to the undo history; store the per-Phase diffs in the run record.",
      plan.warnings.length > 0 ? `Blocked: ${plan.warnings.length} warning(s) must be fixed first.` : "Prototype: the plan is shown in the table below; nothing was sent to the engine.",
    ],
    refs: ["ADR-0019 §2", "ADR-0019 §3", "ADR-0008"],
  };
}

/** The canonical sequence of ADR-0019 §2, rendered for one planned period. */
function describePeriod(p: PlannedPeriod, eventLabel: (id: string) => string): string[] {
  const lines = [`Period ${p.number} "${p.label}": apply its profile operations.`];
  for (const ph of p.phases) {
    const evs = ph.events.length > 0 ? ph.events.map(eventLabel).join(", ") : "no Events";
    lines.push(
      ph.propagate
        ? `Phase ${ph.index + 1}: apply ${evs}; reset shortage to the imposed layer; Stocks → supply; Propagate${ph.integratesAfter ? "; integrate every Stock" : ""}.`
        : `Phase ${ph.index + 1}: apply ${evs} (no Propagation).`,
    );
  }
  return lines;
}

export function explainSelectPeriod(p: PlannedPeriod, eventLabel: (id: string) => string): Explanation {
  return {
    title: `Period ${p.number} — ${p.label}`,
    lines: [
      "Selecting a period repaints the canvas from the state reconstructed at its end: a forward walk of the run record's diffs from the start state.",
      ...describePeriod(p, eventLabel),
    ],
    refs: ["ADR-0019 §3"],
  };
}

export const EXPLAIN_SHOW_STATE: Explanation = {
  title: "Show full state",
  lines: [
    "Rebuilds the whole graph at this period and opens it read-only, so you can inspect one interesting period.",
    "Nothing per period is stored as a snapshot; reconstruction is cheap at tens of periods.",
  ],
  refs: ["ADR-0019 §3"],
};

export const EXPLAIN_STALE: Explanation = {
  title: "Run is stale",
  lines: [
    "The Timeline changed after the last run. The run record carries a hash of the model, Timeline and profile; a mismatch marks it stale.",
    "Re-running replays forward from the first changed period and keeps the earlier periods' diffs.",
  ],
  refs: ["ADR-0019 §3"],
};

export const EXPLAIN_UNDO_RUN: Explanation = {
  title: "Undo (Ctrl+Z) after a run",
  lines: [
    "The whole run is one entry in the undo history, so Ctrl+Z undoes all of it at once and lands on the post-Reset state.",
    "A second Ctrl+Z undoes the Reset the run started with.",
  ],
  refs: ["ADR-0019 §3"],
};

export const EXPLAIN_CLEAR_RUN: Explanation = {
  title: "Clear Event (Ctrl+R) after a run",
  lines: [
    "Clear Event treats a run as one Event: if the run is the newest Event-like entry, Ctrl+R reverts its whole net diff.",
    "It pushes an event_cleared entry, so Ctrl+Z brings the run back. The Situation lists the run as one item named by its Timeline.",
  ],
  refs: ["ADR-0019 §3", "ADR-0016 §5"],
};

export const EXPLAIN_RESET_RUN: Explanation = {
  title: "Reset after a run",
  lines: [
    "Forces every Element operational, and reverts every write tagged simulation — so every Stock returns to its level from before the run.",
    "A hand edit of a Stock field (a new opening balance, a corrected max) is authoring work and survives Reset.",
    "Reset also ends the run's Level Mode.",
  ],
  refs: ["ADR-0019 §5", "ADR-0020 §4"],
};

export function explainDisplay(mode: "functionality" | "level", reading: "level" | "change"): Explanation {
  return mode === "functionality"
    ? {
        title: "Colour by Functionality",
        lines: ["The canvas shows Functionality as usual, at the selected period."],
        refs: ["ADR-0019 §6"],
      }
    : {
        title: `Level Mode — ${reading}`,
        lines: [
          reading === "level"
            ? "Each Stock is coloured by its level ÷ reference on the Level Scale: a node Stock colours its node, an edge Stock its edge."
            : "Each Stock is coloured by its change over the selected period (after − before) ÷ its change_reference.",
          "The reference defaults to the Stock's own bound max(|min|, |max|); a Stock with no bound and no override stays neutral, and the legend says so.",
          "Display only: Level Mode feeds no Rule, Operativity Score or Recovery Value. Reset clears it.",
        ],
        refs: ["ADR-0019 §6"],
      };
}

export const EXPLAIN_SAVE_SCORECARD: Explanation = {
  title: "Save to Scorecard",
  lines: [
    "Saves the selected period to the Scorecard with the per-element values Level Mode shows (level or change, and the reference used), so it repaints later.",
    "Whether this is a new entry type in the Scorecard union is still open.",
  ],
  refs: ["ADR-0019 §6", "ADR-0006"],
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function explainMetric(m: {
  name: string; target: string; attribute: string; read: "state" | "change"; phase: string; aggregate: string; filter: string;
}): Explanation {
  const where = m.read === "state"
    ? `the value of ${m.attribute || "(attribute)"} at the end of each period`
    : `the change (after − before) of ${m.attribute || "(attribute)"} over ${m.phase ? `Phase ${m.phase}` : "the whole period"}`;
  return {
    title: `Metric "${m.name || "untitled"}"`,
    lines: [
      `Per period: take ${where}, on ${m.target === "all" ? "every node" : `nodes of type ${m.target}`}${m.filter ? ` where ${m.filter}` : ""}, and report its ${m.aggregate}.`,
      m.read === "change"
        ? "A settlement in its own Phase makes that Phase's change exactly the settlement — e.g. sum of a Stock level's change is a cash outlay, positive when the level rises."
        : "Computed at read time from the reconstructed state; nothing is stored per Metric.",
      "Reads periods up to the current one only; a centred average or a normalisation by the run's final maximum is a post-hoc summary, not a Metric.",
    ],
    refs: ["ADR-0019 §4"],
  };
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export function explainStockField(field: string): Explanation {
  const lines: Record<string, string[]> = {
    rate: ["Per-period capacity basis: exactly what a bare number under this category would carry today."],
    inflow: ["What integration credits each period; absent = rate. Separate so capacity can rise (cross-training) without crediting more inflow. rate > inflow flags the balance attribution-invalid."],
    level: ["On hand, signed, typed in its stored sign: positive = available to draw. A liability (hours owed to workers) is negative."],
    min: ["Floor of the level (absent = 0). The draw never takes the level below it; a clamp at it reports 'unmet'. Policy instrument: 'cap the balance at X' is min = −X in the stored sign."],
    max: ["Ceiling of the level (absent = none). A clamp at it reports 'spilled'."],
    max_draw: ["Most the stored level may add to supply in one period (absent = no limit). An Event can open or close it with a set operation."],
    retention: ["Multiplier on the level each period: < 1 decay (spoilage, evaporation), > 1 growth (interest). The draw already accounts for it."],
    efficiency: ["Multiplier on the inflow: < 1 transfer or round-trip loss."],
    delivered: ["D: what the period's last propagating Phase delivered (served_ratio × demand). In the built feature it comes from the engine; here you type it."],
    phi: ["φ: the Functionality-to-capacity ratio the Propagation returned (1 at the top level, 0 at the bottom). The engine applies it to supply; integration applies it to the credited inflow. The stored level is never scaled."],
  };
  return { title: `Stock field: ${field}`, lines: lines[field] ?? [], refs: ["ADR-0020 §1", "ADR-0020 §2"] };
}
