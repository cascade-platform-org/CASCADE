"use client";

/**
 * ImportChangesWindow — an edited Workbook brought into the open project
 * (ADR-0023 §3), opened from the File panel's Import changes.
 *
 * It shows every change the file makes, one group per record or setting, each
 * with a tick to leave it out; what the file cannot say, cell by cell; and the
 * values it filled in for new rows. Apply re-reads the file against the
 * project as it is now, writes the result (keeping a version first, as LLM
 * Design does) and offers Undo this import. What it adds is marked from its
 * file, sheet and row, unconfirmed, until a person confirms it in the
 * Inspector or the Events tab. Nothing in the file is ever run.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileSpreadsheet, Info, RotateCcw, Upload } from "lucide-react";
import { FloatingWindow } from "@/components/ui/floating-window";
import { SmallButton } from "@/components/temporal/fields";
import { PreviewList } from "@/components/model-text/preview-list";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useUiStore } from "@/store/ui-store";
import { applyModelBundle, restoreModelBundle } from "@/lib/model-text-apply";
import { currentBundle } from "@/lib/project-bundle";
import { describeProblem } from "@/lib/workbook/codec";
import { composeImport, type ReadImport } from "@/lib/workbook/import-changes";
import { readWorkbookImport } from "@/lib/workbook";
import type { Problem } from "@/lib/workbook/model";
import type { Preview } from "@/lib/model-text";
import type { PreviewGroup } from "@/lib/model-text-v2";
import type { ProjectBundle } from "@/lib/schemas/bundle";

/** Problems shown before "… N more". */
const SHOWN = 60;

function Problems({ items, tone }: { items: Problem[]; tone: "error" | "warning" | "note" }) {
  if (items.length === 0) return null;
  const style = {
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300",
    note: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
  }[tone];
  const title = {
    error: `Not importable — ${items.length} problem${items.length === 1 ? "" : "s"}, each at its cell:`,
    warning: `${items.length} thing${items.length === 1 ? "" : "s"} to check:`,
    note: `${items.length} value${items.length === 1 ? "" : "s"} read or filled in:`,
  }[tone];
  const Icon = tone === "note" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`max-h-40 overflow-y-auto rounded-md border p-2 text-[11px] ${style}`}>
      <p className="mb-1 flex items-center gap-1 font-medium"><Icon size={11} /> {title}</p>
      {items.slice(0, SHOWN).map((p, i) => <p key={i} className="break-all">• {describeProblem(p)}</p>)}
      {items.length > SHOWN && <p>… {items.length - SHOWN} more</p>}
    </div>
  );
}

type Applied = { before: ProjectBundle; preview: Preview; groups: PreviewGroup[] };

function ImportChangesPanel({ bytes, initial }: { bytes: Uint8Array; initial: ReadImport }) {
  const [read, setRead] = useState(initial);
  const [leaveOut, setLeaveOut] = useState<ReadonlySet<number>>(new Set());
  const [massOk, setMassOk] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const running = useTemporalSimulationStore((s) => s.running);
  const pushToast = useUiStore((s) => s.pushToast);
  const composed = useMemo(() => (read.ok ? composeImport(read, leaveOut) : null), [read, leaveOut]);

  const of = (severity: Problem["severity"]) => [...read.problems, ...(composed?.problems ?? [])].filter((p) => p.severity === severity);
  const changes = composed?.checked.ok ? composed.checked.preview.lines.length : 0;
  const toggleable = (composed?.groups.filter((g) => g.index !== undefined).length ?? 0) > 1;

  function toggle(index: number) {
    setLeaveOut((s) => {
      const next = new Set(s);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setMassOk(false);
  }

  async function apply() {
    setBusy(true);
    try {
      // Read again against the project as it is now: it may have changed since the preview.
      const now = await readWorkbookImport(bytes, currentBundle(), read.file);
      const subjects = (r: ReadImport) => (r.ok ? composeImport(r).groups.map((g) => g.subjects.join()) : []);
      if (!now.ok || subjects(now).join("\n") !== subjects(read).join("\n")) {
        setRead(now);
        setLeaveOut(new Set());
        setStale(true);
        return;
      }
      const result = composeImport(now, leaveOut);
      if (!result.checked.ok) { setRead(now); return; }
      const before = applyModelBundle(result.checked.after, `Import changes from ${read.file}`);
      if (!before) return;
      setApplied({ before, preview: result.checked.preview, groups: result.groups });
      pushToast({ message: `Imported ${result.checked.preview.lines.length} change${result.checked.preview.lines.length === 1 ? "" : "s"} from ${read.file}. A version was kept; Undo this import puts it back.`, variant: "success", durationMs: 5000 });
    } finally {
      setBusy(false);
    }
  }

  function undo() {
    if (!applied) return;
    if (!window.confirm("Put the project and its configuration back as they were before this import? Changes made since are lost.")) return;
    if (restoreModelBundle(applied.before)) {
      setApplied(null);
      pushToast({ message: "Import undone.", variant: "info", durationMs: 3000 });
    }
  }

  if (applied) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-center gap-2 text-[11px] text-green-700 dark:text-green-400">
          <Check size={12} /> Imported {applied.preview.lines.length} change{applied.preview.lines.length === 1 ? "" : "s"} from {read.file}. The version before it is kept in File → Local → Recent saves; Ctrl+Z also undoes the import.
          <span className="flex-1" />
          <SmallButton onClick={undo}><RotateCcw size={11} /> Undo this import</SmallButton>
        </div>
        <PreviewList preview={applied.preview} groups={applied.groups} className="max-h-none min-h-0 flex-1" />
      </div>
    );
  }

  const blocked = !composed?.checked.ok || changes === 0 || running || busy || (!!composed.massDeletion && !massOk);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheet size={14} className="text-zinc-400" />
        <span className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">{read.file}</span>
        <span className="flex-1" />
        <span data-run-locked>
          <SmallButton tone="accent" disabled={blocked} onClick={() => void apply()} title="Write the ticked changes; a version of the whole project is kept first">
            <Upload size={11} /> Apply {changes > 0 ? `${changes} change${changes === 1 ? "" : "s"}` : ""}
          </SmallButton>
        </span>
      </div>
      <p className="rounded-md bg-blue-50 px-2 py-1.5 text-[11px] leading-4 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
        Every change this file makes to the open project, by record. Untick one to leave it out. A row missing from a sheet deletes its record;
        a sheet missing from the file changes nothing. Nothing changes until you Apply, and Undo this import puts it back.
      </p>
      {stale && <p className="text-[11px] text-amber-800 dark:text-amber-300">The project changed since the preview: here is the file read again. Check it, then Apply.</p>}

      <Problems items={of("error")} tone="error" />
      {composed && composed.groups.length === 0 && read.ok && <p className="text-[11px] text-zinc-500">The file and the project hold the same: nothing to import.</p>}
      {composed && composed.groups.length > 0 && (
        <PreviewList
          preview={composed.checked.ok ? composed.checked.preview : { counts: { add: 0, change: 0, remove: 0 }, lines: [] }}
          groups={composed.groups}
          leaveOut={leaveOut}
          onToggle={toggleable ? toggle : undefined}
          className="max-h-none min-h-[8rem] flex-1"
        />
      )}
      {composed?.massDeletion && (
        <label className="flex items-center gap-1.5 text-[11px] text-red-700 dark:text-red-400">
          <input type="checkbox" checked={massOk} onChange={(e) => setMassOk(e.target.checked)} />
          This deletes {composed.massDeletion.removed} of the project&apos;s {composed.massDeletion.total} nodes and edges. Tick to confirm that is meant.
        </label>
      )}
      {composed?.checked.ok && composed.checked.preview.counts.add > 0 && (
        <p className="text-[11px] text-zinc-500">What this adds is marked unconfirmed, with the row it came from, until you confirm it in the Inspector or the Events tab.</p>
      )}
      {composed?.checked.ok && composed.checked.warnings.map((w, i) => <p key={i} className="flex gap-1 text-[11px] text-amber-800 dark:text-amber-300"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{w}</p>)}
      <Problems items={of("warning")} tone="warning" />
      <Problems items={of("note")} tone="note" />
    </div>
  );
}

export default function ImportChangesWindow({ bytes, read, onClose }: { bytes: Uint8Array; read: ReadImport; onClose: () => void }) {
  return (
    <FloatingWindow
      open
      onClose={onClose}
      title="Import changes"
      icon={<FileSpreadsheet size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
      storageKey="cascade.import-changes.window"
      defaultSize={{ w: 860, h: 620 }}
      minSize={{ w: 560, h: 380 }}
    >
      {/* A new file is a new panel: its ticks and preview start over. */}
      <ImportChangesPanel key={`${read.file}-${bytes.length}`} bytes={bytes} initial={read} />
    </FloatingWindow>
  );
}
