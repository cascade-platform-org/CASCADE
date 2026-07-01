/**
 * RuleExamples — inline reference card for the three rule types.
 *
 * Rendered inside the rule editor panel so users can understand the DSL
 * syntax without leaving the panel. Each rule type has one canonical
 * example with a plain-language explanation.
 *
 * The `filter` prop narrows the card to just one rule type, which is
 * useful when the editor already knows which type the user is writing.
 *
 * The `onUseExample` callback lets the parent pre-fill the expression
 * input with the example text when the user clicks "Use this".
 *
 * The examples below use the real rule DSL. The full reference lives in
 * the RulesManual component (components/rules/rules-manual.tsx), which
 * mirrors the backend parser (CASCADE-backend/core/rule_parser.py) and
 * ADR-0003. Update this file, the manual, and the parser together.
 */

type RuleKind = "specific" | "intracategorical" | "intercategorical";

interface Example {
  expression: string;
  explanation: string;
}

const EXAMPLES: Record<RuleKind, Example> = {
  specific: {
    expression: "if pump_station_01.functionality is <2 then reservoir_south is critical",
    explanation:
      "Names individual elements (by ID or display label). When " +
      "pump_station_01 drops below level 2, reservoir_south is forced to " +
      "critical. Comparisons: < > = ≠ <= >=; default attribute is functionality.",
  },
  intracategorical: {
    expression: "worst_of(pump_a, pump_b) propagates to water_treatment",
    explanation:
      "Combines suppliers within one category. The named elements select " +
      "the category; the operator then governs all of the target's suppliers " +
      "there — here water_treatment follows its worst pump instead of its best.",
  },
  intercategorical: {
    expression: "average_of(power, water) propagates to emergency_services",
    explanation:
      "Combines different categories (the arguments are category names). " +
      "emergency_services runs on the average of its power and water levels " +
      "instead of collapsing to the worst. A category with no damage counts as N.",
  },
};

const RULE_KIND_LABEL: Record<RuleKind, string> = {
  specific: "specific",
  intracategorical: "intracategorical",
  intercategorical: "intercategorical",
};

interface RuleExamplesProps {
  /** When provided, only the matching rule kind is shown. */
  filter?: RuleKind;
  /** Called with the example expression when the user clicks "Use this". */
  onUseExample?: (expression: string) => void;
}

export function RuleExamples({ filter, onUseExample }: RuleExamplesProps) {
  const kinds = filter
    ? [filter]
    : (["specific", "intracategorical", "intercategorical"] as RuleKind[]);

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">
        Rule examples
      </p>

      {kinds.map((kind) => {
        const ex = EXAMPLES[kind];
        return (
          <div
            key={kind}
            className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {RULE_KIND_LABEL[kind]}
              </span>
              {onUseExample && (
                <button
                  onClick={() => onUseExample(ex.expression)}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Use this
                </button>
              )}
            </div>

            <code className="block rounded bg-zinc-50 px-2 py-1.5 font-mono text-xs text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200">
              {ex.expression}
            </code>

            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              {ex.explanation}
            </p>
          </div>
        );
      })}
    </div>
  );
}
