/**
 * RulesManual — the user-facing authoring guide for the rule language.
 *
 * A self-contained, presentational reference that explains the rule syntax and
 * how the engine interprets it. Pure JSX (no markdown dependency), styled to
 * match the rest of the rules UI (zinc palette, dark-mode aware).
 *
 * This is the canonical, human-readable source of the rule DSL. When the DSL
 * changes, update this component together with {@link RuleExamples} and the
 * backend parser (CASCADE-backend/core/rule_parser.py). The grammar and
 * interpretation here mirror that parser and ADR-0003 exactly.
 */

import type { ReactNode } from "react";

/** A short inline code fragment. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </code>
  );
}

/** A larger code block, e.g. a full rule or grammar snippet. */
function Block({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {children}
    </section>
  );
}

/** A callout for the "degradation only" golden rule and similar emphasis. */
function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
      {children}
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium text-zinc-500 dark:border-zinc-700">
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td className="border-b border-zinc-100 px-2 py-1.5 align-top text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
      {children}
    </td>
  );
}

export function RulesManual() {
  return (
    <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Rules — Authoring Guide
        </h2>
        <p className="text-xs text-zinc-500">
          How to write rules and what the engine does with them. No programming
          background needed.
        </p>
      </header>

      <Section title="What a rule is">
        <p>
          A <strong>rule</strong> is a single line of text attached to a node or
          edge (an <em>element</em>). Each element carries a list of rules. A rule
          overrides how that element&rsquo;s <strong>Functionality</strong> is
          computed, based on the state of other elements.
        </p>
        <p>
          Functionality is an integer on a scale <Code>1..N</Code> set by your
          model: <Code>1</Code> is the worst (failed/critical), <Code>N</Code> is
          fully operational. Each level also has a label (e.g. <Code>critical</Code>,{" "}
          <Code>warning</Code>, <Code>operational</Code>); you can write either the
          number or the label.
        </p>
        <Callout>
          <strong>Golden rule: degradation only.</strong> Propagation can only ever
          make things <em>worse</em>, never better. A rule that would <em>raise</em>{" "}
          an element&rsquo;s Functionality is silently ignored — recovery is handled
          by the timeline, not by rules.
        </Callout>
      </Section>

      <Section title="The three kinds of rule">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <Th>Kind</Th>
              <Th>Shape</Th>
              <Th>Plain meaning</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>Specific</Td>
              <Td>
                <Code>if &lt;condition&gt; then &lt;target&gt; is &lt;level&gt;</Code>
              </Td>
              <Td>When this situation holds, force the target down to this level.</Td>
            </tr>
            <tr>
              <Td>Intracategorical</Td>
              <Td>
                <Code>&lt;op&gt;(&lt;elements&gt;) propagates to &lt;target&gt;</Code>
              </Td>
              <Td>Change how the target combines suppliers within one category.</Td>
            </tr>
            <tr>
              <Td>Intercategorical</Td>
              <Td>
                <Code>&lt;op&gt;(&lt;categories&gt;) propagates to &lt;target&gt;</Code>
              </Td>
              <Td>Change how the target combines its different categories.</Td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-zinc-500">
          The engine tells the kinds apart automatically: a rule starting with{" "}
          <Code>if</Code> is specific; otherwise it&rsquo;s a propagation rule, and
          naming at least one <em>category</em> in the arguments makes it
          intercategorical (else intracategorical).
        </p>
      </Section>

      <Section title="Naming elements, categories, and levels">
        <p>
          <strong>Elements</strong> can be named by their exact ID
          (<Code>datacenter</Code>) or by the display label you see on the canvas
          (<Code>Datacenter</Code>, <Code>Mixed Hub</Code>) — case-insensitive, and{" "}
          <strong>spaces are allowed</strong>. Exact ID always wins. You do not need
          to know IDs.
        </p>
        <p>
          <strong>Categories</strong> are matched case-insensitively and may contain
          spaces (<Code>water</Code>, <Code>Spare Power</Code>).
        </p>
        <p>
          <strong>Levels</strong> can be a number (<Code>1</Code>…<Code>N</Code>) or a
          scale label (<Code>critical</Code>, <Code>operational warning</Code>). An
          undefined label makes the rule <em>ignored with a warning</em> — nothing
          crashes.
        </p>
      </Section>

      <Section title="Specific rules — if … then … is …">
        <p className="text-xs text-zinc-500">
          Use when a particular element should fail under a precise, named
          condition, independent of the normal supplier logic.
        </p>
        <Block>{`if <condition> then <target> is <level>

<condition> := <element>[.<attribute>] is [<operator>] <value>
             | <condition> and <condition>
             | <condition> or  <condition>
             | not <condition>
             | ( <condition> )`}</Block>
        <p>
          <Code>.attribute</Code> is optional and defaults to{" "}
          <Code>functionality</Code>. The operator is optional and defaults to{" "}
          <Code>=</Code>; supported comparisons are <Code>&lt;</Code> <Code>&gt;</Code>{" "}
          <Code>=</Code> <Code>≠</Code> <Code>&lt;=</Code> <Code>&gt;=</Code>. The
          operator may be glued to the value (<Code>is &lt;3</Code>) or separate
          (<Code>is &lt; 3</Code>).
        </p>
        <Block>{`if a is critical then b is critical
if datacenter.functionality is <3 then control is critical
if pump_a is critical or pump_b is critical then tank is warning`}</Block>
        <p className="text-xs text-zinc-500">
          The condition is re-checked every round against current state, so the rule
          fires as soon as its trigger has degraded enough. A firing specific rule is
          the <strong>highest-priority</strong> mechanism — it replaces the
          target&rsquo;s result (still subject to the golden rule). Blame (the
          &ldquo;Cause&rdquo;) is split evenly across the elements named in the
          condition; if several fire, the worst level wins.
        </p>
      </Section>

      <Section title="Intracategorical rules — combining suppliers within a category">
        <p className="text-xs text-zinc-500">
          Use when a target has several suppliers of the same category and you want
          to change how it tolerates some of them failing.
        </p>
        <Block>{`<operator>(<element>, <element>, …) propagates to <target>`}</Block>
        <p>
          By default a node with redundant suppliers takes the <strong>best</strong>{" "}
          of them (<Code>best_of</Code>) — one healthy supplier suffices. This rule
          replaces that operator for the relevant category.
        </p>
        <Callout>
          <strong>The elements only pick the category.</strong> The named elements
          identify <em>which category</em> the rule applies to; the operator then
          governs <em>all</em> of the target&rsquo;s suppliers in that category — not
          only the ones you listed. To be unambiguous you can name the{" "}
          <em>category</em> directly: <Code>worst_of(water) propagates to tank</Code>.
        </Callout>
        <Block>{`worst_of(pump_a, pump_b) propagates to tank`}</Block>
        <p className="text-xs text-zinc-500">
          &ldquo;The tank is only as good as its <em>worst</em> water pump&rdquo;
          instead of its best. If <Code>pump_a = 3</Code> and <Code>pump_b = 1</Code>,
          the tank follows <Code>1</Code>.
        </p>
      </Section>

      <Section title="Intercategorical rules — combining different categories">
        <p className="text-xs text-zinc-500">
          Use when a target depends on several different categories (e.g. water and
          power) and you want to change how their levels combine.
        </p>
        <Block>{`<operator>(<category>, <category>, …) propagates to <target>`}</Block>
        <p>
          By default a node needs <strong>all</strong> its categories, so it takes
          the <strong>worst</strong> across them (<Code>worst_of</Code>). This rule
          replaces that compose operator. Each category first produces its own level;
          a category with nothing degrading it counts as <Code>N</Code>.
        </p>
        <Block>{`average_of(water, digital) propagates to hub`}</Block>
        <p className="text-xs text-zinc-500">
          &ldquo;The hub runs on the <em>average</em> of water and digital&rdquo;. If{" "}
          <Code>water = 4</Code> and <Code>digital = 2</Code>, the hub follows{" "}
          <Code>average_of(4, 2) = 3</Code> instead of <Code>worst_of = 2</Code>.
        </p>
      </Section>

      <Section title="Operators">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <Th>Operator</Th>
              <Th>Meaning (over integer levels)</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td><Code>worst_of</Code></Td>
              <Td>the lowest level (pessimistic; every supplier needed)</Td>
            </tr>
            <tr>
              <Td><Code>best_of</Code></Td>
              <Td>the highest level (redundant; one supplier suffices) — the intracategorical default</Td>
            </tr>
            <tr>
              <Td><Code>average_of</Code></Td>
              <Td>arithmetic mean, rounded down</Td>
            </tr>
            <tr>
              <Td><Code>median_of</Code></Td>
              <Td>middle value; even count → the lower middle</Td>
            </tr>
            <tr>
              <Td><Code>majority_of</Code></Td>
              <Td>most frequent level; ties broken toward the worse level</Td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="How the kinds work together (priority)">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
          <li>
            <strong>Proposals</strong> — the normal supplier logic, with
            intra/intercategorical rules re-parameterising the operators.
          </li>
          <li>
            <strong>Guards</strong> — dependency level and backup soften or delay a
            drop but never originate a failure.
          </li>
          <li>
            <strong>Specific rules</strong> — highest priority; a firing rule
            overrides the result.
          </li>
          <li>
            <strong>Commit</strong> — the new value is{" "}
            <Code>worst_of(current, result)</Code>, which enforces the golden rule.
          </li>
        </ol>
      </Section>

      <Section title="Common pitfalls">
        <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
          <li>Improving a node does nothing (golden rule).</li>
          <li>An unknown level label makes the rule ignored with a warning — check the spelling against your scale.</li>
          <li>Intracategorical element lists only select the category; they don&rsquo;t restrict the operator to just those elements.</li>
          <li>A name matching no element (a typo) makes the rule <em>ignored with a warning</em> rather than silently misfiring — prefer picking the element from the editor.</li>
          <li>A display label shared by two nodes is <em>ambiguous</em>: rules that use it are reported, not guessed — rename the nodes or use the element id.</li>
        </ul>
      </Section>
    </div>
  );
}
