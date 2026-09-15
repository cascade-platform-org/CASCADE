"use client";

/**
 * NewProjectWizard — one screen: name a project, or start from something.
 *
 * It used to be four steps. The other three asked for things that were either
 * already answered or freely changeable a second later: a bundle dropped on
 * step 1 carries its own Model Configuration, so step 2's config picker only
 * mattered for a config-only JSON the File panel also loads; every field in
 * step 3 (Canvas name, colour, graph type, geo toggle) lives in the
 * Inspector's Canvas Meta panel, and the first two in the Topbar tab menu as
 * well; and step 4 summarised two fields typed ten seconds earlier. None of it
 * was a decision that had to be made before the Canvas existed.
 *
 * The screen is one vertical card, read top to bottom, in the order the three
 * things a person arrives wanting are asked for:
 *
 *   1. **New project** — the name field and the Create button on one row,
 *      because they are a single action. They were three sections apart, the
 *      button stranded in a footer below the samples list, which made the
 *      primary path the hardest one to find. Description is folded behind a
 *      toggle: it is optional, and an optional field costs the same attention
 *      as a required one for as long as it is on screen.
 *   2. **Platform Tutorials** — the four walkthroughs as a two-column grid,
 *      listed by name only. What a tour teaches is its own first card, and
 *      repeating it here is a second place to go stale. See lib/tour/.
 *   3. **Open an existing project** — the drop zone and the shipped samples,
 *      last because that is the returning user's path and a returning user
 *      knows what they came for.
 *
 * Each section is announced by one hairline heading rather than boxed, so the
 * card reads as a single sheet instead of three stacked panels.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Compass,
  Upload,
  FlaskConical,
  Hammer,
  SlidersHorizontal,
  BarChart2,
  ArrowRight,
  Plus,
  Minus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { loadBundleFile, loadProjectFile } from "@/lib/file-io";
import { loadSampleManifest, loadSampleBundle, type SampleManifestEntry } from "@/lib/samples";
import { useCanvasStore } from "@/store/canvas-store";
import { startTour } from "@/lib/tour/start-tour";
import { TOURS, TOUR_IDS, type TourId } from "@/lib/tour/registry";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { createEmptyProject } from "@/lib/new-project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardData {
  name: string;
  description: string;
}

const INITIAL_DATA: WizardData = { name: "", description: "" };

/** Icons stay here rather than in the registry, which is UI-free. */
const TOUR_ICON: Record<TourId, ReactNode> = {
  "first-run": <Compass size={14} />,
  "build-model": <Hammer size={14} />,
  customize: <SlidersHorizontal size={14} />,
  platform: <BarChart2 size={14} />,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NewProjectWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NewProjectWizard({ onComplete, onCancel }: NewProjectWizardProps) {
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadConfig = useConfigStore((s) => s.loadConfig);
  const fromProject = useCanvasStore((s) => s.fromProject);

  function patch(partial: Partial<WizardData>) {
    setData((d) => ({ ...d, ...partial }));
  }

  // Load an existing project/bundle file — hydrates stores and skips to editor
  async function handleLoadFile(file: File) {
    setLoadError(null);
    // Try bundle first (project + config), then project-only
    const bundleResult = await loadBundleFile(file);
    if (bundleResult.ok) {
      fromProject(bundleResult.data.project);
      loadConfig(bundleResult.data.config);
      onComplete();
      return;
    }
    const projectResult = await loadProjectFile(file);
    if (projectResult.ok) {
      fromProject(projectResult.data);
      loadConfig(DEFAULT_CONFIG);
      onComplete();
      return;
    }
    setLoadError("Could not load file — make sure it is a valid CASCADE project or bundle JSON.");
  }

  // Load a bundled sample — same effect as loading an uploaded bundle file.
  async function handleLoadSample(sample: SampleManifestEntry) {
    setLoadError(null);
    const bundle = await loadSampleBundle(sample.file);
    if (!bundle) {
      setLoadError(`Could not load sample "${sample.label}".`);
      return;
    }
    fromProject(bundle.project);
    loadConfig(bundle.config);
    onComplete();
  }

  /**
   * Leave the wizard first: a tour rings editor controls that do not exist
   * while this modal is up. No confirmation here — this screen is where a
   * project is being created, so there is nothing of the user's to discard.
   */
  function handleStartTour(id: TourId) {
    onComplete();
    // The build tour starts from empty and takes the name typed above.
    void startTour(id, data.name);
  }

  function createProject() {
    createEmptyProject(data.name, data.description);
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 backdrop-blur-sm">
      {/* items-start + my-auto, not items-center: a flex item centred in a
          scrolling container is clipped at BOTH ends once it is taller than the
          container, and the clipped top cannot be scrolled to. This centres
          while it fits and scrolls from the top when it does not. */}
      <div className="my-auto w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Start a project
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Create a new one, follow a walkthrough, or open an existing file.
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="-mr-1.5 shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={16} />
          </button>
        </header>

        <div className="space-y-6 px-6 py-5">
          <StartScreen
            data={data}
            onChange={patch}
            onCreate={createProject}
            onLoadFile={handleLoadFile}
            onLoadSample={handleLoadSample}
            onStartTour={handleStartTour}
            loadError={loadError}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — one hairline heading, so the card reads as a single sheet
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          {title}
        </h3>
        <div className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" />
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// StartScreen — the whole wizard
// ---------------------------------------------------------------------------

function StartScreen({
  data,
  onChange,
  onCreate,
  onLoadFile,
  onLoadSample,
  onStartTour,
  loadError,
}: {
  data: WizardData;
  onChange: (p: Partial<WizardData>) => void;
  onCreate: () => void;
  onLoadFile: (file: File) => Promise<void>;
  onLoadSample: (sample: SampleManifestEntry) => Promise<void>;
  onStartTour: (id: TourId) => void;
  loadError: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [samples, setSamples] = useState<SampleManifestEntry[]>([]);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);

  const named = data.name.trim().length > 0;

  useEffect(() => {
    void loadSampleManifest().then(setSamples);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onLoadFile(file);
  }

  return (
    <>
      <Section title="New project">
        {/* Name and Create on one row: one action, one line. Enter does what
            the button does, for anyone who never reaches for the mouse. */}
        <div className="flex gap-2">
          <input
            autoFocus
            type="text"
            aria-label="Project name"
            value={data.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && named) onCreate();
            }}
            placeholder="Project name — e.g. Palmanova Infrastructure"
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={onCreate}
            disabled={!named}
            title={named ? "Create the project" : "Name the project first"}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              named
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600",
            )}
          >
            Create
            <ArrowRight size={14} />
          </button>
        </div>

        {describing ? (
          <div className="space-y-1.5">
            <textarea
              autoFocus
              rows={2}
              aria-label="Project description"
              value={data.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="What this project covers…"
              className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => {
                onChange({ description: "" });
                setDescribing(false);
              }}
              className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <Minus size={11} />
              Remove description
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDescribing(true)}
            className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <Plus size={11} />
            Add a description
          </button>
        )}
      </Section>

      <Section title="Platform Tutorials">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TOUR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onStartTour(id)}
              className="group flex items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-900/20"
            >
              <span className="shrink-0 text-zinc-400 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {TOUR_ICON[id]}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
                {TOURS[id].label}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Open an existing project">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors",
            dragging
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-zinc-300 hover:border-blue-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-zinc-800/50",
          )}
        >
          <Upload size={16} className="shrink-0 text-zinc-400" />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Drop a project file, or{" "}
              <span className="text-blue-600 dark:text-blue-400">browse</span>
            </span>
            <span className="block text-[11px] text-zinc-400">
              A <code className="font-mono">.json</code> project or bundle — opens straight away.
            </span>
          </span>
        </div>

        {loadError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {loadError}
          </p>
        )}

        {samples.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-400">or start from a worked example</p>
            <div className="max-h-36 space-y-0.5 overflow-y-auto pr-0.5">
              {samples.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={loadingSample !== null}
                  onClick={async () => {
                    setLoadingSample(s.id);
                    await onLoadSample(s);
                    setLoadingSample(null);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800/60"
                >
                  <FlaskConical size={13} className="mt-0.5 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {s.label}
                      {loadingSample === s.id && " — loading…"}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-400">
                      {s.description} · {s.sizeLabel}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoadFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
