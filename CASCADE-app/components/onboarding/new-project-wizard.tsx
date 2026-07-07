"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, FlaskConical } from "lucide-react";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";
import { ModelConfigurationSchema } from "@/lib/schemas/config";
import { loadBundleFile, loadProjectFile } from "@/lib/file-io";
import { loadSampleManifest, loadSampleBundle, type SampleManifestEntry } from "@/lib/samples";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { Canvas } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4;

interface WizardData {
  // Step 1
  name: string;
  description: string;
  // Step 2
  configSource: "default" | "upload";
  uploadedConfig: ModelConfiguration | null;
  configError: string | null;
  // Step 3
  canvasLabel: string;
  canvasColor: string;
  canvasGraphType: string;
  canvasGeoreferenced: boolean;
}

const INITIAL_DATA: WizardData = {
  name: "",
  description: "",
  configSource: "default",
  uploadedConfig: null,
  configError: null,
  canvasLabel: "Main Network",
  canvasColor: "#3b82f6",
  canvasGraphType: "",
  canvasGeoreferenced: false,
};

const CANVAS_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#ec4899", // pink
];

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
  const [step, setStep] = useState<WizardStep>(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadConfig = useConfigStore((s) => s.loadConfig);
  const fromProject = useCanvasStore((s) => s.fromProject);
  const addCanvas = useCanvasStore((s) => s.addCanvas);

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

  function canAdvance(): boolean {
    if (step === 1) return data.name.trim().length > 0;
    if (step === 2) {
      if (data.configSource === "upload") return data.uploadedConfig !== null && data.configError === null;
      return true;
    }
    if (step === 3) return data.canvasLabel.trim().length > 0;
    return true;
  }

  function advance() {
    if (step < 4) {
      setStep((s) => (s + 1) as WizardStep);
    } else {
      // Hydrate stores
      const config = data.configSource === "upload" && data.uploadedConfig
        ? data.uploadedConfig
        : DEFAULT_CONFIG;

      loadConfig(config);

      const canvas: Canvas = {
        id: `canvas-${nanoid(8)}`,
        label: data.canvasLabel,
        color: data.canvasColor,
        georeferenced: data.canvasGeoreferenced,
        graph: {
          graph_type: data.canvasGraphType || (config.graph_types[0]?.name ?? "default"),
          node_ids: [],
          edge_ids: [],
        },
      };

      fromProject({
        version: "2.0",
        meta: {
          name: data.name,
          description: data.description || undefined,
        },
        nodes: {},
        edges: {},
        canvases: [canvas],
        update_history: [],
        scorecard: [],
      });

      // addCanvas is idempotent — fromProject already sets canvases, but we
      // ensure the canvas-store's canvasOrder is populated
      addCanvas(canvas);

      onComplete();
    }
  }

  function retreat() {
    if (step > 1) setStep((s) => (s - 1) as WizardStep);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl dark:bg-zinc-900">
        <WizardProgress step={step} />
        <WizardHeader step={step} />

        <div className="mb-8 min-h-[200px]">
          {step === 1 && (
            <Step1
              data={data}
              onChange={patch}
              onLoadFile={handleLoadFile}
              onLoadSample={handleLoadSample}
              loadError={loadError}
            />
          )}
          {step === 2 && <Step2 data={data} onChange={patch} />}
          {step === 3 && <Step3 data={data} onChange={patch} config={
            data.configSource === "upload" && data.uploadedConfig
              ? data.uploadedConfig
              : DEFAULT_CONFIG
          } />}
          {step === 4 && <Step4 data={data} />}
        </div>

        <WizardFooter
          step={step}
          canAdvance={canAdvance()}
          onBack={retreat}
          onNext={advance}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function WizardProgress({ step }: { step: WizardStep }) {
  return (
    <div className="mb-6 flex gap-1.5">
      {([1, 2, 3, 4] as WizardStep[]).map((s) => (
        <div
          key={s}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            s <= step ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-700",
          )}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const STEP_META: Record<WizardStep, { title: string; subtitle: string }> = {
  1: {
    title: "Start or load a project",
    subtitle: "Name a new project, or load an existing one from a file.",
  },
  2: {
    title: "Choose a configuration",
    subtitle: "Defines your functionality scale, categories, events, and algorithm pipelines.",
  },
  3: {
    title: "Set up your first canvas",
    subtitle: "A canvas is one layer of your infrastructure network.",
  },
  4: {
    title: "You're ready",
    subtitle: "Your project is set up. You can change everything later.",
  },
};

function WizardHeader({ step }: { step: WizardStep }) {
  const { title, subtitle } = STEP_META[step];
  return (
    <div className="mb-6">
      <p className="mb-0.5 text-xs font-medium uppercase tracking-widest text-zinc-400">
        Step {step} of 4
      </p>
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Name + description
// ---------------------------------------------------------------------------

function Step1({
  data,
  onChange,
  onLoadFile,
  onLoadSample,
  loadError,
}: {
  data: WizardData;
  onChange: (p: Partial<WizardData>) => void;
  onLoadFile: (file: File) => Promise<void>;
  onLoadSample: (sample: SampleManifestEntry) => Promise<void>;
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
          Drop project file here, or <span className="text-blue-600 dark:text-blue-400">click to browse</span>
        </p>
        <p className="text-xs text-zinc-400">
          Accepts <code className="font-mono">.json</code> — bundle (project + config) or project file. Opens immediately, skipping steps 2–4.
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

// ---------------------------------------------------------------------------
// Step 2 — Config source
// ---------------------------------------------------------------------------

function Step2({ data, onChange }: { data: WizardData; onChange: (p: Partial<WizardData>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const result = ModelConfigurationSchema.safeParse(raw);
      if (result.success) {
        onChange({ uploadedConfig: result.data, configError: null, configSource: "upload" });
      } else {
        const msg = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        onChange({ uploadedConfig: null, configError: msg, configSource: "upload" });
      }
    } catch {
      onChange({ uploadedConfig: null, configError: "File is not valid JSON.", configSource: "upload" });
    }
  }

  return (
    <div className="space-y-3">
      {/* Default option */}
      <label className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        data.configSource === "default"
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700",
      )}>
        <input
          type="radio"
          name="configSource"
          value="default"
          checked={data.configSource === "default"}
          onChange={() => onChange({ configSource: "default", configError: null })}
          className="mt-0.5 accent-blue-600"
        />
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Start with default config
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            3-level scale (critical / warning / operational), no categories. Edit everything later in Config ⚙.
          </p>
        </div>
      </label>

      {/* Upload option */}
      <label className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors",
        data.configSource === "upload"
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700",
      )}>
        <input
          type="radio"
          name="configSource"
          value="upload"
          checked={data.configSource === "upload"}
          onChange={() => {
            onChange({ configSource: "upload" });
            fileRef.current?.click();
          }}
          className="mt-0.5 accent-blue-600"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Upload existing config JSON
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Import a previously exported configuration file.
          </p>

          {data.configSource === "upload" && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-xs font-medium text-blue-600 hover:underline"
            >
              {data.uploadedConfig ? "Replace file…" : "Choose file…"}
            </button>
          )}

          {data.uploadedConfig && !data.configError && (
            <p className="mt-1 text-xs text-green-600">
              ✓ Config loaded — {data.uploadedConfig.functionality_scale.length} levels,{" "}
              {data.uploadedConfig.categories.length} categories.
            </p>
          )}

          {data.configError && (
            <p className="mt-1 text-xs text-red-600">
              ✗ {data.configError}
            </p>
          )}
        </div>
      </label>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — First canvas
// ---------------------------------------------------------------------------

function Step3({
  data,
  onChange,
  config,
}: {
  data: WizardData;
  onChange: (p: Partial<WizardData>) => void;
  config: ModelConfiguration;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Canvas name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={data.canvasLabel}
          onChange={(e) => onChange({ canvasLabel: e.target.value })}
          placeholder="e.g. Water Network"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Color
        </label>
        <div className="flex flex-wrap gap-2">
          {CANVAS_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onChange({ canvasColor: color })}
              className={cn(
                "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                data.canvasColor === color ? "border-zinc-900 dark:border-white scale-110" : "border-transparent",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {config.graph_types.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Graph type
          </label>
          <select
            value={data.canvasGraphType || config.graph_types[0]?.name}
            onChange={(e) => onChange({ canvasGraphType: e.target.value })}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {config.graph_types.map((gt) => (
              <option key={gt.name} value={gt.name}>{gt.name}</option>
            ))}
          </select>
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-3">
        <div
          role="checkbox"
          aria-checked={data.canvasGeoreferenced}
          onClick={() => onChange({ canvasGeoreferenced: !data.canvasGeoreferenced })}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            data.canvasGeoreferenced ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600",
          )}
        >
          <span className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            data.canvasGeoreferenced ? "translate-x-4" : "translate-x-0.5",
          )} />
        </div>
        <span className="text-sm text-zinc-700 dark:text-zinc-300">
          Georeferenced canvas
          <span className="ml-1 text-xs text-zinc-400">(node positions have real-world coordinates)</span>
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Summary / Done
// ---------------------------------------------------------------------------

function Step4({ data }: { data: WizardData }) {
  const config = data.configSource === "upload" && data.uploadedConfig
    ? data.uploadedConfig
    : DEFAULT_CONFIG;

  return (
    <div className="space-y-3">
      <SummaryRow label="Project" value={data.name} />
      {data.description && <SummaryRow label="Description" value={data.description} />}
      <SummaryRow
        label="Config"
        value={
          data.configSource === "upload"
            ? `Uploaded (${config.functionality_scale.length} levels, ${config.categories.length} categories)`
            : "Default (3-level scale)"
        }
      />
      <SummaryRow
        label="First canvas"
        value={
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: data.canvasColor }}
            />
            {data.canvasLabel}
            {data.canvasGeoreferenced && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                georeferenced
              </span>
            )}
          </span>
        }
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800">
      <span className="w-24 shrink-0 text-xs font-medium text-zinc-400 uppercase tracking-wide pt-0.5">
        {label}
      </span>
      <span className="text-sm text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

interface WizardFooterProps {
  step: WizardStep;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}

function WizardFooter({ step, canAdvance, onBack, onNext, onCancel }: WizardFooterProps) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onCancel}
        className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        Cancel
      </button>
      <div className="flex gap-2">
        {step > 1 && (
          <button
            onClick={onBack}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Back
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!canAdvance}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
            canAdvance
              ? "bg-blue-600 hover:bg-blue-700"
              : "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700",
          )}
        >
          {step === 4 ? "Create project" : "Next →"}
        </button>
      </div>
    </div>
  );
}
