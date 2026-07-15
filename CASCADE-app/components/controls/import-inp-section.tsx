"use client";

/**
 * import-inp-section.tsx — "Import EPANET .inp" section of the File I/O panel.
 *
 * Flow: pick a .inp file → tune the knobs (node budget, CRS, demand mode,
 * hydraulic priorities) → the backend converts it to a ProjectBundle
 * (parse → skeletonize → WNTR scarcity sweep → baseline hydraulic solve for
 * pipe capacities → map, requirements §13.5). Pipe capacity is derived from
 * each pipe's own simulated velocity, not a user-set constant. Source supply
 * is always the sum of a Reservoir/Tank's outgoing pipe capacities — not a
 * user choice either; edit a specific node's supply_capacity in the
 * Inspector after import for a known real value.
 *
 * Two import modes:
 *   - "Replace project" — the returned bundle replaces the current project
 *     exactly like loading a local file. The functionality scale size
 *     (n_levels) is a free choice here, since there is no existing scale to
 *     stay consistent with.
 *   - "Add as extra canvas" — merges the imported canvas + nodes/edges INTO
 *     the current project (canvasStore.mergeImportedProject, remapping any
 *     colliding id) and merges new categories/graph_types/events into the
 *     current config (configStore.mergeConfig) rather than replacing it.
 *     n_levels is forced to the CURRENT project's own scale size so the
 *     imported functionality values land on the same 1..N scale — the
 *     import's own generated scale is discarded, not merged in.
 * Nothing is persisted server-side either way.
 */

import { useRef, useState } from "react";
import { Waves, Loader2 } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useAuthStore } from "@/store/auth-store";
import { importInp } from "@/lib/api-client";
import { remapConfigEventIds } from "@/lib/merge-import";
import { cn } from "@/lib/utils";

type ImportMode = "replace" | "merge";

export function ImportInpSection() {
  const pushToast = useUiStore((s) => s.pushToast);
  const serverReachable = useUiStore((s) => s.serverReachable);
  const closeFileIoPanel = useUiStore((s) => s.closeFileIoPanel);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const mergeImportedProject = useCanvasStore((s) => s.mergeImportedProject);
  const loadConfig = useConfigStore((s) => s.loadConfig);
  const mergeConfig = useConfigStore((s) => s.mergeConfig);
  const currentNLevels = useConfigStore((s) => s.config.functionality_scale.length);
  const authEnabled = useAuthStore((s) => s.authEnabled);
  const authMode = useAuthStore((s) => s.mode);
  // When the backend enforces auth, only OIDC sessions carry credentials the
  // import endpoint accepts — guests/local profiles would just get a 401.
  const canImport = !authEnabled || authMode === "oidc";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [mode, setMode] = useState<ImportMode>("replace");
  const [targetNodes, setTargetNodes] = useState("100");
  const [sourceCrs, setSourceCrs] = useState("EPSG:3004");
  const [demandMode, setDemandMode] = useState<"peak" | "base" | "avg">("peak");
  const [derivePriorities, setDerivePriorities] = useState(true);
  const [nLevels, setNLevels] = useState("3");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFilePicked(picked: File) {
    setError(null);
    setFile({ name: picked.name, content: await picked.text() });
  }

  const targetValid =
    targetNodes.trim() !== "" &&
    Number.isInteger(Number(targetNodes)) &&
    Number(targetNodes) >= 5;
  const nLevelsValid =
    mode === "merge" ||
    (nLevels.trim() !== "" && Number.isInteger(Number(nLevels)) && Number(nLevels) >= 2);
  const formValid = targetValid && nLevelsValid;

  async function handleImport() {
    if (!file || importing || !formValid) return;
    const confirmMessage =
      mode === "replace"
        ? `Import "${file.name}"? The current project will be replaced.`
        : `Import "${file.name}" as a new canvas in the current project?`;
    if (!window.confirm(confirmMessage)) return;

    setImporting(true);
    setError(null);
    try {
      const result = await importInp(file.name, file.content, {
        targetNodes: Number(targetNodes),
        sourceCrs: sourceCrs.trim() || undefined,
        demandMode,
        derivePriorities,
        // Merge mode: force the import onto the CURRENT project's own scale
        // size so functionality values line up with it; the import's own
        // generated scale is never used in this mode (see module docstring).
        nLevels: mode === "merge" ? currentNLevels : Number(nLevels),
      });

      const reduced =
        result.original_nodes !== result.imported_nodes
          ? ` (skeletonized ${result.original_nodes} → ${result.imported_nodes} nodes)`
          : "";

      // Embed the original .inp content + demand_mode onto every canvas the
      // import produced — enables switching that canvas's graph_type to
      // "epanet" later for a live WNTR-vs-CASCADE comparison (ADR-0013). The
      // content travels inside the project JSON (local-first) and is read
      // back only if/when a propagation request targets an "epanet" canvas.
      const projectWithSource = {
        ...result.bundle.project,
        canvases: result.bundle.project.canvases.map((c) => ({
          ...c,
          source_inp_content: file.content,
          source_inp_demand_mode: demandMode,
        })),
      };

      if (mode === "replace") {
        loadProject(projectWithSource);
        loadConfig(result.bundle.config);
        pushToast({
          message: `Imported "${file.name}"${reduced}.`,
          variant: "success",
          durationMs: 6000,
        });
      } else {
        const { nodeIdMap, edgeIdMap } = mergeImportedProject(projectWithSource);
        const remappedConfig = remapConfigEventIds(
          result.bundle.config,
          result.bundle.project,
          nodeIdMap,
          edgeIdMap,
        );
        const summary = mergeConfig(remappedConfig);
        pushToast({
          message: `Added "${file.name}"${reduced} as a new canvas.`,
          variant: "success",
          durationMs: 6000,
        });
        if (summary.skippedCategories.length > 0 || summary.skippedGraphTypes.length > 0) {
          pushToast({
            message: `Kept existing config for: ${[...summary.skippedCategories, ...summary.skippedGraphTypes].join(", ")}.`,
            variant: "warning",
            durationMs: 8000,
          });
        }
      }

      for (const warning of result.warnings.slice(0, 2)) {
        pushToast({ message: warning, variant: "warning", durationMs: 8000 });
      }
      closeFileIoPanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  if (!canImport) {
    return (
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
          <Waves size={12} /> Import EPANET .inp
        </h3>
        <p className="rounded-md border border-zinc-100 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          The .inp conversion runs on the server and requires a signed-in
          account. Sign in to import water networks.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
        <Waves size={12} /> Import EPANET .inp
      </h3>

      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full rounded-md border border-dashed border-zinc-300 px-3 py-2.5 text-center text-xs text-zinc-500 hover:border-sky-400 hover:bg-sky-50 dark:border-zinc-600 dark:hover:bg-sky-900/20"
      >
        {file ? (
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{file.name}</span>
        ) : (
          "Choose a water-network .inp file"
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".inp"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void handleFilePicked(picked);
          e.target.value = "";
        }}
      />

      {file && (
        <div className="mt-2 space-y-2">
          <div className="flex rounded-md border border-zinc-200 p-0.5 text-xs dark:border-zinc-700">
            {(["replace", "merge"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded px-2 py-1 font-medium transition-colors",
                  mode === m
                    ? "bg-sky-600 text-white"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                )}
              >
                {m === "replace" ? "Replace project" : "Add as extra canvas"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400">
                Max nodes (skeletonize)
              </span>
              <input
                type="number"
                min={5}
                value={targetNodes}
                onChange={(e) => setTargetNodes(e.target.value)}
                className={cn(
                  "w-full rounded border bg-white px-2 py-1 text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-200",
                  targetValid
                    ? "border-zinc-200 focus:border-sky-400 dark:border-zinc-700"
                    : "border-red-400",
                )}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400">
                Coordinate CRS
              </span>
              <input
                type="text"
                value={sourceCrs}
                onChange={(e) => setSourceCrs(e.target.value)}
                placeholder="EPSG:3004"
                className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-sky-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <label className="block flex-1">
              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400">Demand</span>
              <select
                value={demandMode}
                onChange={(e) => setDemandMode(e.target.value as "peak" | "base" | "avg")}
                className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-sky-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value="peak">Peak (base × max pattern)</option>
                <option value="avg">Average</option>
                <option value="base">Base only</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 pt-3.5 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={derivePriorities}
                onChange={(e) => setDerivePriorities(e.target.checked)}
                className="h-3 w-3 rounded accent-sky-600"
              />
              Hydraulic priorities
            </label>
          </div>

          {mode === "replace" ? (
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-medium text-zinc-400">
                Functionality scale size
              </span>
              <input
                type="number"
                min={2}
                value={nLevels}
                onChange={(e) => setNLevels(e.target.value)}
                className={cn(
                  "w-full rounded border bg-white px-2 py-1 text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-200",
                  nLevelsValid
                    ? "border-zinc-200 focus:border-sky-400 dark:border-zinc-700"
                    : "border-red-400",
                )}
              />
            </label>
          ) : (
            <p className="rounded-md border border-zinc-100 px-2 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-800">
              Functionality scale: {currentNLevels} levels (matches the current
              project — its scale stays as-is, only new categories/events are
              added).
            </p>
          )}

          <button
            onClick={() => void handleImport()}
            disabled={importing || !formValid || !serverReachable}
            title={serverReachable ? undefined : "Server unreachable — import runs on the backend"}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors",
              importing || !formValid || !serverReachable
                ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                : "bg-sky-600 hover:bg-sky-700",
            )}
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Waves size={12} />}
            {importing ? "Converting… (skeletonization + hydraulics)" : "Import network"}
          </button>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </section>
  );
}
