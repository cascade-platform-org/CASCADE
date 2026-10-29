"use client";

/**
 * import-xfmv-section.tsx — "Import FRAM model (.xfmv)" section of the File I/O
 * panel (ADR-0026).
 *
 * Flow: pick an FMV file → choose how it is read → the backend converts it to a
 * ProjectBundle that replaces the current project. Functions become nodes, each
 * output text its own node and Category, and every coupling an edge; the rule
 * on each function encodes the chosen semantics:
 *   - v2 (default): one level of damping per coupling and second-worst
 *     resonance, on a 4-level scale — the FRAM paper's conversion;
 *   - reachability: every deviation reaches everything downstream;
 *   - FMI: the FRAM Model Interpreter's binary reading, with the file's
 *     All/Any/None profiles.
 * The file holds no scenario and no rule stated only in prose: Events and extra
 * Rules are added afterwards, as in any project. Replace only, because each
 * semantics brings its own Functionality scale. Nothing is persisted.
 */

import { useRef, useState } from "react";
import { Hexagon, Loader2 } from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { importXfmv } from "@/lib/api-client";
import { openBundle } from "@/lib/project-bundle";
import { decodeXfmv } from "@/lib/xfmv-decode";
import type { XfmvSemantics } from "@/lib/schemas/api";
import { cn } from "@/lib/utils";

const SEMANTICS: { value: XfmvSemantics; label: string; hint: string }[] = [
  {
    value: "v2",
    label: "Damping + resonance",
    hint: "One degraded input is absorbed by a level; two coinciding ones pass. Four levels.",
  },
  {
    value: "reachability",
    label: "Reachability",
    hint: "Every deviation reaches everything downstream. A baseline to compare against.",
  },
  {
    value: "fmi",
    label: "FMI (binary)",
    hint: "Performed or not, with the file's All / Any / None profiles, as the FRAM Model Interpreter reads it.",
  },
];

export function ImportXfmvSection() {
  const pushToast = useUiStore((s) => s.pushToast);
  const serverReachable = useUiStore((s) => s.serverReachable);
  const closeFileIoPanel = useUiStore((s) => s.closeFileIoPanel);
  const authEnabled = useAuthStore((s) => s.authEnabled);
  const authMode = useAuthStore((s) => s.mode);
  // Same gate as the .inp importer: the conversion runs on the server.
  const canImport = !authEnabled || authMode === "oidc";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [semantics, setSemantics] = useState<XfmvSemantics>("v2");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFilePicked(picked: File) {
    setError(null);
    setFile({ name: picked.name, content: decodeXfmv(await picked.arrayBuffer()) });
  }

  async function handleImport() {
    if (!file || importing) return;
    if (!window.confirm(`Import "${file.name}"? The current project will be replaced.`)) return;
    setImporting(true);
    setError(null);
    try {
      const result = await importXfmv(file.name, file.content, semantics);
      openBundle(result.bundle);
      pushToast({
        message: `Imported "${file.name}": ${result.functions} functions, ${result.couplings} couplings.`,
        variant: "success",
        durationMs: 6000,
      });
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

  const heading = (
    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-400">
      <Hexagon size={12} /> Import FRAM model (.xfmv)
    </h3>
  );

  if (!canImport) {
    return (
      <section>
        {heading}
        <p className="rounded-md border border-zinc-100 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          The FMV conversion runs on the server and requires a signed-in account.
        </p>
      </section>
    );
  }

  return (
    <section>
      {heading}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full rounded-md border border-dashed border-zinc-300 px-3 py-2.5 text-center text-xs text-zinc-500 hover:border-sky-400 hover:bg-sky-50 dark:border-zinc-600 dark:hover:bg-sky-900/20"
      >
        {file ? (
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{file.name}</span>
        ) : (
          "Choose an FMV model (.xfmv)"
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xfmv"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void handleFilePicked(picked);
          e.target.value = "";
        }}
      />

      {file && (
        <div className="mt-2 space-y-2">
          <fieldset className="space-y-1">
            <legend className="mb-0.5 text-[10px] font-medium text-zinc-400">How to read the model</legend>
            {SEMANTICS.map((s) => (
              <label key={s.value} className="flex items-start gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                <input
                  type="radio"
                  name="xfmv-semantics"
                  checked={semantics === s.value}
                  onChange={() => setSemantics(s.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.label}.</span> {s.hint}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-[10px] text-zinc-400">
            The file holds no scenario: add Events (which functions deviate, and how much) and any rule your
            analysis states in prose after importing.
          </p>

          <button
            onClick={() => void handleImport()}
            disabled={importing || !serverReachable}
            title={serverReachable ? undefined : "Server unreachable — import runs on the backend"}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors",
              importing || !serverReachable
                ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                : "bg-sky-600 hover:bg-sky-700",
            )}
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Hexagon size={12} />}
            {importing ? "Converting…" : "Import FRAM model"}
          </button>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </section>
  );
}
