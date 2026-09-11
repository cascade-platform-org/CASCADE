"use client";

/**
 * UserManual — the in-app user guide: setting up elements, writing rules,
 * running a scenario.
 *
 * Same convention as {@link RulesManual}: a self-contained presentational
 * component (pure JSX, no markdown dependency) that is the canonical
 * user-facing text. It deliberately stops where the rule grammar begins —
 * that reference lives in the Rules Manual panel, opened from §2 here.
 *
 * Kept in sync by hand with docs/project/user-manual.md, which carries the same
 * sections for readers outside the app. Change both together.
 */

import type { ReactNode } from "react";

const SECTIONS = [
  { id: "element", n: 1, title: "Setting up an element" },
  { id: "rules", n: 2, title: "Rules" },
  { id: "scenario", n: 3, title: "Running a scenario" },
  { id: "intervention", n: 4, title: "Testing an intervention" },
  { id: "analysis", n: 5, title: "Analysis results" },
  { id: "server", n: 6, title: "Server and roles" },
  { id: "shortcuts", n: 7, title: "Keyboard shortcuts" },
] as const;

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </code>
  );
}

function Block({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200">
      {children}
    </pre>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
      {children}
    </div>
  );
}

function Section({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={`manual-${id}`} className="scroll-mt-2 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        <span className="mr-1.5 text-zinc-400">{n}.</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {head.map((h) => (
            <th
              key={h}
              className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium text-zinc-500 dark:border-zinc-700"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td className="border-b border-zinc-100 px-2 py-1.5 align-top text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
      {children}
    </td>
  );
}

function Contents() {
  return (
    <nav className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-800/40">
      <ol className="space-y-0.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(`manual-${s.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="w-full truncate text-left text-xs text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <span className="mr-1 text-zinc-400">{s.n}.</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function UserManual({
  onOpenRulesManual,
  onStartTour,
}: {
  onOpenRulesManual?: () => void;
  onStartTour?: () => void;
}) {
  return (
    <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          User Manual
        </h2>
        <p className="text-xs text-zinc-500">
          Setting up elements, writing rules, running a scenario.
        </p>
        {onStartTour && (
          <button
            type="button"
            onClick={onStartTour}
            className="text-xs font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
          >
            Take the guided tour →
          </button>
        )}
      </header>

      <Contents />

      <Section id="element" n={1} title="Setting up an element">
        <p className="text-xs text-zinc-500">
          Select a node or edge and fill in the Inspector on the right.
        </p>

        <Sub title="Identity and type">
          <Table head={["Field", "Meaning", "Consequence"]}>
            <tr>
              <Td>
                <strong>Label</strong>
              </Td>
              <Td>The name shown on the canvas.</Td>
              <Td>
                Rules can reference it. Two nodes with the same label make any
                rule naming it ambiguous — the rule is reported, not guessed.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Node Type</strong>
              </Td>
              <Td>Source / Infrastructure / Service / Personnel.</Td>
              <Td>
                Changes the shape drawn, nothing else. It does <strong>not</strong>{" "}
                make a node supply or consume anything — <Code>Supply Capacity</Code>{" "}
                and <Code>Demand</Code> do that.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Categories</strong>
              </Td>
              <Td>
                The services this node deals in (<Code>water</Code>,{" "}
                <Code>power</Code>, <Code>transport</Code>, <Code>manager</Code>,
                …).
              </Td>
              <Td>
                Determines how neighbours aggregate it: suppliers of the same
                category are alternatives, different categories are all required.
                A node with no category participates in nothing.
              </Td>
            </tr>
          </Table>
        </Sub>

        <Sub title="Supplier or consumer">
          <p className="text-xs text-zinc-500">
            Per category a node should be one or the other.
          </p>
          <Table head={["Field", "Meaning", "Consequence"]}>
            <tr>
              <Td>
                <strong>Supply Capacity</strong>
              </Td>
              <Td>Makes the node a source of that category.</Td>
              <Td>
                Effective output is{" "}
                <Code>supply_capacity × functionality / N</Code>, so a source at{" "}
                <Code>operational_warning</Code> on a 3-level scale delivers two
                thirds. Leave it empty and the node supplies nothing, whatever its
                Node Type says.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Demand</strong>
              </Td>
              <Td>Makes the node a consumer of that category.</Td>
              <Td>
                Only nodes with <Code>demand &gt; 0</Code> are served by the flow
                allocation. A <Code>SourceToDemands</Code> node with no demand is
                invisible to it.
              </Td>
            </tr>
          </Table>
          <Callout>
            Setting both for the <em>same</em> category is accepted but almost
            always a slip: the node becomes a source <em>and</em> a consumer of
            that category and partly serves its own demand. The Inspector flags
            it — split the node in two, or clear one value.
          </Callout>
        </Sub>

        <Sub title="Category dependency profile">
          <p className="text-xs text-zinc-500">
            One block per category the node consumes.
          </p>
          <Table head={["Field", "Meaning", "Consequence"]}>
            <tr>
              <Td>
                <strong>Dependency level</strong> <Code>1..N</Code>
              </Td>
              <Td>How hard a shortfall in this category pulls the node down.</Td>
              <Td>
                <Code>N</Code> (the default) passes the drop through unchanged.{" "}
                <Code>1</Code> means this category can never degrade the node.
                Values in between soften it — a <Code>critical</Code> upstream
                becomes a warning rather than a failure.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Has backup</strong> + <strong>Backup duration</strong>
              </Td>
              <Td>
                The node holds its current level instead of dropping, and starts a
                countdown.
              </Td>
              <Td>
                The drop is deferred, not cancelled. The countdown only moves when
                you fire a <strong>Temporal Jump</strong> — without one the node
                looks like it survived. On expiry it goes straight to <Code>1</Code>
                .
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Priority</strong> <Code>1..10</Code> (default 5)
              </Td>
              <Td>Who gets served first when supply is short.</Td>
              <Td>
                Only used by <Code>SourceToDemands</Code> categories. Equal
                priorities share the shortage; a higher priority takes its full
                demand before lower ones get anything.
              </Td>
            </tr>
          </Table>
          <p className="text-xs text-zinc-500">
            A category with no profile behaves as <Code>dependency_level = N</Code>{" "}
            — full dependency. Leaving it out never stops propagation.
          </p>
        </Sub>

        <Sub title="Vulnerability levels">
          <p>
            One entry per Event, on nodes and on edges. The level the Event
            imposes is <Code>N − vulnerability</Code>: at N=3, <Code>1</Code> →{" "}
            <Code>operational_warning</Code>, <Code>2</Code> → <Code>critical</Code>
            , absent → untouched.
          </p>
          <p className="text-xs text-zinc-500">
            An Event with no vulnerability entries anywhere does nothing when
            applied. For a <strong>Hazard</strong> every affected element is also
            flagged <Code>direct_damage</Code>, which is what puts it on the repair
            list.
          </p>
        </Sub>

        <Sub title="Socio-economic values">
          <Table head={["Field", "Meaning", "Consequence"]}>
            <tr>
              <Td>
                <strong>Importance</strong> <Code>0–1</Code>
              </Td>
              <Td>How much this node counts.</Td>
              <Td>
                No effect on propagation. It weights the Operativity Score, and
                through it decides which elements the Shapley analysis calls
                neuralgic.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Cost of disservice / day</strong>
              </Td>
              <Td>Money lost per day while degraded.</Td>
              <Td>
                Same: scoring and the repair ranking, never the cascade itself.
                Takes precedence over Importance where both are set.
              </Td>
            </tr>
          </Table>
        </Sub>

        <Sub title="Edges">
          <p>
            An edge <Code>a → b</Code> means <strong>a supplies b</strong>. Drawn
            the other way, nothing propagates.
          </p>
          <Table head={["Field", "Meaning", "Consequence"]}>
            <tr>
              <Td>
                <strong>Capacity</strong>
              </Td>
              <Td>Ceiling on the flow the edge carries.</Td>
              <Td>
                Scales with the edge&rsquo;s own Functionality. An edge carries
                exactly one category — for two limits on the same connection, draw
                two edges.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Functionality</strong>
              </Td>
              <Td>The edge&rsquo;s own condition.</Td>
              <Td>
                The engine commits <Code>worst_of(edge, source node)</Code>, so an
                intact edge from a failed source is still down.
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Vulnerability levels</strong>
              </Td>
              <Td>Same as nodes.</Td>
              <Td>
                An edge can be broken directly by a Hazard — a cut cable, a
                collapsed bridge.
              </Td>
            </tr>
          </Table>
        </Sub>
      </Section>

      <Section id="rules" n={2} title="Rules">
        <p>
          Rules cover what the graph alone cannot express. This is about when and
          why
          {onOpenRulesManual ? (
            <>
              ; the grammar reference is the{" "}
              <button
                type="button"
                onClick={onOpenRulesManual}
                className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
              >
                Rules Manual
              </button>
              .
            </>
          ) : (
            <>; the grammar reference is the Rules Manual panel.</>
          )}
        </p>

        <Sub title="When you need one">
          <p className="text-xs text-zinc-500">
            Without any rule the engine already assumes:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
            <li>
              several suppliers of the <strong>same</strong> category → the target
              takes the <strong>best</strong> of them (one healthy supplier is
              enough);
            </li>
            <li>
              several <strong>different</strong> categories → the target takes the{" "}
              <strong>worst</strong> across them (it needs all of them);
            </li>
            <li>
              partial tolerance is <Code>Dependency level</Code>, not a rule;
            </li>
            <li>
              a delayed failure is <Code>Has backup</Code>, not a rule.
            </li>
          </ul>
          <p className="text-xs text-zinc-500">
            Write a rule when the real system contradicts one of those. Many rules
            usually means the model wants a different Category Type or an extra
            node instead.
          </p>
        </Sub>

        <Sub title="The three kinds">
          <Table head={["Kind", "Shape", "What it changes"]}>
            <tr>
              <Td>
                <strong>Intracategorical</strong>
              </Td>
              <Td>
                <Code>op(a, b, …) propagates to target</Code>
              </Td>
              <Td>
                How the target combines suppliers <strong>within one</strong>{" "}
                category
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Intercategorical</strong>
              </Td>
              <Td>
                <Code>op(cat1, cat2, …) propagates to target</Code>
              </Td>
              <Td>
                How the target combines its <strong>different</strong> categories
              </Td>
            </tr>
            <tr>
              <Td>
                <strong>Specific</strong>
              </Td>
              <Td>
                <Code>{"if <condition> then <target> is <level>"}</Code>
              </Td>
              <Td>Forces an outcome when a named situation holds</Td>
            </tr>
          </Table>
          <p className="text-xs text-zinc-500">
            The kind is inferred: starting with <Code>if</Code> makes it Specific;
            otherwise naming a <em>category</em> in the arguments makes it
            Intercategorical, else Intracategorical. Operators:{" "}
            <Code>worst_of</Code>, <Code>best_of</Code>, <Code>average_of</Code>,{" "}
            <Code>median_of</Code>, <Code>majority_of</Code>.
          </p>
        </Sub>

        <Sub title="Examples">
          <p>
            <strong>Degrade gradually instead of all-or-nothing.</strong> A city
            has three road approaches. The default keeps it fully connected while
            any one is open; real traffic congests as routes close:
          </p>
          <Block>{`average_of(Udine Access, Aquileia Access, Cividale Access)
  propagates to Palmanova transport`}</Block>
          <p className="text-xs text-zinc-500">
            One route <Code>critical</Code>, two <Code>operational</Code> →{" "}
            <Code>⌊(1+3+3)/3⌋ = 2</Code>.
          </p>

          <p>
            <strong>Let one service cover for another.</strong> A town copes with
            losing power <em>or</em> water while the roads are open; it fails only
            when transport is impaired <strong>and</strong> one utility is too:
          </p>
          <Block>{`worst_of(
  best_of(Jalmicco electric, Jalmicco transport),
  best_of(Jalmicco water,    Jalmicco transport)
) propagates to Jalmicco`}</Block>

          <p>
            <strong>Hold an element up under a standing agreement.</strong> A water
            source depends on power, but a protocol between the two operators keeps
            it running while both are functioning:
          </p>
          <Block>{`if water Operator.protocol_active is True
and water Operator is operational
and electric Operator is operational
then Fauglis water Source is operational`}</Block>
          <p className="text-xs text-zinc-500">
            The first condition reads a custom attribute you added under{" "}
            <strong>Properties</strong>; the others read live Functionality. When
            either operator degrades the rule stops firing and normal propagation
            takes over. Conditions take <Code>and</Code> / <Code>or</Code> /{" "}
            <Code>not</Code>, parentheses, any attribute after a dot (default{" "}
            <Code>functionality</Code>), and <Code>{"< <= > >= = ≠"}</Code>.
          </p>
        </Sub>

        <Sub title="Order of application">
          <p className="text-xs text-zinc-500">
            Per node, per round: <strong>propose → guard → commit.</strong>
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
            <li>
              <strong>Propose</strong> — supplier logic; intra/intercategorical
              rules swap the combining operator here.
            </li>
            <li>
              <strong>Guard</strong> — <Code>Dependency level</Code> softens the
              proposal, <Code>Has backup</Code> defers it.
            </li>
            <li>
              <strong>Specific rules</strong> — highest priority; a firing rule
              replaces the result and overrides both the softening and the backup
              deferral.
            </li>
            <li>
              <strong>Commit</strong> — <Code>worst_of(current, result)</Code>.
            </li>
          </ol>
        </Sub>

        <Sub title="What bites people">
          <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
            <li>
              A rule that would <strong>improve</strong> an element does nothing.
            </li>
            <li>
              In an intracategorical rule the listed elements only{" "}
              <strong>select the category</strong> — the operator then governs{" "}
              <em>all</em> of the target&rsquo;s suppliers in it. Name the category
              directly to be unambiguous:{" "}
              <Code>worst_of(water) propagates to tank</Code>.
            </li>
            <li>
              A misspelt level label or an unknown element name makes the rule{" "}
              <strong>ignored with a warning</strong>, not an error. Read the
              warnings after a Propagation.
            </li>
          </ul>
        </Sub>
      </Section>

      <Section id="scenario" n={3} title="Running a scenario">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            <strong>Define the Event</strong> in Config → Events, as a{" "}
            <strong>Hazard</strong> (physical damage, needs repair) or a{" "}
            <strong>Disservice</strong> (no damage, clears with its cause). Then
            set <Code>Vulnerability levels</Code> on the exposed elements.
          </li>
          <li>
            <strong>Pick the scope.</strong> <em>Local</em> sends only the active
            Canvas; <em>Global</em> sends the whole project.
          </li>
          <li>
            <strong>Apply</strong> the Event. Several can be stacked before
            propagating.
          </li>
          <li>
            <strong>Propagate.</strong>
          </li>
          <li>
            <strong>Advance time</strong> if anything is on backup:{" "}
            <strong>Temporal Jump</strong> moves the clock by hand,{" "}
            <em>Auto-advance</em> jumps to the next expiry and re-propagates until
            nothing is left holding.
          </li>
        </ol>
        <Callout>
          <strong>Inter-canvas edges only participate under Global scope.</strong>{" "}
          A cross-sector cascade will not show up in a local run.
        </Callout>
        <p className="text-xs text-zinc-500">
          <strong>Reset</strong> ends the current scenario and hands back a
          working network. Every element goes to full functionality with no
          countdown and no damage, whatever put it there — so Reset always
          repairs the graph, even if something else has gone wrong. On top of
          that it undoes anything Events and Propagations changed beyond
          functionality, such as an attribute a rule wrote. Changes to the{" "}
          <em>model</em> stay: a renamed element, a moved node, a corrected
          capacity is your work, not the scenario&apos;s. It also ends any
          temporal-jump run, and clears the Analysis Heatmap, whose colours
          describe a scenario that is gone. Note that an element you authored
          below full functionality as its <em>normal</em> state is raised to full
          by Reset too.
        </p>
      </Section>

      <Section id="intervention" n={4} title="Testing an intervention">
        <p className="text-xs text-zinc-500">
          An intervention is a model edit, re-run and compared against a Scorecard
          entry saved from the baseline:
        </p>
        <Table head={["Intervention", "Set"]}>
          <tr>
            <Td>Physical hardening</Td>
            <Td>
              remove that element&rsquo;s <Code>Vulnerability levels</Code> entry
            </Td>
          </tr>
          <tr>
            <Td>Preparedness protocol</Td>
            <Td>a Specific rule</Td>
          </tr>
          <tr>
            <Td>Load-shedding agreement</Td>
            <Td>
              raise <Code>Priority</Code> on the protected consumer
            </Td>
          </tr>
          <tr>
            <Td>New backup</Td>
            <Td>
              <Code>Has backup</Code> + <Code>Backup duration</Code>
            </Td>
          </tr>
          <tr>
            <Td>More headroom</Td>
            <Td>
              raise <Code>Supply Capacity</Code>, or the <Code>Capacity</Code> of
              the limiting edge
            </Td>
          </tr>
        </Table>
      </Section>

      <Section id="analysis" n={5} title="Analysis results">
        <p>
          The Analysis page scores every element. <strong>Topological</strong>{" "}
          metrics (betweenness, reachability, communities, &hellip;) run in the
          browser. The Analysis window floats over the canvas: drag its title bar
          to move it, its edges to resize it, and the &minus; button to roll it
          up to the title bar when you want the canvas back. <strong>Model-based</strong> metrics (Vitality, Shapley)
          re-run the propagation engine once per element or coalition, so they
          need the server and can take a while &mdash; the panel shows the call
          count before you start, and Cancel keeps whatever it has.
        </p>
        <p>
          <strong>OI node weight</strong> decides which node attribute weights
          the Operativity Score. Changing it re-scores the result you already
          have &mdash; no new engine calls, and nothing is lost &mdash; so it is
          safe to try several weightings on one expensive run.
        </p>
        <p>
          The scores are painted onto the elements as soon as the metric
          finishes &mdash; no button to press. The canvas legend swaps its
          Functionality scale for the metric&rsquo;s own key, because the colours
          no longer mean Functionality. Change the OI node weight and the colours
          follow the new numbers. The overlay stays until you press{" "}
          <strong>Clear heatmap</strong> or Reset the scenario &mdash; closing
          the Analysis window leaves it alone, and the Analyse button carries a
          dot while a heatmap is live. <strong>Apply heatmap to canvas</strong>
          {" "}puts it back after a Clear.
        </p>
        <p>
          After a Shapley run,{" "}
          <strong>Export Shapley values (JSON)</strong> saves the result: one
          &phi;&#770; per element, plus the seed the run used. Keeping the seed
          means the same estimate can be replayed later, and the file is what the
          paper&rsquo;s centrality comparison reads, so a published number is
          always a number the app produced.
        </p>
      </Section>

      <Section id="server" n={6} title="Server and roles">
        <p>
          <strong>Propagate</strong> and the model-based analyses (Shapley,
          Vitality) need the server and <Code>can_propagate</Code> —{" "}
          <Code>analyst</Code> and above. <strong>Sync</strong> needs{" "}
          <Code>can_sync</Code>. Everything else, including topological analysis,
          works offline. Roles also carry a node cap and an engine-evaluation
          budget per minute.
        </p>
      </Section>

      <Section id="shortcuts" n={7} title="Keyboard shortcuts">
        <p>
          Every shortcut the editor listens for. They are ignored while you are
          typing in a text field, so they never fight the Inspector.{" "}
          <Code>Ctrl</Code> is <Code>⌘</Code> on macOS.
        </p>

        <Sub title="Editing">
          <Table head={["Key", "Does"]}>
            <tr>
              <Td><Code>Ctrl+Z</Code></Td>
              <Td>Undo the last change to the network.</Td>
            </tr>
            <tr>
              <Td><Code>Ctrl+Y</Code> or <Code>Ctrl+Shift+Z</Code></Td>
              <Td>Redo.</Td>
            </tr>
            <tr>
              <Td><Code>Ctrl+A</Code></Td>
              <Td>Select every element on the current Canvas, and open the Inspector.</Td>
            </tr>
            <tr>
              <Td><Code>Ctrl+C</Code> / <Code>Ctrl+V</Code></Td>
              <Td>Copy the selection, and paste it onto the active Canvas.</Td>
            </tr>
            <tr>
              <Td><Code>Delete</Code> or <Code>Backspace</Code></Td>
              <Td>Delete the selected nodes and edges.</Td>
            </tr>
          </Table>
        </Sub>

        <Sub title="Scenario">
          <Table head={["Key", "Does"]}>
            <tr>
              <Td><Code>Ctrl+R</Code></Td>
              <Td>
                Clear the most recently applied Event. This removes the cascade
                with it — a Propagation computed from an Event that is no longer
                there describes nothing. Other Events stay applied but
                un-propagated; re-run Propagation when you want the new cascade.
                Your own edits are untouched, and <Code>Ctrl+Z</Code> brings the
                Event and its cascade back. Note this takes over the
                browser&apos;s reload shortcut while the canvas has focus; use{" "}
                <Code>F5</Code> to reload.
              </Td>
            </tr>
          </Table>
        </Sub>

        <Sub title="Tools">
          <p>
            Single letters, no modifier — they pick the active tool, the same as
            clicking it in the toolbar.
          </p>
          <Table head={["Key", "Tool"]}>
            <tr><Td><Code>V</Code></Td><Td>Select</Td></tr>
            <tr><Td><Code>N</Code></Td><Td>Add node</Td></tr>
            <tr><Td><Code>E</Code></Td><Td>Add edge</Td></tr>
            <tr><Td><Code>H</Code></Td><Td>Pan</Td></tr>
          </Table>
        </Sub>
      </Section>
    </div>
  );
}
