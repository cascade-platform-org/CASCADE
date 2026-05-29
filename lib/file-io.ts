/**
 * File I/O: save and load project and config JSON files.
 *
 * On load, all incoming data is validated with Zod schemas at the boundary
 * before touching any Zustand store. This prevents malformed or outdated files
 * from corrupting in-memory state silently.
 *
 * No network calls here — that's api-client.ts. This file only deals with
 * the browser filesystem (download / <input type="file"> / localStorage).
 */
import { z } from "zod";
import { ProjectSchema, type Project } from "./schemas/network";
import { ModelConfigurationSchema, type ModelConfiguration } from "./schemas/config";

// ---------------------------------------------------------------------------
// Versioned save history (localStorage)
// ---------------------------------------------------------------------------

const HISTORY_KEY = "cascade:project:history";
const MAX_HISTORY = 10;

interface HistoryEntry {
  saved_at: string;
  name: string;
  /** Serialized project + config bundle. */
  bundle: ProjectBundle;
}

export interface ProjectBundle {
  project: Project;
  config: ModelConfiguration;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function pushToHistory(entry: HistoryEntry): void {
  const history = loadHistory();
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function getProjectHistory(): HistoryEntry[] {
  return loadHistory();
}

// ---------------------------------------------------------------------------
// Save (explicit — triggers browser download + history entry)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to open the browser's native Save As picker (File System Access API).
 * Falls back to the legacy <a download> trick when the API is unavailable
 * (Firefox, Safari, or non-secure contexts).
 */
async function saveAs(filename: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: "application/json" });

  // Modern path: shows the OS file picker so the user can choose folder + name
  if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
    try {
      const handle = await (window as Window & typeof globalThis & {
        showSaveFilePicker: (opts: object) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "JSON file", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled (AbortError) or API unavailable — fall through to legacy
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }

  // Legacy fallback: automatic download to the browser's default download folder
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "").replace(/\s+/g, "_").slice(0, 60) || "cascade";
}

export async function saveBundle(bundle: ProjectBundle): Promise<void> {
  const filename = `${safeName(bundle.project.meta.name)}.json`;
  await saveAs(filename, JSON.stringify(bundle, null, 2));
  pushToHistory({
    saved_at: new Date().toISOString(),
    name: bundle.project.meta.name,
    bundle,
  });
}

export async function saveProject(project: Project): Promise<void> {
  const filename = `${safeName(project.meta.name)}_project.json`;
  await saveAs(filename, JSON.stringify(project, null, 2));
}

export async function saveConfig(config: ModelConfiguration): Promise<void> {
  const filename = `${safeName(config.meta.name)}_config.json`;
  await saveAs(filename, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Auto-save (safety net — localStorage only, discarded on explicit save)
// ---------------------------------------------------------------------------

const AUTOSAVE_KEY = "cascade:project:autosave";

export function autosave(bundle: ProjectBundle): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(bundle));
  } catch {
    // Quota exceeded — silently skip autosave. Explicit saves still work.
  }
}

export function loadAutosave(): ProjectBundle | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return parseBundle(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}

// ---------------------------------------------------------------------------
// Load & validate (Zod parse at the boundary)
// ---------------------------------------------------------------------------

export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Parse and validate a project JSON value. Returns a typed result. */
export function parseProject(raw: unknown): LoadResult<Project> {
  const result = ProjectSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: formatZodError(result.error) };
}

/** Parse and validate a config JSON value. Returns a typed result. */
export function parseConfig(raw: unknown): LoadResult<ModelConfiguration> {
  const result = ModelConfigurationSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: formatZodError(result.error) };
}

/** Parse and validate a { project, config } bundle. */
export function parseBundle(raw: unknown): ProjectBundle | null {
  const BundleSchema = z.object({
    project: ProjectSchema,
    config: ModelConfigurationSchema,
  });
  const result = BundleSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Read a File object and validate its JSON as a project. */
export async function loadProjectFile(file: File): Promise<LoadResult<Project>> {
  try {
    const text = await file.text();
    return parseProject(JSON.parse(text));
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
}

/** Read a File object and validate its JSON as a config. */
export async function loadConfigFile(file: File): Promise<LoadResult<ModelConfiguration>> {
  try {
    const text = await file.text();
    return parseConfig(JSON.parse(text));
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
}

/** Read a File object and validate its JSON as a project+config bundle. */
export async function loadBundleFile(file: File): Promise<LoadResult<ProjectBundle>> {
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const bundle = parseBundle(raw);
    if (bundle) return { ok: true, data: bundle };
    // Attempt single-key fallback (user loaded just the project file into bundle slot)
    const projectOnly = parseProject(raw);
    if (!projectOnly.ok) return { ok: false, error: "File is neither a valid bundle nor a valid project." };
    return { ok: false, error: "Bundle file must contain both 'project' and 'config' keys." };
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 3) // show at most 3 issues to avoid flooding the UI
    .map((i: z.ZodIssue) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
}
