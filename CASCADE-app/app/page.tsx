"use client";

import { useState, useEffect } from "react";
import { NewProjectWizard } from "@/components/onboarding/new-project-wizard";
import { EditorShell } from "@/components/canvas/editor-shell";
import { ErrorBoundary } from "@/components/canvas/error-boundary";
import { AuthGate } from "@/components/auth/auth-gate";
import { getBeforeUnloadSave, clearBeforeUnloadSave, loadAutosave, clearAutosave, type BeforeUnloadSave } from "@/lib/file-io";
import { loadRecoveryDir } from "@/lib/recovery-dir";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useAuthStore } from "@/store/auth-store";

type AppState = "wizard" | "restore-prompt" | "editor";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("wizard");
  const [pendingSave, setPendingSave] = useState<BeforeUnloadSave | null>(null);
  const [pathCopied, setPathCopied] = useState(false);

  const authInitialized = useAuthStore((s) => s.initialized);
  const authMode = useAuthStore((s) => s.mode);

  // Learn auth mode + restore any saved session on first load.
  useEffect(() => {
    void useAuthStore.getState().init();
  }, []);

  useEffect(() => {
    const buSave = getBeforeUnloadSave();
    if (buSave) {
      setPendingSave(buSave);
      setAppState("restore-prompt");
      return;
    }
    // Fallback: check the continuous autosave (covers browser crashes where
    // beforeunload never fired).
    const asSave = loadAutosave();
    if (asSave) {
      setPendingSave({ saved_at: new Date().toISOString(), bundle: asSave });
      setAppState("restore-prompt");
    }
  }, []);

  async function handleOpenRecoveryFile() {
    if (!pendingSave?.folder_name || !pendingSave?.recovery_filename) return;
    const dir = await loadRecoveryDir();
    if (dir) {
      try {
        const fh = await dir.getFileHandle(pendingSave.recovery_filename);
        const file = await fh.getFile();
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = pendingSave.recovery_filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      } catch {
        // fall through to clipboard
      }
    }
    // Fallback: copy the path text to clipboard
    await navigator.clipboard.writeText(`${pendingSave.folder_name}/${pendingSave.recovery_filename}`);
    setPathCopied(true);
    setTimeout(() => setPathCopied(false), 2000);
  }

  function handleRestore() {
    if (!pendingSave) return;
    useCanvasStore.getState().fromProject(pendingSave.bundle.project);
    useConfigStore.getState().loadConfig(pendingSave.bundle.config);
    clearBeforeUnloadSave();
    clearAutosave();
    setAppState("editor");
  }

  function handleDiscard() {
    clearBeforeUnloadSave();
    clearAutosave();
    setAppState("wizard");
  }

  // Auth gate: block the app until the user identifies or chooses guest.
  if (!authInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-400 dark:bg-zinc-950">
        Loading…
      </div>
    );
  }
  if (authMode === "unknown") {
    // onDone is a no-op: choosing an identity updates the store, which
    // re-renders this component and falls through to the flow below.
    return <AuthGate onDone={() => undefined} />;
  }

  if (appState === "restore-prompt" && pendingSave) {
    const savedAt = new Date(pendingSave.saved_at).toLocaleString();
    const projectName = pendingSave.bundle.project.meta.name;
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900">
          <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Restore last session?
          </h2>
          <p className="mb-1 text-sm text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{projectName}</span>
          </p>
          <p className="mb-1 text-xs text-zinc-400">Saved {savedAt}</p>
          {pendingSave.folder_name && pendingSave.recovery_filename ? (
            <button
              onClick={handleOpenRecoveryFile}
              className="mb-6 block font-mono text-xs text-blue-500 underline-offset-2 hover:underline"
              title="Click to download the recovery file"
            >
              {pathCopied ? "Path copied!" : `${pendingSave.folder_name}/${pendingSave.recovery_filename}`}
            </button>
          ) : (
            <p className="mb-6 text-xs text-zinc-400 italic">Stored in browser cache</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleRestore}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Restore
            </button>
            <button
              onClick={handleDiscard}
              className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Start fresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appState === "wizard") {
    return (
      <NewProjectWizard
        onComplete={() => setAppState("editor")}
        onCancel={() => {/* no-op: wizard is the only entry point */}}
      />
    );
  }

  return (
    <ErrorBoundary>
      <div className="h-full"><EditorShell /></div>
    </ErrorBoundary>
  );
}
