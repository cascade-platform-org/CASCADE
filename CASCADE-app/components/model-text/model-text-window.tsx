"use client";

/**
 * ModelTextControl — the Topbar's "LLM Design" button (beside Help) and its window
 * (ADR-0022): everything the project and its configuration save, as a tree of
 * sections, each editable as JSON.
 *
 * Left, the Recipes (`lib/llm-recipes.ts`: one job each, copied for an LLM
 * with the model's context) and the tree (`lib/model-text-sections.ts`):
 * Project (info, Canvases, Nodes and Edges by Canvas, Scorecard, Temporal
 * Simulations), Configuration (Events, Categories, Functionality scale, the
 * rest), and Bulk operations, plain changes. Any level opens on its current
 * JSON: a group is a bulk edit of everything under it, a leaf one item.
 * Other surfaces open it on a section, a Recipe, a selection or a pasted reply
 * through the UI store's `openLlmDesign`.
 *
 * Nothing changes until the person has read the preview and confirmed it:
 * Check turns the edited section into patch operations and runs every stage
 * of `lib/model-text.ts` on a copy; the preview lists each change as before →
 * after, and for Bulk operations each change can be left out; Apply re-checks
 * against the live model and writes it, what it added marked unconfirmed
 * (`lib/model-text-apply.ts`), keeping a version first so Undo this edit can
 * put the model back. The text is only data: parsed as JSON and shown as text,
 * never run and never rendered as HTML.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Braces, Check, ChevronRight, ClipboardCopy, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { SmallButton } from "@/components/temporal/fields";
import { MODEL_TEXT_ANCHOR_ID } from "@/lib/ui-anchors";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useUiStore, type LlmDesignRequest } from "@/store/ui-store";
import { modelTextContext, type Preview } from "@/lib/model-text";
import { PLAIN_REFERENCE, bulkContext, repairContext, starterPlain, type BulkResult, type PreviewGroup } from "@/lib/model-text-v2";
import { BULK_KEY, findSection, flattenSections, sectionAncestors, sectionTree, sectionValue, type Section } from "@/lib/model-text-sections";
import { checkDesignText } from "@/lib/llm-design-check";
import { RECIPES, findRecipe, focusContext, recipeContext, type Focus, type RecipeId } from "@/lib/llm-recipes";
import { copyText as copyPlain, useLlmCopy } from "./llm-copy";
import { applyModelBundle, currentBundle, restoreModelBundle } from "@/lib/model-text-apply";
import type { ProjectBundle } from "@/lib/file-io";

/** A checked change's preview, grouped by change for Bulk operations, with the LLM's notes. */
type Shown = { preview: Preview; groups?: PreviewGroup[]; notes?: string };

type Result =
  | { kind: "errors"; errors: string[] }
  | ({ kind: "preview"; warnings: string[] } & Shown)
  | ({ kind: "applied"; before: ProjectBundle } & Shown);

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

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

function Lines({ lines }: { lines: Preview["lines"] }) {
  return (
    <>
      {lines.slice(0, PREVIEW_LINES).map((l, i) => (
        <p key={i} className={cn("break-all", TONE[l.kind])}>
          {MARK[l.kind]} {l.where}
          {l.kind === "change" && <span className="text-zinc-500">: {l.before} → {l.after}</span>}
          {l.kind !== "change" && (l.after ?? l.before) !== undefined && <span className="text-zinc-500">: {l.after ?? l.before}</span>}
        </p>
      ))}
      {lines.length > PREVIEW_LINES && <p className="text-zinc-400">… {lines.length - PREVIEW_LINES} more</p>}
    </>
  );
}

/**
 * Every change as before → after; for Bulk operations, under the change that
 * made it, with what it skipped, and a tick to leave the change out.
 */
function PreviewList({ preview, groups, notes, leaveOut, onToggle }: Shown & { leaveOut?: ReadonlySet<number>; onToggle?: (index: number) => void }) {
  const { counts } = preview;
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 p-2 font-mono text-[11px] leading-4 dark:border-zinc-700">
      {notes && <p className="mb-1 font-sans italic text-zinc-600 dark:text-zinc-300">“{notes}”</p>}
      <p className="mb-1 font-sans font-medium text-zinc-700 dark:text-zinc-200">
        {counts.add} added · {counts.change} changed · {counts.remove} removed
      </p>
      {groups
        ? groups.map((g, i) => (
          <div key={i} className="mb-1.5">
            <p className={cn("font-sans font-medium", g.left_out ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100")}>
              {onToggle && g.index !== undefined && (
                <input
                  type="checkbox"
                  aria-label={`Include: ${g.title}`}
                  checked={!leaveOut?.has(g.index)}
                  onChange={() => onToggle(g.index!)}
                  className="mr-1 align-middle"
                />
              )}
              {g.subjects.length || g.lines.length ? (CIRCLED[i] ?? `${i + 1}.`) : "·"} {g.title}
              {g.why && <span className="font-normal text-zinc-500"> — {g.why}</span>}
              {g.left_out && <span className="ml-1 font-normal no-underline"> (left out)</span>}
            </p>
            {g.skipped.length > 0 && (
              <p className="font-sans text-amber-800 dark:text-amber-300">
                Skipped: {g.skipped.slice(0, 8).map((x) => `${x.id} (${x.reason})`).join("; ")}{g.skipped.length > 8 ? ` … ${g.skipped.length - 8} more` : ""}
              </p>
            )}
            <div className="pl-3"><Lines lines={g.lines} /></div>
          </div>
        ))
        : <Lines lines={preview.lines} />}
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

/** One row of the tree and, when expanded, its children. Memoised: typing in the text re-renders none of them. */
const TreeRow = memo(function Row({ section, depth, selected, open, onSelect, onToggle }: {
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
});

/** `set` with `x` added, or removed when it was there. */
function toggled<T>(set: ReadonlySet<T>, x: T): Set<T> {
  const next = new Set(set);
  if (next.has(x)) next.delete(x);
  else next.add(x);
  return next;
}

const RECIPE_PREFIX = "recipe:";

/** What a request opens: the selected key, and the pasted text for Bulk operations. */
function landing(tree: readonly Section[], request: LlmDesignRequest): { key: string; text?: string } {
  if (request.recipe) return { key: `${RECIPE_PREFIX}${request.recipe}` };
  if (request.pointer) {
    const all = flattenSections(tree).filter((s) => s.pointer === request.pointer);
    const hit = all.find((s) => s.mode === "value") ?? all[0];
    if (hit) return { key: hit.key };
  }
  return { key: BULK_KEY, text: request.text };
}

/** A Recipe: what it is for, the person's text, and the copy for an LLM. */
function RecipePanel({ id, input, onInput, focus, onClearFocus, onCopy, onReply }: {
  id: RecipeId;
  input: string;
  onInput: (text: string) => void;
  focus: Focus | null;
  onClearFocus: () => void;
  onCopy: () => void;
  onReply: () => void;
}) {
  const recipe = findRecipe(id);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{recipe.label}</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-300">{recipe.blurb}</p>
      {focus && <FocusChip focus={focus} onClear={onClearFocus} />}
      <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300" htmlFor="recipe-input">{recipe.input.label}</label>
      <textarea
        id="recipe-input"
        value={input}
        placeholder={recipe.input.placeholder}
        onChange={(e) => onInput(e.target.value)}
        className="min-h-[120px] flex-1 resize-none rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
      />
      <ol className="list-decimal space-y-0.5 pl-5 text-[11px] text-zinc-600 dark:text-zinc-300">
        <li>Copy for the LLM: the instructions, your text and the model.</li>
        <li>Paste it into your LLM{recipe.reply === "changes" ? " and answer its questions." : "."}</li>
        <li>{recipe.reply === "changes" ? "Paste its reply into Bulk operations, check it and choose what to apply." : "Read its answer there: nothing comes back here."}</li>
      </ol>
      <div className="flex gap-2">
        <SmallButton tone="accent" onClick={onCopy}><Bot size={11} /> Copy for the LLM</SmallButton>
        {recipe.reply === "changes" && <SmallButton onClick={onReply}><ArrowRight size={11} /> Paste the reply in Bulk operations</SmallButton>}
      </div>
    </div>
  );
}

function FocusChip({ focus, onClear }: { focus: Focus; onClear: () => void }) {
  const n = focus.nodeIds.length + focus.edgeIds.length;
  return (
    <p className="flex items-center gap-1 self-start rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
      About the {n} selected Element{n === 1 ? "" : "s"}: the copy includes them as stored.
      <button type="button" aria-label="Forget the selection" onClick={onClear}><X size={11} /></button>
    </p>
  );
}

function ModelTextPanel() {
  const bundle = useBundle();
  const tree = useMemo(() => sectionTree(bundle), [bundle]);
  const request = useUiStore((s) => s.llmDesignRequest);
  // An empty model starts on the Recipe that builds one.
  const [selectedKey, setSelectedKey] = useState(() => (Object.keys(bundle.project.nodes).length ? BULK_KEY : `${RECIPE_PREFIX}describe`));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(["/project", "/config"]));
  const [filter, setFilter] = useState("");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<Focus | null>(null);
  const [recipeInputs, setRecipeInputs] = useState<Partial<Record<RecipeId, string>>>({});
  const [leaveOut, setLeaveOut] = useState<ReadonlySet<number>>(new Set());
  const [result, setResult] = useState<Result | null>(null);
  // -1 never matches: the request that opened the window is handled below like any later one.
  const [seen, setSeen] = useState(-1);
  const [showRef, setShowRef] = useState(false);
  const running = useTemporalSimulationStore((s) => s.running);
  const pushToast = useUiStore((s) => s.pushToast);
  const { copyForLlm, notice } = useLlmCopy();

  // A request (a section, a selection, a pasted reply): adjust during render, React's pattern for state that follows a prop.
  if (request && request.nonce !== seen) {
    setSeen(request.nonce);
    const to = landing(tree, request);
    setSelectedKey(to.key);
    setOpen((o) => new Set([...o, ...(sectionAncestors(tree, to.key) ?? [])]));
    setFocus(request.focus ?? null);
    setLeaveOut(new Set());
    if (to.text !== undefined) {
      setTexts((m) => ({ ...m, [BULK_KEY]: to.text! }));
      setResult(toResult(checkDesignText(currentBundle(), { bulk: true }, to.text)));
    } else setResult(null);
  }

  const recipeId = selectedKey.startsWith(RECIPE_PREFIX) ? (selectedKey.slice(RECIPE_PREFIX.length) as RecipeId) : null;
  const section = useMemo(() => findSection(tree, selectedKey) ?? findSection(tree, BULK_KEY)!, [tree, selectedKey]);
  const bulk = section.key === BULK_KEY;
  const currentText = useMemo(() => (bulk ? starterPlain(bundle) : JSON.stringify(sectionValue(bundle, section), null, 2) ?? ""), [bulk, bundle, section]);
  // An edited section keeps its text until it is applied or reverted; an untouched one follows the model.
  const text = texts[section.key] ?? currentText;
  const dirty = text !== currentText;
  const dropText = (key: string) => setTexts((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== key)));
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? flattenSections(tree).filter((s) => s.label.toLowerCase().includes(q)).slice(0, TREE_ROWS) : null;
  }, [filter, tree]);
  const focusText = () => (focus ? focusContext(currentBundle(), focus) : undefined);

  /** Forget the preview and the changes left out; an applied result stays, for its Undo this edit. */
  const resetPreview = useCallback(() => {
    setLeaveOut(new Set());
    setResult((r) => (r?.kind === "applied" ? r : null));
  }, []);

  const select = useCallback((key: string) => {
    setSelectedKey(key);
    resetPreview();
  }, [resetPreview]);
  const selectRow = useCallback((s: Section) => select(s.key), [select]);
  const toggleRow = useCallback((key: string) => setOpen((o) => toggled(o, key)), []);

  /** The edited text checked against the live model, with the changes left out of Bulk operations. */
  const checked = (out: ReadonlySet<number> = leaveOut): BulkResult =>
    checkDesignText(currentBundle(), bulk ? { bulk: true, leaveOut: out } : { bulk: false, sectionKey: section.key, label: section.label }, text);

  function check() {
    setResult(toResult(checked()));
  }

  function toggle(index: number) {
    const next = toggled(leaveOut, index);
    setLeaveOut(next);
    setResult(toResult(checked(next)));
  }

  function apply() {
    // Checked again on the model as it is now: it may have changed since the preview.
    const { checked: r, groups, notes } = checked();
    if (!r.ok) { setResult({ kind: "errors", errors: r.errors }); return; }
    const before = applyModelBundle(r.after);
    if (!before) return;
    dropText(section.key);
    setLeaveOut(new Set());
    setResult({ kind: "applied", preview: r.preview, groups, notes, before });
    pushToast({ message: "LLM Design applied. A version was kept; Undo this edit puts it back.", variant: "success", durationMs: 4000 });
  }

  function undo() {
    if (result?.kind !== "applied") return;
    if (!window.confirm("Put the project and its configuration back as they were before this edit? Changes made since are lost.")) return;
    if (restoreModelBundle(result.before)) {
      setResult(null);
      pushToast({ message: "LLM Design edit undone.", variant: "info", durationMs: 3000 });
    }
  }

  const changes = result?.kind === "preview" ? result.preview.lines.length : 0;
  const added = result?.kind === "preview" ? result.preview.counts.add : 0;
  const llmContext = () => (bulk
    ? bulkContext(currentBundle(), focusText())
    : modelTextContext(currentBundle(), { label: section.label, json: text, pointer: section.pointer, registry: section.registry, onCanvas: section.canvasIndex !== undefined }));

  return (
    <div className="flex h-full min-h-0 flex-1">
      {notice}
      <nav className="flex w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <p className="mx-3 mt-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"><Sparkles size={11} /> Recipes</p>
        <div className="px-1">
          {RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              title={r.blurb}
              onClick={() => select(`${RECIPE_PREFIX}${r.id}`)}
              className={cn(
                "block w-full truncate rounded px-2 py-0.5 text-left text-xs",
                recipeId === r.id ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <input
          aria-label="Filter sections"
          placeholder="Filter: a node, an Event…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="m-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {matches
            ? matches.map((s) => <TreeRow key={s.key} section={{ ...s, children: undefined }} depth={0} selected={recipeId ? "" : section.key} open={open} onSelect={selectRow} onToggle={toggleRow} />)
            : tree.map((s) => (
              <TreeRow
                key={s.key}
                section={s}
                depth={0}
                selected={recipeId ? "" : section.key}
                open={open}
                onSelect={selectRow}
                onToggle={toggleRow}
              />
            ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <p className="rounded-md bg-blue-50 px-2 py-1.5 text-[11px] leading-4 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">{USAGE}</p>
        {recipeId ? (
          <RecipePanel
            id={recipeId}
            input={recipeInputs[recipeId] ?? ""}
            onInput={(t) => setRecipeInputs((m) => ({ ...m, [recipeId]: t }))}
            focus={focus}
            onClearFocus={() => setFocus(null)}
            onCopy={() => copyForLlm(
              () => recipeContext(recipeId, currentBundle(), { input: recipeInputs[recipeId], focus: focusText(), analysis: useAnalysisStore.getState().result }),
              `"${findRecipe(recipeId).label}" for the LLM`,
            )}
            onReply={() => { setTexts((m) => ({ ...m, [BULK_KEY]: "" })); select(BULK_KEY); }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">{section.label}</span>
              {!bulk && <code className="truncate text-[10px] text-zinc-400">{section.pointer}</code>}
              <span className="flex-1" />
              <SmallButton onClick={() => void copyPlain(text, section.label)}><ClipboardCopy size={11} /> Copy</SmallButton>
              <SmallButton onClick={() => copyForLlm(llmContext, "the section with context for an LLM")} title="This section, the format and the model's ids and names, to paste into an LLM with your request">
                <Bot size={11} /> Copy with context for an LLM
              </SmallButton>
              <SmallButton disabled={!dirty} onClick={() => { dropText(section.key); resetPreview(); }}><RotateCcw size={11} /> Revert</SmallButton>
              <SmallButton onClick={check}><Check size={11} /> Check &amp; preview</SmallButton>
              <span data-run-locked>
                <SmallButton tone="accent" disabled={result?.kind !== "preview" || changes === 0 || running} onClick={apply} title="Write the previewed changes; a version of the whole project is kept first">
                  <Upload size={11} /> Apply {changes > 0 ? `${changes} change${changes > 1 ? "s" : ""}` : ""}
                </SmallButton>
              </span>
            </div>
            {bulk && focus && <FocusChip focus={focus} onClear={() => setFocus(null)} />}

            <textarea
              spellCheck={false}
              value={text}
              placeholder={bulk ? "Paste the LLM's reply here, then Check & preview." : undefined}
              onChange={(e) => { setTexts((m) => ({ ...m, [section.key]: e.target.value })); resetPreview(); }}
              className="min-h-[160px] flex-1 resize-none rounded-md border border-zinc-200 bg-white p-2 font-mono text-[11px] leading-4 text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            />
            <p className="text-[11px] text-zinc-400">
              {bulk
                ? <>Changes by rule, for many Elements at once: <code>{"{ \"scale\": \"supply\", \"by\": 0.5, \"where\": { \"node_type\": \"Source\" } }"}</code>, and things added, updated or deleted by id. The example below uses this model.</>
                : section.registry
                  ? "Edit, add or delete entries. Deleting a node also deletes its edges and takes it off every Canvas; a node added under a Canvas is placed on it."
                  : "Edit the JSON as it is, or paste an LLM's version of it."}
              {" "}{dirty ? "Edited — check it to see the changes." : "Shows the model as it is."} Nothing changes until you confirm the preview.
              {text.length > LARGE_CHARS && " This section is large: a smaller one (a Canvas's Nodes, one node) is quicker to edit."}
            </p>

            {result?.kind === "errors" && (
              <div role="alert" className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                <div className="mb-1 flex items-center gap-2">
                  <p className="font-medium">Not applied — {result.errors.length} problem{result.errors.length > 1 ? "s" : ""}:</p>
                  <span className="flex-1" />
                  <SmallButton onClick={() => copyForLlm(() => repairContext(currentBundle(), text, result.errors, bulk ? undefined : section.label), "the problems for the LLM")} title="The problems, your text and the stored JSON of the Elements they name, for the LLM to fix">
                    <Bot size={11} /> Copy the problems for the LLM
                  </SmallButton>
                </div>
                {result.errors.slice(0, 50).map((e, i) => <p key={i} className="break-all">• {e}</p>)}
              </div>
            )}
            {result?.kind === "preview" && (
              <>
                {changes === 0
                  ? <p className="text-[11px] text-zinc-500">Valid, and it changes nothing{leaveOut.size ? " with the changes left out" : ""}.</p>
                  : null}
                {(changes > 0 || leaveOut.size > 0) && (
                  <PreviewList preview={result.preview} groups={result.groups} notes={result.notes} leaveOut={leaveOut} onToggle={result.groups && result.groups.filter((g) => g.index !== undefined).length > 1 ? toggle : undefined} />
                )}
                {added > 0 && <p className="text-[11px] text-zinc-500">What this adds is marked unconfirmed, with its why, until you confirm it in the Inspector or the Events tab.</p>}
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
                <PreviewList preview={result.preview} groups={result.groups} notes={result.notes} />
              </div>
            )}

            {bulk && (
              <>
                <button type="button" className="self-start text-[11px] text-blue-700 hover:underline dark:text-blue-400" onClick={() => setShowRef((v) => !v)}>
                  {showRef ? "Hide" : "Show"} format reference
                </button>
                {showRef && <pre className="max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] leading-4 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{PLAIN_REFERENCE}</pre>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A check's outcome as the window shows it. */
function toResult({ checked: r, groups, notes }: BulkResult): Result {
  return r.ok ? { kind: "preview", preview: r.preview, warnings: r.warnings, groups, notes } : { kind: "errors", errors: r.errors };
}

/** What the window is for, in the Topbar button's tooltip and atop the window. */
const USAGE =
  "Design the model with an LLM. Start from a Recipe (describe your organisation, paste its data, red-team its Events), " +
  "or pick a part and Copy with context for an LLM; paste the LLM's reply back and Check & preview. " +
  "Nothing changes until you Apply, and Undo this edit puts it back.";

export function ModelTextControl({ buttonClassName }: { buttonClassName: string }) {
  const open = useUiStore((s) => s.llmDesignOpen);
  const toggle = useUiStore((s) => s.toggleLlmDesign);
  const close = useUiStore((s) => s.closeLlmDesign);
  return (
    <>
      <button
        id={MODEL_TEXT_ANCHOR_ID}
        type="button"
        onClick={toggle}
        title={USAGE}
        className={buttonClassName}
      >
        <Braces size={15} />
        <span className="hidden text-xs sm:inline">LLM Design</span>
      </button>
      <FloatingWindow
        open={open}
        onClose={close}
        title="LLM Design"
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
