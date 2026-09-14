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
 * What replaced them are the walkthroughs, offered by name at the top of the
 * screen: the guided tour (run a finished model), Build a model (author one),
 * Customize the Propagation (steer the engine), and Analyse and decide (read
 * the result). Each is listed by name only — what a tour teaches is its own
 * first card, and repeating it here is a second place to go stale. See
 * lib/tour/.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Compass, Upload, FlaskConical, Hammer, SlidersHorizontal, BarChart2 } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl dark:bg-zinc-900">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">New project</h2>
        </div>

        <div className="mb-8">
          <StartScreen
            data={data}
            onChange={patch}
            onLoadFile={handleLoadFile}
            onLoadSample={handleLoadSample}
            onStartTour={handleStartTour}
            loadError={loadError}
          />
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={onCancel}
            className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={createProject}
            disabled={data.name.trim().length === 0}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
              data.name.trim().length > 0
                ? "bg-blue-600 hover:bg-blue-700"
                : "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700",
            )}
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StartScreen — the whole wizard
// ---------------------------------------------------------------------------

function StartScreen({
  data,
  onChange,
  onLoadFile,
  onLoadSample,
  onStartTour,
  loadError,
}: {
  data: WizardData;
  onChange: (p: Partial<WizardData>) => void;
  onLoadFile: (file: File) => Promise<void>;
  onLoadSample: (sample: SampleManifestEntry) => Promise<void>;
  onStartTour: (id: TourId) => void;
  loadError: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [samples, setSamples] = useState<SampleManifestEntry[]>([]);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);

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
    <div className="space-y-4">
      {/* The walkthroughs, names only, straight from the registry. What each
          teaches is the tour's own first card — a copy here is a second place
          to go stale. */}
      <div className="space-y-1">
        {TOUR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onStartTour(id)}
            className="flex w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-medium text-blue-900 hover:border-blue-300 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30"
          >
            <span className="shrink-0 text-blue-600 dark:text-blue-400">{TOUR_ICON[id]}</span>
            {TOURS[id].label}
          </button>
        ))}
      </div>

      {/* Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Project name <span className="text-red-500">*</span>
        </label>
        <input
          autoFocus
          type="text"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Palmanova Infrastructure"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Description
          <span className="ml-1 font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          rows={2}
          value={data.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Brief description of this project…"
          className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        <span className="text-xs text-zinc-400">or load an existing project</span>
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 transition-colors",
          dragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
            : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50",
        )}
      >
        <Upload size={20} className="text-zinc-400" />
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Drop a project file here, or <span className="text-blue-600 dark:text-blue-400">click to browse</span>
        </p>
        <p className="text-xs text-zinc-400">
          Accepts <code className="font-mono">.json</code> — bundle (project + config) or project file. Opens immediately.
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          ✗ {loadError}
        </p>
      )}

      {samples.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400">or start from a sample</span>
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
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
                className="flex w-full items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-blue-900/20"
              >
                <FlaskConical size={14} className="mt-0.5 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {s.label}
                    {loadingSample === s.id && " — loading…"}
                  </span>
                  <span className="block truncate text-xs text-zinc-400">
                    {s.description} · {s.sizeLabel}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

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
    </div>
  );
}
