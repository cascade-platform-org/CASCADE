"use client";

/**
 * File I/O Panel (F9) — save, load, and version history.
 */

import { useRef, useState, useEffect } from "react";
import { X, Download, Upload, History, RotateCcw, AlertTriangle, FolderOpen } from "lucide-react";
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
import { loadRecoveryDir, saveRecoveryDir, clearRecoveryDir } from "@/lib/recovery-dir";

export function FileIoPanel() {
  const closeFileIoPanel = useUiStore((s) => s.closeFileIoPanel);
  const pushToast = useUiStore((s) => s.pushToast);
  const markSaved = useUiStore((s) => s.markSaved);

  const toProject = useCanvasStore((s) => s.toProject);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const config = useConfigStore((s) => s.config);
  const loadConfig = useConfigStore((s) => s.loadConfig);

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [history, setHistory] = useState<ReturnType<typeof getProjectHistory>>([]);
  const [recoveryDirName, setRecoveryDirName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveProject_, setSaveProject_] = useState(true);
  const [saveConfig_, setSaveConfig_] = useState(true);

  useEffect(() => {
    loadRecoveryDir().then((dir) => setRecoveryDirName(dir?.name ?? null));
    setHistory(getProjectHistory());
  }, []);

  function currentBundle(): ProjectBundle {
    return { project: toProject(), config };
  }

  // ---- Save ----

  async function handleSave() {
    try {
      if (saveProject_ && saveConfig_) {
        await saveBundle(currentBundle());
        pushToast({ message: "Bundle saved.", variant: "success", durationMs: 3000 });
        setHistory(getProjectHistory());
      } else if (saveProject_) {
        await saveProject(toProject());
        pushToast({ message: "project.json saved.", variant: "success", durationMs: 3000 });
      } else if (saveConfig_) {
        await saveConfig(config);
        pushToast({ message: "config.json saved.", variant: "success", durationMs: 3000 });
      } else {
        pushToast({ message: "Nothing selected to save.", variant: "info", durationMs: 2000 });
        return;
      }
      markSaved();
    } catch (err) {
      console.error("[CASCADE] Save failed:", err);
      pushToast({ message: "Save failed.", variant: "error", durationMs: 4000 });
    }
  }

  // ---- Load (auto-detect) ----

  async function handleFileSelected(file: File) {
    setLoadError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setLoadError(`Cannot read "${file.name}".`);
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setLoadError(`"${file.name}" is not valid JSON.`);
      return;
    }

    // Try bundle first (has both project + config keys)
    const bundleResult = await loadBundleFile(new File([text], file.name, { type: "application/json" }));
    if (bundleResult.ok) {
      loadProject(bundleResult.data.project);
      loadConfig(bundleResult.data.config);
      pushToast({ message: `Loaded bundle — project + config from "${file.name}".`, variant: "success", durationMs: 4000 });
      closeFileIoPanel();
      return;
    }

    // Try project
    const projectResult = await loadProjectFile(new File([text], file.name, { type: "application/json" }));
    if (projectResult.ok) {
      loadProject(projectResult.data);
      pushToast({ message: `Loaded project from "${file.name}".`, variant: "success", durationMs: 4000 });
      closeFileIoPanel();
      return;
    }

    // Try config
    const configResult = await loadConfigFile(new File([text], file.name, { type: "application/json" }));
    if (configResult.ok) {
      loadConfig(configResult.data);
      pushToast({ message: `Loaded config from "${file.name}".`, variant: "success", durationMs: 4000 });
      closeFileIoPanel();
      return;
    }

    // Nothing matched — show most specific error
    void raw; // suppress unused warning
    setLoadError(`"${file.name}" is not a recognised CASCADE file (bundle, project, or config).`);
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

  async function handleSetRecoveryFolder() {
    try {
      const dir = await (window as Window & typeof globalThis & {
        showDirectoryPicker: (opts?: object) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: "readwrite" });
      await saveRecoveryDir(dir);
      setRecoveryDirName(dir.name);
      pushToast({ message: `Recovery folder set to "${dir.name}".`, variant: "success", durationMs: 3000 });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        pushToast({ message: "Could not set recovery folder.", variant: "error", durationMs: 3000 });
      }
    }
  }

  async function handleClearRecoveryFolder() {
    await clearRecoveryDir();
    setRecoveryDirName(null);
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
            <div className="mb-2 flex gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={saveProject_} onChange={(e) => setSaveProject_(e.target.checked)} className="h-3 w-3" />
                Project
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={saveConfig_} onChange={(e) => setSaveConfig_(e.target.checked)} className="h-3 w-3" />
                Config
              </label>
            </div>
            <button
              onClick={handleSave}
              disabled={!saveProject_ && !saveConfig_}
              className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-900/20"
            >
              <div className="font-medium">
                {saveProject_ && saveConfig_ ? "Download bundle (project + config)" : saveProject_ ? "Download project.json" : "Download config.json"}
              </div>
            </button>
          </section>

          {/* Load */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              <Upload size={12} /> Load
            </h3>
            <button
              onClick={() => uploadInputRef.current?.click()}
              className="w-full rounded-md border border-dashed border-zinc-300 px-3 py-3 text-center text-xs text-zinc-500 hover:border-blue-400 hover:bg-blue-50 dark:border-zinc-600 dark:hover:bg-blue-900/20"
            >
              <Upload size={14} className="mx-auto mb-1 text-zinc-400" />
              Choose a JSON file — bundle, project, or config automatically detected
            </button>
            <input ref={uploadInputRef} type="file" accept=".json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = ""; }} />
          </section>

          {/* Recovery folder */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              <FolderOpen size={12} /> Recovery folder
            </h3>
            <p className="mb-2 text-xs text-zinc-400">
              When set, cascade saves a recovery file here on tab close or refresh.
            </p>
            {recoveryDirName ? (
              <div className="flex items-center gap-2 rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <FolderOpen size={13} className="shrink-0 text-zinc-400" />
                <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">{recoveryDirName}/</span>
                <button onClick={handleClearRecoveryFolder} className="text-xs text-zinc-400 hover:text-red-500">Remove</button>
              </div>
            ) : (
              <button
                onClick={handleSetRecoveryFolder}
                className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700"
              >
                <FolderOpen size={12} /> Choose folder…
              </button>
            )}
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
