"use client";

/**
 * File I/O Panel (F9) — save, load, and version history.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { X, Download, Upload, History, RotateCcw, AlertTriangle, FolderOpen, Cloud, CloudUpload, Trash2 } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useAuthStore } from "@/store/auth-store";
import {
  saveBundle,
  saveProject,
  saveConfig,
  getProjectHistory,
  clearProjectHistory,
  loadProjectFile,
  loadConfigFile,
  loadBundleFile,
  type ProjectBundle,
} from "@/lib/file-io";
import { validateBundle, type ValidationIssue } from "@/lib/project-validation";
import { ImportInpSection } from "./import-inp-section";
import { loadRecoveryDir, saveRecoveryDir, clearRecoveryDir } from "@/lib/recovery-dir";
import {
  syncSaveProject,
  syncListProjects,
  syncLoadProject,
  syncDeleteProject,
} from "@/lib/api-client";
import type { ProjectVersionSummary } from "@/lib/schemas/api";

export function FileIoPanel() {
  const closeFileIoPanel = useUiStore((s) => s.closeFileIoPanel);
  const pushToast = useUiStore((s) => s.pushToast);
  const markSaved = useUiStore((s) => s.markSaved);

  const toProject = useCanvasStore((s) => s.toProject);
  const loadProject = useCanvasStore((s) => s.loadProject);
  const config = useConfigStore((s) => s.config);
  const loadConfig = useConfigStore((s) => s.loadConfig);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  // Guards the backdrop-click-to-close: a text-selection drag that starts
  // inside a form field but ends past the panel edge fires a click whose
  // target is the backdrop, closing the panel unintentionally. Only close
  // when both mousedown and the click itself landed on the backdrop.
  const mouseDownOnBackdrop = useRef(false);

  const canSync = useAuthStore((s) => s.hasPermission("can_sync"));
  const authMode = useAuthStore((s) => s.mode);

  const [history, setHistory] = useState<ReturnType<typeof getProjectHistory>>([]);
  const [recoveryDirName, setRecoveryDirName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [saveProject_, setSaveProject_] = useState(true);
  const [saveConfig_, setSaveConfig_] = useState(true);

  const [syncVersions, setSyncVersions] = useState<ProjectVersionSummary[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncBusyId, setSyncBusyId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const reloadSyncVersions = useCallback(async () => {
    if (!canSync || authMode !== "oidc") return;
    setSyncLoading(true);
    try {
      setSyncVersions(await syncListProjects());
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Could not load synced versions.");
    } finally {
      setSyncLoading(false);
    }
  }, [canSync, authMode]);

  useEffect(() => {
    loadRecoveryDir().then((dir) => setRecoveryDirName(dir?.name ?? null));
    setHistory(getProjectHistory());
    // Re-read history every 30 s so automatic snapshots appear without reopening the panel.
    const interval = setInterval(() => setHistory(getProjectHistory()), 30_000);
    void reloadSyncVersions();
    return () => clearInterval(interval);
  }, [reloadSyncVersions]);

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

  // ---- Server Sync (requirements.md §13.4) ----

  async function handleSyncSave() {
    const bundle = currentBundle();
    setSyncError(null);
    try {
      await syncSaveProject(bundle.project.meta.name, bundle.project.meta.description ?? null, bundle);
      pushToast({ message: "Saved to server.", variant: "success", durationMs: 3000 });
      await reloadSyncVersions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync save failed.";
      setSyncError(message);
      pushToast({ message: "Sync save failed.", variant: "error", durationMs: 4000 });
    }
  }

  async function handleSyncLoad(version: ProjectVersionSummary) {
    if (
      !window.confirm(
        `Load "${version.name}" (saved ${new Date(version.created_at).toLocaleString()})? Unsaved changes will be lost.`,
      )
    )
      return;
    setSyncBusyId(version.id);
    try {
      const detail = await syncLoadProject(version.id);
      loadProject(detail.data.project);
      loadConfig(detail.data.config);
      pushToast({ message: `Loaded "${version.name}" from server.`, variant: "success", durationMs: 4000 });
      closeFileIoPanel();
    } catch (err) {
      pushToast({
        message: err instanceof Error ? err.message : "Load failed.",
        variant: "error",
        durationMs: 4000,
      });
    } finally {
      setSyncBusyId(null);
    }
  }

  async function handleSyncDelete(version: ProjectVersionSummary) {
    if (!window.confirm(`Delete "${version.name}" (server copy only) permanently?`)) return;
    setSyncBusyId(version.id);
    try {
      const err = await syncDeleteProject(version.id);
      if (err) {
        pushToast({ message: err, variant: "error", durationMs: 4000 });
      } else {
        await reloadSyncVersions();
      }
    } finally {
      setSyncBusyId(null);
    }
  }

  // ---- Load (auto-detect) ----

  async function handleFileSelected(file: File) {
    setLoadError(null);
    setValidationIssues([]);
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
      const issues = validateBundle(bundleResult.data);
      if (issues.length === 0) {
        pushToast({ message: `Loaded bundle — project + config from "${file.name}".`, variant: "success", durationMs: 4000 });
        closeFileIoPanel();
      } else {
        const errCount = issues.filter((i) => i.severity === "error").length;
        const warnCount = issues.filter((i) => i.severity === "warning").length;
        const summary = [errCount && `${errCount} error${errCount > 1 ? "s" : ""}`, warnCount && `${warnCount} warning${warnCount > 1 ? "s" : ""}`].filter(Boolean).join(", ");
        pushToast({ message: `Loaded "${file.name}" — ${summary} found. Review below.`, variant: "error", durationMs: 6000 });
        setValidationIssues(issues);
      }
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
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && mouseDownOnBackdrop.current) closeFileIoPanel();
      }}
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

        {/* Data quality issues (shown after a load with warnings/errors) */}
        {validationIssues.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle size={13} />
                Data issues ({validationIssues.length})
              </span>
              <button
                onClick={() => { setValidationIssues([]); closeFileIoPanel(); }}
                className="text-xs text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
              >
                Dismiss &amp; close
              </button>
            </div>
            <ul className="max-h-64 overflow-y-auto divide-y divide-amber-100 dark:divide-amber-900/40">
              {validationIssues.map((issue, idx) => (
                <li key={idx} className="flex gap-2 px-4 py-2">
                  <span className={`mt-0.5 shrink-0 text-[10px] font-bold uppercase tracking-wide ${
                    issue.severity === "error" ? "text-red-500" : "text-amber-500"
                  }`}>
                    {issue.severity === "error" ? "ERR" : "WRN"}
                  </span>
                  <p className="text-xs text-amber-800 dark:text-amber-300 break-words leading-relaxed">{issue.message}</p>
                </li>
              ))}
            </ul>
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

          {/* Server Sync (requirements.md §13.4) — only meaningful when signed
              in with can_sync; a guest/local session has nowhere to sync to. */}
          {canSync && authMode === "oidc" && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  <Cloud size={12} /> Server sync
                </h3>
                {syncVersions.length > 0 && (
                  <span className="text-xs text-zinc-400">{syncVersions.length} saved</span>
                )}
              </div>
              <button
                onClick={() => void handleSyncSave()}
                className="mb-2 flex w-full items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-left text-xs text-zinc-700 hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-900/20"
              >
                <CloudUpload size={14} className="shrink-0 text-zinc-400" />
                <span className="font-medium">Save current project to server</span>
              </button>
              {syncError && (
                <p className="mb-2 text-xs text-red-500 break-words">{syncError}</p>
              )}
              {syncLoading ? (
                <p className="text-xs text-zinc-400 italic">Loading…</p>
              ) : syncVersions.length === 0 ? (
                <p className="text-xs text-zinc-400 italic">
                  No synced versions yet. Up to 10 kept per project name — older
                  ones are pruned automatically.
                </p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {syncVersions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {v.name}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {new Date(v.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => void handleSyncLoad(v)}
                          disabled={syncBusyId === v.id}
                          title="Load this version"
                          className="rounded p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800"
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          onClick={() => void handleSyncDelete(v)}
                          disabled={syncBusyId === v.id}
                          title="Delete this version"
                          className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

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

          {/* EPANET .inp import */}
          <ImportInpSection />

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
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                <History size={12} /> Version history
              </h3>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    if (!window.confirm("Clear all version history? This cannot be undone.")) return;
                    clearProjectHistory();
                    setHistory([]);
                  }}
                  className="text-xs text-zinc-400 hover:text-red-500"
                >
                  Clear all
                </button>
              )}
            </div>
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
