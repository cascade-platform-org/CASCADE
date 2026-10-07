/**
 * temporal-simulation-explainers.ts — the "What this will do" texts of the
 * Temporal Simulation window.
 *
 * The definition tabs edit the project's document; the run and its Stocks are
 * not built yet, so those controls show one of these texts instead of acting
 * on the model. Each text states the behaviour
 * the specification commits to (ADR-0019/0020/0021, requirements §9.6), so
 * reading them while clicking through is a review of the specification itself.
 * Kept in one module so the wording can be reviewed in one place.
 */

import type { PlannedPeriod, TimelinePlan } from "@/lib/timeline-plan";
import { filterConditions, type FilterableModel } from "@/lib/element-filter";
import type { CalendarUnit, Metric } from "@/lib/schemas/temporal-simulation";
import type { AttributeOperation, ElementFilter } from "@/lib/schemas/attribute-operation";

export interface Explanation {
  title: string;
  lines: string[];
  /** Where the behaviour is specified. */
  refs: string[];
}

export const EXPLAIN_INTRO: Explanation = {
  title: "Temporal Simulation",
  lines: [
    "A Temporal Simulation is a saved definition, run over many periods: a Timeline of Steps, each applying Events and Propagations and integrating Stocks, plus its profile and Metrics. One per project.",
    "The definition is saved in the project, with its file, autosave and sync. A run computes on its own copy and is shown read-only in the Run View; your model is never written. Stocks integrate once per period, Level Mode recolours them, and the Run table computes the Metrics. Each control explains here what it does.",
    "Tabs: Timeline (Steps, Phases and the profile grid), Run (the plan, the Run View, Level Mode, End run), Metrics (custom read-outs), Text (the whole definition as JSON, for bulk edits and LLMs).",
  ],
  refs: ["ADR-0019", "requirements §9.6"],
};

export const EXPLAIN_TAB: Record<string, Explanation> = {
  timeline: {
    title: "Timeline",
    lines: [
      "The Timeline is the saved input: an ordered table of Steps, each with ordered Phases holding Events (each firing every period, or every N periods of its Step).",
      "Under the overview sits the profile: the known inputs per period (rates, inflows, demands), one row per operation and one cell per period, applied at the start of the period before any Phase.",
      "It stores inputs only. A run's results live in memory for the session; reopening the project means running again.",
      "Every change over time is authored here, before a run: a profile value or a Phase Event. While a run is shown this definition is read-only; End run to edit, and the next run starts from the beginning.",
    ],
    refs: ["ADR-0019 §1", "ADR-0019 §3"],
  },
  run: {
    title: "Run",
    lines: [
      "A run computes on its own copy of the model, Reset (both halves), executing every period in order and calling the engine once per propagating Phase.",
      "It is shown in the Run View, read-only; the live model and the undo history are never written. End run (or Reset) shows the model as it was.",
      "Running needs the engine: a signed-in account allowed to Propagate, and the server reachable.",
    ],
    refs: ["ADR-0019 §2", "ADR-0019 §3"],
  },
  metrics: {
    title: "Metrics",
    lines: [
      "A custom Metric is a view definition saved with the Temporal Simulation: what to read, from which Elements, and how to aggregate it.",
      "Metrics are computed at read time from the run record and shown at every period, after the three standard ones (Operativity, coverage, stock level). A Metric at period t reads periods up to t only.",
      "There is no formula language: the dropdowns are the whole surface.",
    ],
    refs: ["ADR-0019 §4"],
  },
  text: {
    title: "Text",
    lines: [
      "The whole definition — Timeline, profile and Metrics — as one JSON document, validated by the same schema the other tabs edit through.",
      "Copy it, edit it anywhere (or hand it to an LLM with “Copy with context”), paste it back and Apply. A misspelt key, a wrong type or a bad enum is reported with its path and nothing is applied.",
      "References this project cannot satisfy (an unknown Event id, an Element that does not exist, a filter matching nothing) are warnings: you can still apply.",
    ],
    refs: ["ADR-0019 §7"],
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
      "The Temporal Simulation (one per project) is part of the project file. Steps are added before a run; each run starts from the beginning.",
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
  hour: "YYYY-MM-DDTHH (24-hour clock)",
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
      "The unit only names periods. A period has no duration: time passes only through Temporal Jump Events you place in a Phase.",
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
  lines: ["The Phase and its Events leave every period of this Step."],
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
      "Every change over time is a Phase Event or a profile value. Functionality an Event imposes stands in later periods until another Event changes it (repair is an Event too).",
    ],
    refs: ["ADR-0019 §1", "ADR-0019 §2a", "ADR-0021"],
  };
}

export function explainEventEvery(label: string, every: number, repeat: number): Explanation {
  const fires = Array.from({ length: Math.floor(repeat / every) }, (_, i) => (i + 1) * every);
  return {
    title: `"${label}" every ${every} period${every === 1 ? "" : "s"}`,
    lines: [
      every === 1
        ? `Fires in every one of this Step's ${repeat} periods.`
        : fires.length
          ? `Fires on this Step's periods ${fires.join(", ")} (of ${repeat}). The count restarts in each Step.`
          : `Never fires: the Step has only ${repeat} periods. It is flagged in the Run tab.`,
      "In the text form, an Event that fires every period is its bare id; otherwise { \"event\": id, \"every\": N }.",
    ],
    refs: ["ADR-0019 §1"],
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function explainProfileOp(label: string, op: AttributeOperation, matches: number | null): Explanation {
  const target = describeTarget(op, matches);
  return {
    title: "Profile operation",
    lines: [
      `At the start of period "${label}": ${describeOp(op.op)} (${String(op.value)}) at ${op.path.join(" › ") || "(path)"} on ${target}.`,
      op.where
        ? "The filter is resolved when the operation runs, against the model at that moment, so an Element added later is included."
        : "path is a list (supply_capacity › category › field) so it can reach a Stock field and survives dotted ids.",
      "A result outside the field's valid range, or a non-set on an absent field, is rejected with a warning for that Element.",
    ],
    refs: ["ADR-0019 §1", "ADR-0021"],
  };
}

/** Who a profile row or operation acts on. */
function describeTarget(op: Pick<AttributeOperation, "element" | "where">, matches: number | null): string {
  return op.element !== undefined
    ? `Element ${op.element || "(none chosen)"}`
    : `each of the ${matches ?? 0} Element${matches === 1 ? "" : "s"} the filter selects (in id order)`;
}

export function explainProfileRow(row: Omit<AttributeOperation, "value">, matches: number | null, periods: number): Explanation {
  return {
    title: "Profile row",
    lines: [
      `One operation: ${describeOp(row.op)} at ${row.path.join(" › ") || "(path)"} on ${describeTarget(row, matches)}, at the start of each period whose cell holds a value (${periods} now).`,
      row.op === "set"
        ? "A written value stays until a later cell, an Event or another row changes it; an empty cell shows the value carried into it in grey."
        : "An empty cell applies nothing. → on a filled cell repeats its value into the following empty cells, so a monthly mul 1.02 compounds.",
      "Paste a series copied from a spreadsheet into a cell to fill it and the following periods.",
    ],
    refs: ["ADR-0019 §1", "ADR-0021"],
  };
}

/** The row editor's Value: what Write puts in the chosen cells. */
export function explainProfileWrite(op: AttributeOperation["op"], value: string, periods: string[]): Explanation {
  const span = periods.length === 0 ? "no period" : periods.length === 1 ? `"${periods[0]}"` : `${periods.length} periods, "${periods[0]}" to "${periods[periods.length - 1]}"`;
  return {
    title: "Profile value",
    lines: [
      `The value is what the op uses: ${describeOp(op)}. Write puts ${value === "" ? "it" : `"${value}"`} in the row's cells for ${span}; Clear empties them.`,
      op === "set"
        ? "For set, one cell is enough: the value stays in later periods. Fill more only where the value changes, or to re-impose it over an Event's change."
        : "Each filled cell applies the op once in its period, so a value over several periods compounds (mul 1.02 over 12 months ≈ +27%).",
      "The cells are the row's values; this only fills them. Each cell can still be edited on its own.",
    ],
    refs: ["ADR-0019 §1", "ADR-0021"],
  };
}

/** An empty profile cell: no operation in that period. */
export function explainProfileCarry(label: string, op: AttributeOperation["op"], carried: string | undefined): Explanation {
  return {
    title: `Profile cell — ${label}`,
    lines: [
      op !== "set"
        ? `No operation in "${label}". A value here would apply ${op} in this period only.`
        : carried !== undefined
          ? `No operation in "${label}": the ${carried} written earlier stays. A value here changes it from this period on.`
          : `No operation yet: the field keeps the model's own value. A value here sets it from this period on.`,
      "Paste a series (tab, newline or ; separated) to fill this cell and the following periods.",
    ],
    refs: ["ADR-0019 §2"],
  };
}

export function explainFilter(filter: ElementFilter, selected: number, candidates: number, misuse: string[], canvases: FilterableModel["canvases"]): Explanation {
  const { kind } = filter;
  const conds = filterConditions(filter, canvases);
  const unticked = filter.exclude?.length ?? 0;
  return {
    title: "Element Filter",
    lines: [
      `Selects every ${kind}${conds.length ? " " + conds.join(", ") : ""}: ${candidates} match${candidates === 1 ? "" : "es"}${unticked ? `, ${unticked} unticked` : ""} → ${selected} selected in the current model.`,
      "Every given condition must hold; leave a field on “any” or empty not to constrain it. Untick a match to leave it out.",
      "The filter is resolved again each time the operation runs: an unticked Element stays out, and an Element that starts matching later (added, re-typed, renamed) is included.",
      ...misuse.map((m) => `Ignored: ${m}.`),
    ],
    refs: ["ADR-0021"],
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
    title: "Run",
    lines: [
      "1. Copy the model and Reset the copy: the run starts from the authored model with every Element operational. Your model is never written.",
      ...(first ? describePeriod(first, eventLabel).map((l) => `2. ${l}`) : ["2. (no periods)"]),
      `3. Repeat for all ${plan.periods.length} periods: ${plan.engineCalls} Propagations, each one Engine Evaluation against your role's budget (30 s timeout each).`,
      "4. Keep the per-Phase diffs in the run record and open the Run View: the canvas shows the selected period, read-only, until End run. Progress shows period k of n; Cancel or a failure discards the run.",
      plan.errors.length > 0
        ? `Blocked: ${plan.errors.length} error(s) — a period without a valid label, or two periods with one label. Warnings do not block.`
        : "Each Propagation uses the Propagate button's scope (Local or Global).",
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
        ? `Phase ${ph.index + 1}: return Functionality to what Events imposed (shortage is recomputed); apply ${evs}; Stocks → supply; Propagate${ph.integratesAfter ? "; integrate every Stock" : ""}.`
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

export const EXPLAIN_STRIP: Explanation = {
  title: "Timeline at a glance",
  lines: [
    "One column per period, grouped by Step. Above each Phase's bar are its Events: red hazard, amber disservice, clock = a time jump (the only way time passes).",
    "A filled green bar is a Phase that runs a Propagation (one Engine Evaluation); an empty bar only applies Events. ∫ marks where Stocks integrate: after the period's last propagating Phase.",
    "An Event set to every N periods shows only in the periods it fires in. Click a period for exactly what runs in it.",
    "Below, each profile row is one operation with a cell per period. A written value stays in later periods until something changes it, so an empty cell of a set row shows the carried value in grey.",
  ],
  refs: ["ADR-0019 §1", "ADR-0019 §2"],
};

export const EXPLAIN_END_RUN: Explanation = {
  title: "End run",
  lines: [
    "Leaves the Run View: the canvas shows your model exactly as it was, because the run lived on its own copy. Reset does the same.",
    "The Timeline, profile and Metrics become editable again. Every change over time is authored before a run, as profile values or Phase Events; the next run starts from the beginning.",
  ],
  refs: ["ADR-0019 §3", "ADR-0019 §5"],
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
            : "Each Stock is coloured by its change over the selected period (after − before) ÷ its reference (its change_reference, else its bound).",
          "The reference defaults to the Stock's own bound max(|min|, |max|); a Stock with no bound and no override stays neutral, and the legend says so.",
          "Display only: Level Mode feeds no Rule, Operativity Score or Recovery Value. End run or Reset clears it.",
        ],
        refs: ["ADR-0019 §6"],
      };
}

export const EXPLAIN_SAVE_SCORECARD: Explanation = {
  title: "Save to Scorecard",
  lines: [
    "Saves the selected period as a Temporal Simulation entry: the Timeline's name, the period's label and end-state snapshot, its Metric values and the Level Mode values with their references, plus a picture.",
    "The values are computed now and kept, because the run itself is not saved; Operativity is derived from the snapshot like any entry's.",
  ],
  refs: ["ADR-0019 §4", "ADR-0006"],
};

export const EXPLAIN_EXPORT_CSV: Explanation = {
  title: "Export CSV",
  lines: [
    "Downloads this table: one row per period, one column per Metric (Operativity, coverage per Category, stock level per Category, then yours).",
    "The run is not saved, so this is how a series leaves the session. Averages and normalisations are left to the spreadsheet.",
  ],
  refs: ["ADR-0019 §4"],
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function explainMetric(m: Metric, matches: number): Explanation {
  const path = m.path.join(" › ") || "(path)";
  const where = m.read === "state"
    ? `the value at ${path} at the end of each period`
    : `the change (after − before) at ${path} over ${m.phase ? `Phase ${m.phase}` : "the whole period"}`;
  const vf = m.value_filter ? ` keeping values ${m.value_filter.cmp} ${m.value_filter.value}` : "";
  const agg = m.aggregate === "percentile" ? `${m.percentile ?? 50}th percentile` : m.aggregate === "share_where" ? "share passing the value filter" : m.aggregate;
  return {
    title: `Metric "${m.name || "untitled"}"`,
    lines: [
      `Per period: take ${where}, on the ${matches} Element${matches === 1 ? "" : "s"} the target selects${vf}, and report the ${agg}.`,
      m.read === "change"
        ? "A settlement in its own Phase makes that Phase's change exactly the settlement — e.g. sum of a Stock level's change is a cash outlay, positive when the level rises."
        : "Computed at read time from the reconstructed state; nothing is stored per Metric.",
      "Reads periods up to the current one only; a centred average or a normalisation by the run's final maximum is a post-hoc summary, not a Metric.",
    ],
    refs: ["ADR-0019 §4"],
  };
}

export const EXPLAIN_CREATE_EVENT: Explanation = {
  title: "Create Event",
  lines: [
    "Opens Config → Events with a new Event marked “Temporal Simulation only”: it never appears in the Action Bar or the Scorecard's uncovered list, only here.",
    "It can be a Hazard, a Disservice, or a Temporal Jump with its hours — the way a Timeline advances time. When you Save the Config it joins this Phase; Cancel leaves the Phase as it was.",
  ],
  refs: ["ADR-0019 §1", "requirements §6.4"],
};

export const EXPLAIN_COPY: Explanation = {
  title: "Copy",
  lines: ["Copies the JSON definition. Paste it into any editor, change it, and paste it back here to Apply."],
  refs: ["ADR-0019 §7"],
};

export const EXPLAIN_COPY_LLM: Explanation = {
  title: "Copy with context for an LLM",
  lines: [
    "Copies a self-contained prompt: what to do, the full format reference, a primer on CASCADE and on how a run executes, the field paths an operation can reach, a worked example, this project's Functionality scale, Categories, Events, canvases and (up to 300 Elements) the Element list with current supplies and demands, then the current definition.",
    "Paste the LLM's whole reply back: the first ```json block is extracted, validated and shown before anything is applied.",
  ],
  refs: ["ADR-0019 §7"],
};

export function explainApply(errors: number, warnings: number): Explanation {
  return errors === 0
    ? {
        title: "Applied",
        lines: [
          "The text replaced the Timeline, profile and Metrics, and is saved in the project. The other tabs now show it.",
          warnings > 0 ? `${warnings} warning(s) remain — references this project cannot satisfy. Fix them here or in the tabs.` : "No warnings.",
        ],
        refs: ["ADR-0019 §7"],
      }
    : {
        title: "Not applied",
        lines: [`${errors} error(s) — listed under the text with their path. Nothing changed.`],
        refs: ["ADR-0019 §7"],
      };
}
