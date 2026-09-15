"use client";

/**
 * UserManual — the in-app user guide.
 *
 * It no longer carries any prose. `docs/project/user-manual.md` is the single
 * source: `npm run docs:manual` parses it into `lib/generated/user-manual.ts`,
 * and this file is the renderer that gives that structure the app's own
 * styling. Two copies of the same text was one copy too many — they drifted,
 * which is what this arrangement exists to make impossible
 * (`lib/manual/user-manual.test.ts` fails when the generated file is stale).
 *
 * Two things are NOT in the markdown, because they are behaviour rather than
 * text: the walkthrough list (read from the tour registry, so a new tour
 * appears here by existing) and the Rules Manual button. The second is written
 * in the markdown as an ordinary link, `[Rules Manual](cascade:rules-manual)`,
 * and turned into a button here — a `cascade:` href is the manual's way of
 * naming an action instead of a destination.
 *
 * It deliberately stops where the rule grammar begins — that reference lives in
 * the Rules Manual window, opened from §3.
 */

import type { ReactNode } from "react";
import { TOURS, TOUR_IDS, type TourId } from "@/lib/tour/registry";
import { USER_MANUAL } from "@/lib/generated/user-manual";
import type { ManualBlock, ManualSpan } from "@/lib/manual/types";

/** Actions the manual can name in a link, instead of a destination. */
const ACTION_PREFIX = "cascade:";

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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium text-zinc-500 dark:border-zinc-700"
              >
                {h.replace(/\*\*/g, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td className="border-b border-zinc-100 px-2 py-1.5 align-top text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Rendering the parsed markdown
// ---------------------------------------------------------------------------

function Spans({
  spans,
  onAction,
}: {
  spans: ManualSpan[];
  onAction?: (action: string) => void;
}) {
  return (
    <>
      {spans.map((span, i) => {
        switch (span.kind) {
          case "code":
            return <Code key={i}>{span.text}</Code>;
          case "strong":
            return <strong key={i}>{span.text}</strong>;
          case "em":
            return <em key={i}>{span.text}</em>;
          case "break":
            return <br key={i} />;
          case "link": {
            if (span.href.startsWith(ACTION_PREFIX)) {
              const action = span.href.slice(ACTION_PREFIX.length);
              // No handler wired (the manual rendered outside the editor): the
              // name still reads correctly as plain text.
              if (!onAction) return <strong key={i}>{span.text}</strong>;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onAction(action)}
                  className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
                >
                  {span.text}
                </button>
              );
            }
            return (
              <a
                key={i}
                href={span.href}
                className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
              >
                {span.text}
              </a>
            );
          }
          default:
            return <span key={i}>{span.text}</span>;
        }
      })}
    </>
  );
}

function Blocks({
  blocks,
  onAction,
}: {
  blocks: ManualBlock[];
  onAction?: (action: string) => void;
}) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={i} className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                <Spans spans={block.spans} onAction={onAction} />
              </p>
            );
          case "callout":
            return (
              <Callout key={i}>
                <Spans spans={block.spans} onAction={onAction} />
              </Callout>
            );
          case "code":
            return <Block key={i}>{block.text}</Block>;
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                className={`space-y-1 pl-5 text-xs text-zinc-600 dark:text-zinc-400 ${
                  block.ordered ? "list-decimal" : "list-disc"
                }`}
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} onAction={onAction} />
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <Table key={i} head={block.head}>
                {block.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <Td key={k}>
                        <Spans spans={cell} onAction={onAction} />
                      </Td>
                    ))}
                  </tr>
                ))}
              </Table>
            );
          case "sub":
            return (
              <Sub key={i} title={block.title}>
                <Blocks blocks={block.blocks} onAction={onAction} />
              </Sub>
            );
        }
      })}
    </>
  );
}

function Contents() {
  return (
    <nav className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-800/40">
      <ol className="space-y-0.5">
        {USER_MANUAL.sections.map((s) => (
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

/** One walkthrough offered in a single line: name, what it teaches, start. */
function TourLine({
  name,
  blurb,
  onStart,
}: {
  name: string;
  blurb: string;
  onStart: () => void;
}) {
  return (
    <p className="text-xs text-zinc-500">
      <button
        type="button"
        onClick={onStart}
        className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400"
      >
        {name}
      </button>{" "}
      — {blurb}
    </p>
  );
}

export function UserManual({
  onOpenRulesManual,
  onStartTour,
}: {
  onOpenRulesManual?: () => void;
  /** Omitted where no tour can be started from — the list is then hidden. */
  onStartTour?: (id: TourId) => void;
}) {
  const onAction = onOpenRulesManual
    ? (action: string) => {
        if (action === "rules-manual") onOpenRulesManual();
      }
    : undefined;

  return (
    <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          User Manual
        </h2>
        <p className="text-xs text-zinc-500">
          Setting up elements, writing rules, running a scenario.
        </p>
      </header>

      <Contents />

      {/* The walkthroughs, one line each, straight from the registry: what
          each teaches is declared once there, and the tour's own first card
          says the rest. */}
      {onStartTour && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Platform Tutorials
          </p>
          {TOUR_IDS.map((id) => (
            <TourLine
              key={id}
              name={TOURS[id].label}
              blurb={TOURS[id].blurb}
              onStart={() => onStartTour(id)}
            />
          ))}
        </div>
      )}

      {USER_MANUAL.sections.map((section) => (
        <Section key={section.id} id={section.id} n={section.n} title={section.title}>
          <Blocks blocks={section.blocks} onAction={onAction} />
        </Section>
      ))}
    </div>
  );
}
