"use client";

/**
 * ModelTextControl — the Action Bar's "Text" button and the Model text window
 * (ADR-0022): everything the project and its configuration save, as a tree of
 * sections, each editable as JSON.
 *
 * Left, the tree (`lib/model-text-sections.ts`): Project (info, Canvases,
 * Nodes and Edges by Canvas, Scorecard, Temporal Simulations), Configuration
 * (Events, Categories, Functionality scale, the rest), and Bulk operations, a
 * hand-written change set. Any level opens on its current JSON: a group is a
 * bulk edit of everything under it, a leaf one item. Right, the JSON.
 *
 * Nothing changes until the person has read the preview and confirmed it:
 * Check turns the edited section into patch operations and runs every stage
 * of `lib/model-text.ts` on a copy; the preview lists each change as before →
 * after; Apply re-checks against the live model and writes it
 * (`lib/model-text-apply.ts`), keeping a version first so Undo this edit can
 * put the model back. The text is only data: parsed as JSON and shown as text,
 * never run and never rendered as HTML.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Bot, Braces, Check, ChevronRight, ClipboardCopy, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { SmallButton } from "@/components/temporal/fields";
import { MODEL_TEXT_ANCHOR_ID } from "@/lib/ui-anchors";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useUiStore } from "@/store/ui-store";
import { MODEL_TEXT_FORMAT, MODEL_TEXT_REFERENCE, STARTER_TEXT, checkChange, modelTextContext, parseChangeText, parseJsonText, type CheckedChange, type Preview } from "@/lib/model-text";
import { BULK_KEY, findSection, sectionPatch, sectionTree, sectionValue, type Section } from "@/lib/model-text-sections";
import { applyModelBundle, currentBundle, restoreModelBundle } from "@/lib/model-text-apply";
import type { ProjectBundle } from "@/lib/file-io";

type Result =
  | { kind: "errors"; errors: string[] }
  | { kind: "preview"; preview: Preview; warnings: string[] }
  | { kind: "applied"; preview: Preview; before: ProjectBundle };

/** Lines shown before "… N more": a preview of thousands of rows helps nobody read it. */
const PREVIEW_LINES = 400;
/** Tree rows shown per list before "… N more" (the filter finds the rest). */
const TREE_ROWS = 200;
/** A section this long is slow to edit in a text box; say so and suggest a smaller one. */
const LARGE_CHARS = 300_000;

const TONE = {
  add: "text-green-700 dark:text-green-400",
  remove: "text-red-700 dark:text-red-400",
  change: "text-zinc-700 dark:text-zinc-300",
} as const;
const MARK = { add: "+", remove: "−", change: "~" } as const;

function PreviewList({ preview }: { preview: Preview }) {
  const { counts, lines } = preview;
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-zinc-200 p-2 font-mono text-[11px] leading-4 dark:border-zinc-700">
      <p className="mb-1 font-sans font-medium text-zinc-700 dark:text-zinc-200">
        {counts.add} added · {counts.change} changed · {counts.remove} removed
      </p>
      {lines.slice(0, PREVIEW_LINES).map((l, i) => (
        <p key={i} className={cn("break-all", TONE[l.kind])}>
          {MARK[l.kind]} {l.where}
          {l.kind === "change" && <span className="text-zinc-500">: {l.before} → {l.after}</span>}
          {l.kind !== "change" && (l.after ?? l.before) !== undefined && <span className="text-zinc-500">: {l.after ?? l.before}</span>}
        </p>
      ))}
      {lines.length > PREVIEW_LINES && <p className="text-zinc-400">… {lines.length - PREVIEW_LINES} more</p>}
    </div>
  );
}

/** The bundle as the stores hold it now; rebuilt when any saved part changes. */
function useBundle(): ProjectBundle {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const canvases = useCanvasStore((s) => s.canvases);
  const canvasOrder = useCanvasStore((s) => s.canvasOrder);
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const config = useConfigStore((s) => s.config);
  const scorecard = useScorecardStore((s) => s.scorecard);
  const simulations = useTemporalSimulationStore((s) => s.simulations);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the slices are the inputs; currentBundle reads them from the stores
  return useMemo(() => currentBundle(), [nodes, edges, canvases, canvasOrder, projectMeta, config, scorecard, simulations]);
}

function TreeRow({ section, depth, selected, open, onSelect, onToggle }: {
  section: Section;
  depth: number;
  selected: string;
  open: ReadonlySet<string>;
  onSelect: (s: Section) => void;
  onToggle: (key: string) => void;
}) {
  const expanded = open.has(section.key);
  const children = section.children ?? [];
  return (
    <>
      <div
        className={cn(
          "flex items-center gap-0.5 rounded px-1 py-0.5 text-xs",
          selected === section.key ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800",
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {children.length > 0 ? (
          <button type="button" aria-label={expanded ? "Collapse" : "Expand"} onClick={() => onToggle(section.key)} className="text-zinc-400">
            <ChevronRight size={12} className={cn("transition-transform", expanded && "rotate-90")} />
          </button>
        ) : <span className="w-3" />}
        <button type="button" onClick={() => onSelect(section)} className="min-w-0 flex-1 truncate text-left">
          {section.label}
          {section.count !== undefined && <span className="ml-1 text-zinc-400">({section.count})</span>}
        </button>
      </div>
      {expanded && children.slice(0, TREE_ROWS).map((c) => (
        <TreeRow key={c.key} section={c} depth={depth + 1} selected={selected} open={open} onSelect={onSelect} onToggle={onToggle} />
      ))}
      {expanded && children.length > TREE_ROWS && (
        <p className="py-0.5 text-[11px] text-zinc-400" style={{ paddingLeft: (depth + 1) * 12 + 20 }}>… {children.length - TREE_ROWS} more — use the filter</p>
      )}
    </>
  );
}

const flatten = (tree: readonly Section[]): Section[] => tree.flatMap((s) => [s, ...flatten(s.children ?? [])]);

function ModelTextPanel() {
  const bundle = useBundle();
  const tree = useMemo(() => sectionTree(bundle), [bundle]);
  const [selectedKey, setSelectedKey] = useState("/config/events");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(["/project", "/config"]));
  const [filter, setFilter] = useState("");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [showRef, setShowRef] = useState(false);
  const running = useTemporalSimulationStore((s) => s.running);
  const pushToast = useUiStore((s) => s.pushToast);

  const section = findSection(tree, selectedKey) ?? tree[1];
  const bulk = section.key === BULK_KEY;
  const currentText = useMemo(() => (bulk ? STARTER_TEXT : JSON.stringify(sectionValue(bundle, section), null, 2) ?? ""), [bulk, bundle, section]);
  // An edited section keeps its text until it is applied or reverted; an untouched one follows the model.
  const text = texts[section.key] ?? currentText;
  const dirty = text !== currentText;
  const dropText = (key: string) => setTexts((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== key)));
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? flatten(tree).filter((s) => s.label.toLowerCase().includes(q)).slice(0, TREE_ROWS) : null;
  }, [filter, tree]);

  function select(s: Section) {
    setSelectedKey(s.key);
    if (result?.kind !== "applied") setResult(null);
  }

  async function copy(content: string, what: string) {
    try {
      await navigator.clipboard.writeText(content);
      pushToast({ message: `Copied ${what}.`, variant: "success", durationMs: 2000 });
    } catch {
      pushToast({ message: "The clipboard is blocked; select the text instead.", variant: "warning", durationMs: 3000 });
    }
  }

  /** The edited text checked against the live model: the section's patch, or the bulk change set. */
  function checked(): CheckedChange {
    const live = currentBundle();
    if (bulk) {
      const parsed = parseChangeText(text);
      return parsed.ok ? checkChange(live, parsed.change) : parsed;
    }
    const json = parseJsonText(text);
    if (!json.ok) return json;
    const s = findSection(sectionTree(live), section.key);
    if (!s) return { ok: false, errors: [`${section.label} is no longer in the model.`] };
    const patch = sectionPatch(live, s, json.value);
    if ("error" in patch) return { ok: false, errors: [patch.error] };
    return checkChange(live, { format: MODEL_TEXT_FORMAT, patch: patch.patch, elements: [] });
  }

  function check() {
    const r = checked();
    setResult(r.ok ? { kind: "preview", preview: r.preview, warnings: r.warnings } : { kind: "errors", errors: r.errors });
  }

  function apply() {
    // Checked again on the model as it is now: it may have changed since the preview.
    const r = checked();
    if (!r.ok) { setResult({ kind: "errors", errors: r.errors }); return; }
    const before = applyModelBundle(r.after);
    if (!before) return;
    dropText(section.key);
    setResult({ kind: "applied", preview: r.preview, before });
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
  const llmContext = () => modelTextContext(currentBundle(), bulk ? undefined : { label: section.label, json: text, pointer: section.pointer, registry: section.registry, onCanvas: section.canvasIndex !== undefined });

  return (
    <div className="flex h-full min-h-0 flex-1">
      <nav className="flex w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <input
          aria-label="Filter sections"
          placeholder="Filter: a node, an Event…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="m-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {matches
            ? matches.map((s) => <TreeRow key={s.key} section={{ ...s, children: undefined }} depth={0} selected={section.key} open={open} onSelect={select} onToggle={() => {}} />)
            : tree.map((s) => (
              <TreeRow
                key={s.key}
                section={s}
                depth={0}
                selected={section.key}
                open={open}
                onSelect={select}
                onToggle={(key) => setOpen((o) => { const next = new Set(o); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
              />
            ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">{section.label}</span>
          {!bulk && <code className="truncate text-[10px] text-zinc-400">{section.pointer}</code>}
          <span className="flex-1" />
          <SmallButton onClick={() => void copy(text, section.label)}><ClipboardCopy size={11} /> Copy</SmallButton>
          <SmallButton onClick={() => void copy(llmContext(), "the section with context for an LLM")} title="This section, the format and the model's ids and names, to paste into an LLM with your request">
            <Bot size={11} /> Copy with context for an LLM
          </SmallButton>
          <SmallButton disabled={!dirty} onClick={() => { dropText(section.key); setResult(null); }}><RotateCcw size={11} /> Revert</SmallButton>
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
          onChange={(e) => { setTexts((m) => ({ ...m, [section.key]: e.target.value })); if (result?.kind !== "applied") setResult(null); }}
          className="min-h-[160px] flex-1 resize-none rounded-md border border-zinc-200 bg-white p-2 font-mono text-[11px] leading-4 text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
        />
        <p className="text-[11px] text-zinc-400">
          {bulk
            ? <>A change set: <code>patch</code> (add, replace, remove at a path under /project or /config) and <code>elements</code> (Attribute Operations on Elements by id or filter).</>
            : section.registry
              ? "Edit, add or delete entries. Deleting a node also deletes its edges and takes it off every Canvas; a node added under a Canvas is placed on it."
              : "Edit the JSON as it is, or paste an LLM's version of it."}
          {" "}{dirty ? "Edited — check it to see the changes." : "Shows the model as it is."} Nothing changes until you confirm the preview.
          {text.length > LARGE_CHARS && " This section is large: a smaller one (a Canvas's Nodes, one node) is quicker to edit."}
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

        {bulk && (
          <>
            <button type="button" className="self-start text-[11px] text-blue-700 hover:underline dark:text-blue-400" onClick={() => setShowRef((v) => !v)}>
              {showRef ? "Hide" : "Show"} format reference
            </button>
            {showRef && <pre className="max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] leading-4 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{MODEL_TEXT_REFERENCE}</pre>}
          </>
        )}
      </div>
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
        title="Model text: everything the project and its configuration save, section by section, as JSON (checked and previewed before it applies)"
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
        defaultSize={{ w: 980, h: 660 }}
        minSize={{ w: 640, h: 400 }}
      >
        <ModelTextPanel />
      </FloatingWindow>
    </>
  );
}
