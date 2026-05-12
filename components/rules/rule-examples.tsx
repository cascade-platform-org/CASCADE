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
 * NOTE: The examples below use placeholder syntax. The actual DSL will
 * be defined in docs/rule-syntax.md once the rule engine interface is
 * finalised. Update this file and that doc together.
 */

type RuleKind = "specific" | "intracategorical" | "intercategorical";

interface Example {
  expression: string;
  explanation: string;
}

const EXAMPLES: Record<RuleKind, Example> = {
  specific: {
    expression: "IF node:pump_station_01 <= 2 THEN node:reservoir_south -= 1",
    explanation:
      "Names individual elements by ID. When pump_station_01 drops to " +
      "level 2 or below, reservoir_south loses one functionality level.",
  },
  intracategorical: {
    expression: "IF ANY power_grid < 3 THEN ALL water_treatment -= 1",
    explanation:
      "Applies across all nodes in one category. If any power-grid node " +
      "falls below level 3, every water-treatment node loses one level.",
  },
  intercategorical: {
    expression: "IF CATEGORY power_grid AVG < 0.5 THEN CATEGORY emergency_services -= 2",
    explanation:
      "Relates two different categories. If the average functionality " +
      "ratio of the power-grid category falls below 50 %, every " +
      "emergency-services node loses two levels.",
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
