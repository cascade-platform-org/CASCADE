"use client";

/**
 * File I/O Panel (F9) — save, load, and version history.
 */

import { useRef, useState, useEffect } from "react";
import { X, Download, Upload, History, RotateCcw, AlertTriangle } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import {
  saveBundle,
  saveProject,
  saveConfig,
  getProjectHistory,
  loadProjectFile,
  loadConfigFile,
  loadBundleFile,
  type ProjectBundle,
} from "@/lib/file-io";

export function FileIoPanel() {
  const closeFileIoPanel = useUiStore((s) => s.closeFileIoPanel);
  const pushToast = useUiStore((s) => s.pushToast);

  const toProject = useCanvasStore((s) => s.toProject);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const config = useConfigStore((s) => s.config);
  const loadConfig = useConfigStore((s) => s.loadConfig);

  const projectInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<ReturnType<typeof getProjectHistory>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setHistory(getProjectHistory());
  }, []);

  function currentBundle(): ProjectBundle {
    return { project: toProject(), config };
  }

  // ---- Save actions ----

  async function handleSaveBundle() {
    try {
      await saveBundle(currentBundle());
      pushToast({ message: "Bundle saved.", variant: "success", durationMs: 3000 });
      setHistory(getProjectHistory());
    } catch {
      pushToast({ message: "Save failed.", variant: "error", durationMs: 4000 });
    }
  }

  async function handleSaveProject() {
    await saveProject(toProject());
    pushToast({ message: "project.json saved.", variant: "success", durationMs: 3000 });
  }

  async function handleSaveConfig() {
    await saveConfig(config);
    pushToast({ message: "config.json saved.", variant: "success", durationMs: 3000 });
  }

  // ---- Load actions ----

  async function handleLoadBundle(file: File) {
    const result = await loadBundleFile(file);
    if (!result.ok) {
      setLoadError(`Bundle "${file.name}" rejected — ${result.error}`);
      return;
    }
    setLoadError(null);
    loadProject(result.data.project);
    loadConfig(result.data.config);
    pushToast({ message: "Bundle loaded.", variant: "success", durationMs: 3000 });
    closeFileIoPanel();
  }

  async function handleLoadProject(file: File) {
    const result = await loadProjectFile(file);
    if (!result.ok) {
      setLoadError(`Project "${file.name}" rejected — ${result.error}`);
      return;
    }
    setLoadError(null);
    loadProject(result.data);
    pushToast({ message: "Project loaded.", variant: "success", durationMs: 3000 });
    closeFileIoPanel();
  }

  async function handleLoadConfig(file: File) {
    const result = await loadConfigFile(file);
    if (!result.ok) {
      setLoadError(`Config "${file.name}" rejected — ${result.error}`);
      return;
    }
    setLoadError(null);
    loadConfig(result.data);
    pushToast({ message: "Config loaded.", variant: "success", durationMs: 3000 });
    closeFileIoPanel();
  }

  function handleRestoreHistory(idx: number) {
    const entry = history[idx];
    if (!entry) return;
    if (!window.confirm(`Restore "${entry.name}" from ${new Date(entry.saved_at).toLocaleString()}? Unsaved changes will be lost.`)) return;
    loadProject(entry.bundle.project);
    loadConfig(entry.bundle.config);
    pushToast({ message: "Version restored.", variant: "success", durationMs: 3000 });
    closeFileIoPanel();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/20 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) closeFileIoPanel(); }}
    >
      <div className="flex h-full w-80 flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">File</h2>
          <button
            onClick={closeFileIoPanel}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        {/* Persistent load-error banner */}
        {loadError && (
          <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/40">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
            <p className="flex-1 text-xs text-red-700 dark:text-red-300 break-words">{loadError}</p>
            <button
              onClick={() => setLoadError(null)}
              className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Save */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              <Download size={12} /> Save
            </h3>
            <div className="space-y-1.5">
              <button
                onClick={handleSaveBundle}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-900/20"
              >
                <div className="font-medium">Download bundle</div>
                <div className="text-zinc-400">project.json + config.json in one file</div>
              </button>
              <button
                onClick={handleSaveProject}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <div className="font-medium">Download project.json</div>
              </button>
              <button
                onClick={handleSaveConfig}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <div className="font-medium">Download config.json</div>
              </button>
            </div>
          </section>

          {/* Load */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              <Upload size={12} /> Load
            </h3>
            <div className="space-y-1.5">
              <button
                onClick={() => bundleInputRef.current?.click()}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-900/20"
              >
                <div className="font-medium">Upload bundle</div>
                <div className="text-zinc-400">Replaces project + config</div>
              </button>
              <button
                onClick={() => projectInputRef.current?.click()}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <div className="font-medium">Upload project.json</div>
              </button>
              <button
                onClick={() => configInputRef.current?.click()}
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <div className="font-medium">Upload config.json</div>
              </button>
            </div>

            {/* Hidden file inputs */}
            <input ref={bundleInputRef} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadBundle(f); e.target.value = ""; }} />
            <input ref={projectInputRef} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadProject(f); e.target.value = ""; }} />
            <input ref={configInputRef} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLoadConfig(f); e.target.value = ""; }} />
          </section>

          {/* Version history */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              <History size={12} /> Version history
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No saved versions yet. Download a bundle to create one.</p>
            ) : (
              <div className="space-y-1">
                {history.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                  >
                    <div>
                      <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {entry.name}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {new Date(entry.saved_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestoreHistory(idx)}
                      title="Restore this version"
                      className="rounded p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
