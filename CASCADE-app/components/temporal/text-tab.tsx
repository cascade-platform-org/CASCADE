"use client";

/**
 * TextTab — the whole Temporal Simulation definition as JSON, for bulk edits
 * and LLM round-trips. Apply validates with the same schema the other tabs
 * edit through; errors block, project-reference problems only warn.
 */

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, Check, ClipboardCopy, Bot, RotateCcw, Upload, XCircle } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import {
  FORMAT_REFERENCE,
  docToDraft,
  docWarnings,
  draftToDoc,
  llmContext,
  parseDocText,
  serializeDoc,
} from "@/lib/temporal-simulation-text";
import { EXPLAIN_COPY, EXPLAIN_COPY_LLM, explainApply } from "@/lib/temporal-simulation-explainers";
import { SmallButton } from "./fields";

export function TextTab() {
  const { timeline, profile, metrics } = useTemporalSimulationStore(useShallow((s) => ({ timeline: s.timeline, profile: s.profile, metrics: s.metrics })));
  const { explain, replaceDraft } = useTemporalSimulationStore.getState();
  const running = useTemporalSimulationStore((s) => s.running);
  // Config and the model are read when a button is used; this tab does not re-render on their changes.
  const doc = useMemo(() => draftToDoc({ timeline, profile, metrics }), [timeline, profile, metrics]);
  const currentText = useMemo(() => serializeDoc(doc), [doc]);
  const [text, setText] = useState(currentText);
  const [result, setResult] = useState<{ errors: string[]; warnings: string[]; applied: boolean } | null>(null);
  const [showRef, setShowRef] = useState(false);
  const dirty = text !== currentText;

  function check(apply: boolean) {
    const parsed = parseDocText(text);
    if (!parsed.ok) {
      setResult({ errors: parsed.errors, warnings: [], applied: false });
      explain(explainApply(parsed.errors.length, 0));
      return;
    }
    const warnings = docWarnings(parsed.doc, useConfigStore.getState().config.events, useCanvasStore.getState());
    if (apply) {
      replaceDraft(docToDraft(parsed.doc, nanoid));
      setText(serializeDoc(parsed.doc));
      explain(explainApply(0, warnings.length));
    }
    setResult({ errors: [], warnings, applied: apply });
  }

  async function copy(content: string) {
    try { await navigator.clipboard.writeText(content); } catch { /* clipboard blocked: the text stays selectable */ }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SmallButton onClick={() => { void copy(text); explain(EXPLAIN_COPY); }}><ClipboardCopy size={11} /> Copy</SmallButton>
        <SmallButton onClick={() => { void copy(llmContext(doc, useConfigStore.getState().config, useCanvasStore.getState())); explain(EXPLAIN_COPY_LLM); }}>
          <Bot size={11} /> Copy with context for an LLM
        </SmallButton>
        <span className="flex-1" />
        <SmallButton disabled={!dirty} onClick={() => { setText(currentText); setResult(null); }}><RotateCcw size={11} /> Revert text</SmallButton>
        <SmallButton onClick={() => check(false)}><Check size={11} /> Check</SmallButton>
        <SmallButton tone="accent" disabled={!dirty || running} onClick={() => check(true)}><Upload size={11} /> Apply</SmallButton>
      </div>

      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
        onPaste={() => setResult(null)}
        className="min-h-[260px] flex-1 resize-none rounded-md border border-zinc-200 bg-white p-2 font-mono text-[11px] leading-4 text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
      />
      <p className="text-[11px] text-zinc-400">
        Paste bare JSON or a whole LLM reply — the first <code>```json</code> block is used. {dirty ? "Edited — not applied yet." : "Matches the draft."}
      </p>

      {result && result.errors.length > 0 && (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          {result.errors.map((e, i) => <li key={i} className="flex gap-1"><XCircle size={11} className="mt-0.5 shrink-0" />{e}</li>)}
        </ul>
      )}
      {result && result.errors.length === 0 && (
        <div className="max-h-32 overflow-y-auto rounded-md border border-zinc-200 p-2 text-[11px] dark:border-zinc-700">
          <p className="mb-1 font-medium text-green-700 dark:text-green-400">{result.applied ? "Applied." : "Valid."} {result.warnings.length} warning(s).</p>
          {result.warnings.map((w, i) => <p key={i} className="flex gap-1 text-amber-800 dark:text-amber-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{w}</p>)}
        </div>
      )}

      <button type="button" className="self-start text-[11px] text-blue-700 hover:underline dark:text-blue-400" onClick={() => setShowRef((v) => !v)}>
        {showRef ? "Hide" : "Show"} format reference
      </button>
      {showRef && <pre className="max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] leading-4 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{FORMAT_REFERENCE}</pre>}
    </div>
  );
}
