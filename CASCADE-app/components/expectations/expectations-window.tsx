"use client";

/**
 * The Expectations window (ADR-0023): what the person knows their system does,
 * each statement with a check the app runs on a copy of the model, and its
 * latest result this session. Most Expectations are written by an LLM or an
 * agent from the person's words and arrive unconfirmed; the person confirms the
 * statement, never the check's JSON. A check can still be edited by hand here.
 */

import { useMemo, useState } from "react";
import { ListChecks, Play, Square, Copy, Sparkles, Plus, Pencil, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { SmallButton, inputCls } from "@/components/temporal/fields";
import { useLlmCopy } from "@/components/model-text/llm-copy";
import { usePropagationGate } from "@/hooks/usePropagate";
import { useUiStore } from "@/store/ui-store";
import { useConfigStore } from "@/store/config-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useProjectDataStore } from "@/store/project-data-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useExpectationRunStore } from "@/store/expectation-run-store";
import { EXPECTATIONS_ANCHOR_ID } from "@/lib/ui-anchors";
import { cancelExpectations, runProjectExpectations } from "@/lib/expectations-run";
import { describeCheck, resultsText, templateCheck, type ExpectationResult } from "@/lib/expectations";
import { isUnconfirmed } from "@/lib/provenance";
import type { Expectation } from "@/lib/schemas/expectation";

const USAGE = "Expectations: what you know your system does, checked against the model";

export function ExpectationsControl({ buttonClassName }: { buttonClassName: string }) {
  const open = useUiStore((s) => s.expectationsOpen);
  const toggle = useUiStore((s) => s.toggleExpectations);
  const close = useUiStore((s) => s.closeExpectations);
  return (
    <>
      <button id={EXPECTATIONS_ANCHOR_ID} type="button" onClick={toggle} title={USAGE} className={buttonClassName}>
        <ListChecks size={15} />
        <span className="hidden text-xs sm:inline">Expectations</span>
      </button>
      <FloatingWindow
        open={open}
        onClose={close}
        title="Expectations"
        icon={<ListChecks size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
        flyToOnClose={EXPECTATIONS_ANCHOR_ID}
        storageKey="cascade.expectations.window"
        defaultSize={{ w: 720, h: 560 }}
        minSize={{ w: 480, h: 320 }}
      >
        <ExpectationsPanel />
      </FloatingWindow>
    </>
  );
}

function ExpectationsPanel() {
  const expectations = useProjectDataStore((s) => s.expectations);
  const results = useExpectationRunStore((s) => s.results);
  const progress = useExpectationRunStore((s) => s.progress);
  const blocked = usePropagationGate();
  const { copyForLlm, notice } = useLlmCopy();
  const [editing, setEditing] = useState<string | null>(null);

  const ran = expectations.filter((e) => results[e.id]);
  const passed = ran.filter((e) => results[e.id].status === "pass").length;

  function addNew() {
    const config = useConfigStore.getState().config;
    const nodes = Object.keys(useCanvasStore.getState().nodes);
    setEditing(useProjectDataStore.getState().addExpectation(templateCheck(config.events[0]?.id, nodes[0])));
  }

  function copyResults() {
    copyForLlm(() => {
      const list = useProjectDataStore.getState().expectations;
      const latest = useExpectationRunStore.getState().results;
      return resultsText(list, list.map((e) => latest[e.id]).filter((r): r is ExpectationResult => r !== undefined));
    }, "the results for the LLM");
  }

  return (
    <div className="flex h-full flex-col text-xs text-zinc-700 dark:text-zinc-200">
      {notice}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="mr-auto font-medium">
          {expectations.length === 0
            ? "No Expectations yet"
            : ran.length === 0
              ? `${expectations.length} Expectation${expectations.length === 1 ? "" : "s"}, not run yet`
              : `${passed} of ${ran.length} pass`}
          {progress && <span className="ml-2 text-zinc-400">running {progress.done}/{progress.total}…</span>}
        </span>
        {progress ? (
          <SmallButton onClick={cancelExpectations}><Square size={12} /> Cancel</SmallButton>
        ) : (
          <SmallButton tone="accent" onClick={() => void runProjectExpectations()} disabled={!!blocked || expectations.length === 0} title={blocked ?? "Run every check on a copy of the model"}>
            <Play size={12} /> Run all
          </SmallButton>
        )}
        <SmallButton onClick={copyResults} disabled={ran.length === 0} title="The statements and their latest results, for the LLM to repair what fails">
          <Copy size={12} /> Copy results for the LLM
        </SmallButton>
        <SmallButton onClick={() => useUiStore.getState().openLlmDesign({ recipe: "calibrate" })} title="Tell an LLM what you know; it writes the Expectations and the changes">
          <Sparkles size={12} /> Calibrate with an LLM
        </SmallButton>
        <SmallButton onClick={addNew}><Plus size={12} /> New</SmallButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {expectations.length === 0 && (
          <p className="p-4 text-zinc-500">
            An Expectation is something you know your system does — &ldquo;if the grid fails, the hospital runs 8 hours on
            its generators&rdquo; — written so the app can check the model against it. Use <b>Calibrate with an LLM</b>, or
            let an agent write them with you.
          </p>
        )}
        {expectations.map((e) => (
          <ExpectationRow
            key={e.id}
            expectation={e}
            result={results[e.id]}
            editing={editing === e.id}
            onEdit={() => setEditing(editing === e.id ? null : e.id)}
            runBlocked={blocked ?? (progress ? "Checks are running" : null)}
          />
        ))}
      </div>
    </div>
  );
}

const STATUS: Record<ExpectationResult["status"], { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-success-soft text-success dark:bg-green-900/30 dark:text-green-400" },
  fail: { label: "Fail", cls: "bg-danger-soft text-danger dark:bg-red-900/30 dark:text-red-400" },
  error: { label: "Cannot run", cls: "bg-warning-soft text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
};

function ExpectationRow({
  expectation: e,
  result,
  editing,
  onEdit,
  runBlocked,
}: {
  expectation: Expectation;
  result: ExpectationResult | undefined;
  editing: boolean;
  onEdit: () => void;
  runBlocked: string | null;
}) {
  const events = useConfigStore((s) => s.config.events);
  const simulations = useTemporalSimulationStore((s) => s.simulations);
  const summary = useMemo(
    () =>
      describeCheck(e.check, {
        event: (id) => events.find((x) => x.id === id)?.label ?? id,
        simulation: (id) => simulations.find((x) => x.id === id)?.timeline.name ?? id,
      }),
    [e.check, events, simulations],
  );
  const status = result && STATUS[result.status];
  const store = useProjectDataStore.getState();

  return (
    <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold", status?.cls ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800")}>
          {status?.label ?? "Not run"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-800 dark:text-zinc-100">&ldquo;{e.statement}&rdquo;</p>
          <p className="text-[11px] text-zinc-500">{summary}</p>
          {isUnconfirmed(e) && (
            <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
              Unconfirmed — written by {e.provenance?.origin === "agent" ? "an agent" : "LLM Design"}
              {e.provenance?.rationale ? `: ${e.provenance.rationale}` : ""}. Is this true of your system?
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isUnconfirmed(e) && (
            <SmallButton tone="accent" onClick={() => store.confirmExpectation(e.id)} title="Yes: this is true of my system">
              <Check size={12} /> Confirm
            </SmallButton>
          )}
          <SmallButton onClick={() => void runProjectExpectations([e.id])} disabled={!!runBlocked} title={runBlocked ?? "Run this check"}>
            <Play size={12} />
          </SmallButton>
          <SmallButton onClick={onEdit} title="Edit the statement and its check"><Pencil size={12} /></SmallButton>
          <SmallButton tone="danger" onClick={() => store.removeExpectation(e.id)} title="Delete"><Trash2 size={12} /></SmallButton>
        </div>
      </div>
      {result && result.lines.length > 0 && (
        <pre className="mt-1.5 ml-[72px] whitespace-pre-wrap rounded bg-zinc-50 p-1.5 font-mono text-[11px] leading-snug text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {result.lines.join("\n")}
        </pre>
      )}
      {editing && <ExpectationEditor expectation={e} onDone={onEdit} />}
    </div>
  );
}

function ExpectationEditor({ expectation, onDone }: { expectation: Expectation; onDone: () => void }) {
  const [statement, setStatement] = useState(expectation.statement);
  const [checkText, setCheckText] = useState(() => JSON.stringify(expectation.check, null, 2));
  const [error, setError] = useState<string | null>(null);

  function save() {
    let raw: unknown;
    try {
      raw = JSON.parse(checkText);
    } catch {
      setError("The check is not valid JSON.");
      return;
    }
    // The store validates the whole Expectation and says which field is wrong.
    const why = useProjectDataStore.getState().putExpectation({ ...expectation, statement: statement.trim() || expectation.statement, check: raw as Expectation["check"] });
    if (why) setError(why);
    else onDone();
  }

  return (
    <div className="mt-2 ml-[72px] flex flex-col gap-1.5">
      <input className={inputCls} value={statement} onChange={(ev) => setStatement(ev.target.value)} aria-label="Statement" />
      <textarea
        className={cn(inputCls, "h-40 font-mono text-[11px]")}
        value={checkText}
        onChange={(ev) => setCheckText(ev.target.value)}
        spellCheck={false}
        aria-label="Check (JSON)"
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end gap-1">
        <SmallButton onClick={onDone}>Cancel</SmallButton>
        <SmallButton tone="accent" onClick={save}>Save</SmallButton>
      </div>
    </div>
  );
}
