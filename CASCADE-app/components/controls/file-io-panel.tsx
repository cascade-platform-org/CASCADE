"use client";

/**
 * File I/O Panel (F9) — four tabs: Local, Cloud, Import, New.
 *
 * The tabs ARE the explanation. Where a save lives decides whether it survives
 * clearing your browser, whether another device can see it, and what a delete
 * destroys — so it picks the tab rather than needing a paragraph inside one.
 * Copy here is deliberately minimal: a label says what, a short line says only
 * what the label cannot.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import {
  X,
  Download,
  Upload,
  RotateCcw,
  AlertTriangle,
  FolderOpen,
  Cloud,
  Trash2,
  HardDrive,
  FilePlus2,
  Import,
} from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/lib/utils";
import {
  saveBundle,
  saveProject,
  saveConfig,
  getProjectHistory,
  clearProjectHistory,
  loadProjectFile,
  loadConfigFile,
  loadBundleFile,
  formatBytes,
  historyStorageBytes,
  getStorageEstimate,
  type ProjectBundle,
  type StorageEstimate,
} from "@/lib/file-io";
import { validateBundle, type ValidationIssue } from "@/lib/project-validation";
import { ImportInpSection } from "./import-inp-section";
import { loadRecoveryDir, saveRecoveryDir, clearRecoveryDir } from "@/lib/recovery-dir";
import {
  syncSaveProject,
  syncListProjects,
  syncLoadProject,
  syncGetWorkingCopy,
  syncDeleteProject,
} from "@/lib/api-client";
import { isWorkingCopyEnabled, setWorkingCopyEnabled } from "@/lib/working-copy";
import type { WorkingCopyDetail } from "@/lib/schemas/api";
import type { ProjectVersionSummary } from "@/lib/schemas/api";

type Tab = "local" | "cloud" | "import" | "new";

const TABS = [
  { id: "local", label: "Local", icon: HardDrive },
  { id: "cloud", label: "Cloud", icon: Cloud },
  { id: "import", label: "Import", icon: Import },
  { id: "new", label: "New", icon: FilePlus2 },
] as const;

/** Small uppercase label above a group of controls. */
function Label({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
      {children}
    </p>
  );
}

/** One saved version: name, date, and its actions. */
function VersionRow({
  name,
  at,
  onRestore,
  onDelete,
  busy,
}: {
  name: string;
  at: string;
  onRestore: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-zinc-100 px-3 py-2 dark:border-zinc-800">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{name}</div>
        <div className="text-xs text-zinc-400">{new Date(at).toLocaleString()}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onRestore}
          disabled={busy}
          title="Restore"
          className="rounded p-1 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-zinc-800"
        >
          <RotateCcw size={13} />
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={busy}
            title="Delete"
            className="rounded p-1 text-zinc-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:hover:bg-red-950/40"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export function FileIoPanel() {
  const closeFileIoPanel = useUiStore((s) => s.closeFileIoPanel);
  const pushToast = useUiStore((s) => s.pushToast);
  const markSaved = useUiStore((s) => s.markSaved);
  const hasUnsavedChanges = useUiStore((s) => s.hasUnsavedChanges);

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
  const cloudReady = canSync && authMode === "oidc";

  const [tab, setTab] = useState<Tab>("local");
  const [history, setHistory] = useState<ReturnType<typeof getProjectHistory>>([]);
  const [historyBytes, setHistoryBytes] = useState(0);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [recoveryDirName, setRecoveryDirName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [saveProject_, setSaveProject_] = useState(true);
  const [saveConfig_, setSaveConfig_] = useState(true);

  const [syncVersions, setSyncVersions] = useState<ProjectVersionSummary[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncBusyId, setSyncBusyId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Working Copy (ADR-0017) — opt-in per project, off by default.
  const [autoSaveOn, setAutoSaveOn] = useState(false);
  const [workingCopy, setWorkingCopy] = useState<WorkingCopyDetail | null>(null);

  // Re-reads the local version list AND its storage footprint together —
  // every call site that changes one changes the other.
  const refreshHistory = useCallback(() => {
    setHistory(getProjectHistory());
    setHistoryBytes(historyStorageBytes());
  }, []);

  const reloadSyncVersions = useCallback(async () => {
    if (!canSync || authMode !== "oidc") return;
    setSyncLoading(true);
    try {
      const versions = await syncListProjects();
      setSyncVersions(versions);
      setSyncError(null);

      // Offer the Working Copy only when it is NEWER than the newest version:
      // otherwise the user's own explicit save is the better answer and
      // offering an older auto-save would just be noise.
      const name = useCanvasStore.getState().projectMeta.name;
      setAutoSaveOn(isWorkingCopyEnabled(name));
      const copy = await syncGetWorkingCopy(name).catch(() => null);
      const newestVersion = versions
        .filter((v) => v.name === name)
        .reduce<string | null>((acc, v) => (acc && acc > v.created_at ? acc : v.created_at), null);
      setWorkingCopy(copy && (!newestVersion || copy.updated_at > newestVersion) ? copy : null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Could not load cloud saves.");
    } finally {
      setSyncLoading(false);
    }
  }, [canSync, authMode]);

  useEffect(() => {
    loadRecoveryDir().then((dir) => setRecoveryDirName(dir?.name ?? null));
    queueMicrotask(refreshHistory);
    void getStorageEstimate().then(setStorageEstimate);
    // Re-read history every 30 s so automatic snapshots appear without reopening the panel.
    const interval = setInterval(refreshHistory, 30_000);
    queueMicrotask(() => void reloadSyncVersions());
    return () => clearInterval(interval);
  }, [refreshHistory, reloadSyncVersions]);

  function currentBundle(): ProjectBundle {
    return { project: toProject(), config };
  }

  // ---- Local ----

  async function handleSave() {
    try {
      if (saveProject_ && saveConfig_) {
        await saveBundle(currentBundle());
        pushToast({ message: "Saved.", variant: "success", durationMs: 3000 });
        refreshHistory();
      } else if (saveProject_) {
        await saveProject(toProject());
        pushToast({ message: "project.json saved.", variant: "success", durationMs: 3000 });
      } else if (saveConfig_) {
        await saveConfig(config);
        pushToast({ message: "config.json saved.", variant: "success", durationMs: 3000 });
      } else {
        pushToast({ message: "Nothing selected.", variant: "info", durationMs: 2000 });
        return;
      }
      markSaved();
    } catch (err) {
      console.error("[CASCADE] Save failed:", err);
      pushToast({ message: "Save failed.", variant: "error", durationMs: 4000 });
    }
  }

  function handleRestoreHistory(idx: number) {
    const entry = history[idx];
    if (!entry) return;
    if (!window.confirm("Restore this local save? Unsaved changes will be lost.")) return;
    loadProject(entry.bundle.project);
    loadConfig(entry.bundle.config);
    pushToast({ message: "Restored.", variant: "success", durationMs: 3000 });
    closeFileIoPanel();
  }

  // ---- Cloud (requirements.md §13.4) ----

  async function handleSyncSave() {
    const bundle = currentBundle();
    setSyncError(null);
    try {
      await syncSaveProject(bundle.project.meta.name, bundle.project.meta.description ?? null, bundle);
      pushToast({ message: "Saved to cloud.", variant: "success", durationMs: 3000 });
      await reloadSyncVersions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cloud save failed.";
      setSyncError(message);
      pushToast({ message: "Cloud save failed.", variant: "error", durationMs: 4000 });
    }
  }

  async function handleSyncLoad(version: ProjectVersionSummary) {
    if (!window.confirm("Load this cloud save? Unsaved changes will be lost.")) return;
    setSyncBusyId(version.id);
    try {
      const detail = await syncLoadProject(version.id);
      loadProject(detail.data.project);
      loadConfig(detail.data.config);
      pushToast({ message: "Loaded from cloud.", variant: "success", durationMs: 4000 });
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

  async function handleToggleAutoSave(next: boolean) {
    const name = useCanvasStore.getState().projectMeta.name;
    setAutoSaveOn(next);
    await setWorkingCopyEnabled(name, next);
    if (!next) setWorkingCopy(null);
    pushToast({
      message: next ? "Auto-save on." : "Auto-save off. The spare copy was deleted.",
      variant: "success",
      durationMs: 4000,
    });
  }

  async function handleLoadWorkingCopy() {
    if (!workingCopy) return;
    if (!window.confirm("Restore the auto-saved copy? Unsaved changes will be lost.")) return;
    loadProject(workingCopy.data.project);
    loadConfig(workingCopy.data.config);
    pushToast({ message: "Restored.", variant: "success", durationMs: 4000 });
    closeFileIoPanel();
  }

  async function handleSyncDelete(version: ProjectVersionSummary) {
    if (!window.confirm("Delete this cloud save? This cannot be undone.")) return;
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

  // ---- Load a file (auto-detect) ----

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
        pushToast({ message: `Loaded "${file.name}".`, variant: "success", durationMs: 4000 });
        closeFileIoPanel();
      } else {
        const errCount = issues.filter((i) => i.severity === "error").length;
        const warnCount = issues.filter((i) => i.severity === "warning").length;
        const summary = [errCount && `${errCount} error${errCount > 1 ? "s" : ""}`, warnCount && `${warnCount} warning${warnCount > 1 ? "s" : ""}`].filter(Boolean).join(", ");
        pushToast({ message: `Loaded "${file.name}" — ${summary} found.`, variant: "error", durationMs: 6000 });
        setValidationIssues(issues);
      }
      return;
    }

    // Try project
    const projectResult = await loadProjectFile(new File([text], file.name, { type: "application/json" }));
    if (projectResult.ok) {
      loadProject(projectResult.data);
      pushToast({ message: `Loaded "${file.name}".`, variant: "success", durationMs: 4000 });
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
    setLoadError(`"${file.name}" is not a CASCADE file.`);
  }

  async function handleSetRecoveryFolder() {
    try {
      const dir = await (window as Window & typeof globalThis & {
        showDirectoryPicker: (opts?: object) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: "readwrite" });
      await saveRecoveryDir(dir);
      setRecoveryDirName(dir.name);
      pushToast({ message: `Backups go to "${dir.name}".`, variant: "success", durationMs: 3000 });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        pushToast({ message: "Could not set the folder.", variant: "error", durationMs: 3000 });
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

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-zinc-100 px-2 dark:border-zinc-800">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-[11px] font-medium transition-colors",
                tab === id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
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
                Dismiss
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

        <div className="flex-1 overflow-y-auto p-4">
          {/* ── Local ─────────────────────────────────────────────────── */}
          {tab === "local" && (
            <div className="space-y-5">
              <div>
                <Label>Save to this computer</Label>
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
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  <Download size={14} /> Save
                </button>
              </div>

              <div>
                <Label>Open a file</Label>
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  className="w-full rounded-md border border-dashed border-zinc-300 px-3 py-3 text-center text-xs text-zinc-500 hover:border-blue-400 hover:bg-blue-50 dark:border-zinc-600 dark:hover:bg-blue-900/20"
                >
                  <Upload size={14} className="mx-auto mb-1 text-zinc-400" />
                  Choose a .json file
                </button>
                <input ref={uploadInputRef} type="file" accept=".json" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = ""; }} />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label>Recent saves ({history.length}/10)</Label>
                  {history.length > 0 && (
                    <button
                      onClick={() => {
                        if (!window.confirm("Delete all local saves?")) return;
                        clearProjectHistory();
                        refreshHistory();
                      }}
                      className="mb-1.5 text-xs text-zinc-400 hover:text-red-500"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-zinc-400 italic">Nothing saved yet.</p>
                ) : (
                  <div className="space-y-1">
                    {history.map((entry, idx) => (
                      <VersionRow
                        key={idx}
                        name={entry.name}
                        at={entry.saved_at}
                        onRestore={() => handleRestoreHistory(idx)}
                      />
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-zinc-400">
                  Kept in this browser only.
                  {storageEstimate
                    ? ` ${formatBytes(historyBytes)} of ${formatBytes(storageEstimate.quotaBytes)} free space used.`
                    : ` ${formatBytes(historyBytes)} used.`}
                </p>
              </div>

              <div>
                <Label>Backup folder</Label>
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
                    <FolderOpen size={12} /> Choose a folder…
                  </button>
                )}
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  A copy is written here every time you close the tab.
                </p>
              </div>
            </div>
          )}

          {/* ── Cloud ─────────────────────────────────────────────────── */}
          {tab === "cloud" && (
            <div className="space-y-5">
              {!cloudReady ? (
                <p className="text-xs text-zinc-400">
                  Sign in to save to the cloud and open your projects on any device.
                </p>
              ) : (
                <>
                  <button
                    onClick={() => void handleSyncSave()}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <Cloud size={14} /> Save to cloud
                  </button>

                  {/* Auto-save opt-in. Off by default: ADR-0007's guarantee is
                      that a network reaches the server only when asked. */}
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                    <input
                      type="checkbox"
                      checked={autoSaveOn}
                      onChange={(e) => void handleToggleAutoSave(e.target.checked)}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">Auto-save</span>
                      <span className="mt-0.5 block text-zinc-400">
                        Keeps one spare copy, updated as you work. Never replaces a save below.
                      </span>
                    </span>
                  </label>

                  {workingCopy && (
                    <button
                      onClick={() => void handleLoadWorkingCopy()}
                      className="flex w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
                    >
                      <RotateCcw size={14} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="font-medium">Restore auto-saved copy</span>
                        <span className="block opacity-80">
                          Newer than everything below ({new Date(workingCopy.updated_at).toLocaleString()}).
                        </span>
                      </span>
                    </button>
                  )}

                  <div>
                    <Label>Cloud saves ({syncVersions.length}/10)</Label>
                    {syncError && <p className="mb-2 text-xs text-red-500 break-words">{syncError}</p>}
                    {syncLoading ? (
                      <p className="text-xs text-zinc-400 italic">Loading…</p>
                    ) : syncVersions.length === 0 ? (
                      <p className="text-xs text-zinc-400 italic">Nothing saved yet.</p>
                    ) : (
                      <div className="max-h-64 space-y-1 overflow-y-auto">
                        {syncVersions.map((v) => (
                          <VersionRow
                            key={v.id}
                            name={v.name}
                            at={v.created_at}
                            busy={syncBusyId === v.id}
                            onRestore={() => void handleSyncLoad(v)}
                            onDelete={() => void handleSyncDelete(v)}
                          />
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-zinc-400">
                      Available on any device you sign in from. The oldest is dropped after 10.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Import ────────────────────────────────────────────────── */}
          {tab === "import" && <ImportInpSection />}

          {/* ── New ───────────────────────────────────────────────────── */}
          {tab === "new" && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Set up a fresh project from scratch, a template, or a file.
              </p>
              {hasUnsavedChanges && (
                <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  You have unsaved changes. Save them first from the Local or Cloud tab.
                </p>
              )}
              <button
                onClick={() => useUiStore.getState().requestNewProject()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                <FilePlus2 size={14} /> New project
              </button>
              <p className="text-[11px] text-zinc-400">
                Your current project stays open until you finish the setup.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
