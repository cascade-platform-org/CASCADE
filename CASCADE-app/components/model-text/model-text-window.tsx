"use client";

/**
 * ModelTextControl — the Action Bar's "Text" button and the Model text window
 * (ADR-0022): change anything the project and its configuration save, by a
 * change-set text written by hand or by an LLM.
 *
 * Nothing changes until the person has read the preview and confirmed it:
 * Check runs every stage of `lib/model-text.ts` on a copy, the preview lists
 * each change as before → after, and Apply writes the checked result
 * (`lib/model-text-apply.ts`), keeping a version first so Undo this edit can
 * put the model back. Text in the box is only data: it is parsed as JSON and
 * shown as text, never run and never rendered as HTML.
 */

import { useState } from "react";
import { AlertTriangle, Bot, Braces, Check, ClipboardCopy, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { SmallButton } from "@/components/temporal/fields";
import { MODEL_TEXT_ANCHOR_ID } from "@/lib/ui-anchors";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useUiStore } from "@/store/ui-store";
import { MODEL_TEXT_REFERENCE, STARTER_TEXT, checkChange, modelTextContext, parseChangeText, readPointer, type Preview } from "@/lib/model-text";
import { applyModelBundle, currentBundle, restoreModelBundle } from "@/lib/model-text-apply";
import type { ProjectBundle } from "@/lib/file-io";

type Result =
  | { kind: "errors"; errors: string[] }
  | { kind: "preview"; preview: Preview; warnings: string[]; after: ProjectBundle }
  | { kind: "applied"; preview: Preview; before: ProjectBundle };

/** Lines shown before "… N more": a preview of thousands of rows helps nobody read it. */
const PREVIEW_LINES = 400;

const TONE = {
  add: "text-green-700 dark:text-green-400",
  remove: "text-red-700 dark:text-red-400",
  change: "text-zinc-700 dark:text-zinc-300",
} as const;
const MARK = { add: "+", remove: "−", change: "~" } as const;

function PreviewList({ preview }: { preview: Preview }) {
  const { counts, lines } = preview;
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 p-2 font-mono text-[11px] leading-4 dark:border-zinc-700">
      <p className="mb-1 font-sans font-medium text-zinc-700 dark:text-zinc-200">
        {counts.add} added · {counts.change} changed · {counts.remove} removed
      </p>
      {lines.slice(0, PREVIEW_LINES).map((l, i) => (
        <p key={i} className={cn("break-all", TONE[l.kind])}>
          {MARK[l.kind]} {l.where}
          {l.kind === "change" && <span className="text-zinc-500">: {l.before} → {l.after}</span>}
        </p>
      ))}
      {lines.length > PREVIEW_LINES && <p className="text-zinc-400">… {lines.length - PREVIEW_LINES} more</p>}
    </div>
  );
}

function ModelTextPanel() {
  const [text, setText] = useState(STARTER_TEXT);
  const [section, setSection] = useState("/config/events");
  const [result, setResult] = useState<Result | null>(null);
  const [showRef, setShowRef] = useState(false);
  const running = useTemporalSimulationStore((s) => s.running);
  const pushToast = useUiStore((s) => s.pushToast);

  async function copy(content: string, what: string) {
    try {
      await navigator.clipboard.writeText(content);
      pushToast({ message: `Copied ${what}.`, variant: "success", durationMs: 2000 });
    } catch {
      pushToast({ message: "The clipboard is blocked; select the text instead.", variant: "warning", durationMs: 3000 });
    }
  }

  function copySection() {
    const value = readPointer(currentBundle(), section);
    if (value === undefined) {
      setResult({ kind: "errors", errors: [`Nothing at ${section}.`] });
      return;
    }
    void copy(JSON.stringify(value, null, 2), section);
  }

  function check() {
    const parsed = parseChangeText(text);
    if (!parsed.ok) { setResult({ kind: "errors", errors: parsed.errors }); return; }
    const checked = checkChange(currentBundle(), parsed.change);
    setResult(checked.ok ? { kind: "preview", preview: checked.preview, warnings: checked.warnings, after: checked.after } : { kind: "errors", errors: checked.errors });
  }

  function apply() {
    if (result?.kind !== "preview") return;
    // Checked again on the model as it is now: it may have changed since the preview.
    const parsed = parseChangeText(text);
    const checked = parsed.ok ? checkChange(currentBundle(), parsed.change) : null;
    if (!checked?.ok) { check(); return; }
    const before = applyModelBundle(checked.after);
    if (!before) return;
    setResult({ kind: "applied", preview: checked.preview, before });
    pushToast({ message: "Model text applied. A version was kept; Undo this edit puts it back.", variant: "success", durationMs: 4000 });
  }

  function undo() {
    if (result?.kind !== "applied") return;
    if (!window.confirm("Put the project and its configuration back as they were before this edit? Changes made since are lost.")) return;
    if (restoreModelBundle(result.before)) {
      setResult(null);
      pushToast({ message: "Model text edit undone.", variant: "info", durationMs: 3000 });
    }
  }

  const changes = result?.kind === "preview" ? result.preview.lines.length : 0;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Section to copy (a JSON Pointer)"
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="w-44 rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />
        <SmallButton onClick={copySection} title="Copy that part of the project or configuration as JSON"><ClipboardCopy size={11} /> Copy section</SmallButton>
        <SmallButton onClick={() => void copy(modelTextContext(currentBundle()), "the context for an LLM")} title="The format and this model's ids and names, to paste into an LLM with your request">
          <Bot size={11} /> Copy with context for an LLM
        </SmallButton>
        <span className="flex-1" />
        <SmallButton onClick={() => { setText(STARTER_TEXT); setResult(null); }}><RotateCcw size={11} /> Clear</SmallButton>
        <SmallButton onClick={check}><Check size={11} /> Check &amp; preview</SmallButton>
        <span data-run-locked>
          <SmallButton tone="accent" disabled={result?.kind !== "preview" || changes === 0 || running} onClick={apply} title="Write the previewed changes; a version of the whole project is kept first">
            <Upload size={11} /> Apply {changes > 0 ? `${changes} change${changes > 1 ? "s" : ""}` : ""}
          </SmallButton>
        </span>
      </div>

      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => { setText(e.target.value); if (result?.kind !== "applied") setResult(null); }}
        className="min-h-[180px] flex-1 resize-none rounded-md border border-zinc-200 bg-white p-2 font-mono text-[11px] leading-4 text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
      />
      <p className="text-[11px] text-zinc-400">
        A change set: <code>patch</code> (add, replace, remove at a path under /project or /config) and <code>elements</code> (Attribute Operations). Paste bare JSON or a whole LLM reply. Nothing changes until you confirm the preview.
      </p>

      {result?.kind === "errors" && (
        <div role="alert" className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
          <p className="mb-1 font-medium">Not applied — {result.errors.length} problem{result.errors.length > 1 ? "s" : ""}:</p>
          {result.errors.slice(0, 50).map((e, i) => <p key={i} className="break-all">• {e}</p>)}
        </div>
      )}
      {result?.kind === "preview" && (
        <>
          {changes === 0 ? <p className="text-[11px] text-zinc-500">Valid, and it changes nothing.</p> : <PreviewList preview={result.preview} />}
          {result.warnings.map((w, i) => <p key={i} className="flex gap-1 text-[11px] text-amber-800 dark:text-amber-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{w}</p>)}
        </>
      )}
      {result?.kind === "applied" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] text-green-700 dark:text-green-400">
            <Check size={12} /> Applied {result.preview.lines.length} change{result.preview.lines.length > 1 ? "s" : ""}. The version before it is kept in File → Local → Recent saves.
            <span className="flex-1" />
            <SmallButton onClick={undo}><RotateCcw size={11} /> Undo this edit</SmallButton>
          </div>
          <PreviewList preview={result.preview} />
        </div>
      )}

      <button type="button" className="self-start text-[11px] text-blue-700 hover:underline dark:text-blue-400" onClick={() => setShowRef((v) => !v)}>
        {showRef ? "Hide" : "Show"} format reference
      </button>
      {showRef && <pre className="max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] leading-4 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{MODEL_TEXT_REFERENCE}</pre>}
    </div>
  );
}

export function ModelTextControl({ buttonClassName }: { buttonClassName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        id={MODEL_TEXT_ANCHOR_ID}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Model text: change anything the project and its configuration save, by text (checked and previewed before it applies)"
        className={buttonClassName}
      >
        <Braces size={13} />
        <span>Text</span>
      </button>
      <FloatingWindow
        open={open}
        onClose={() => setOpen(false)}
        title="Model text"
        icon={<Braces size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
        flyToOnClose={MODEL_TEXT_ANCHOR_ID}
        storageKey="cascade.model-text.window"
        defaultSize={{ w: 760, h: 620 }}
        minSize={{ w: 480, h: 360 }}
      >
        <ModelTextPanel />
      </FloatingWindow>
    </>
  );
}
