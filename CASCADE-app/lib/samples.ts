/**
 * samples.ts — bundled example projects, served as static files from
 * public/samples/ (Next.js serves public/ at the site root, so these ship in
 * every deploy with no backend involved — same-origin fetch, not an API call).
 *
 * Kept separate from file-io.ts (browser filesystem only) and api-client.ts
 * (backend calls only): this is neither.
 */
import { z } from "zod";
import { parseBundle, type ProjectBundle } from "./file-io";

const SampleManifestEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  file: z.string(),
  sizeLabel: z.string(),
});

export type SampleManifestEntry = z.infer<typeof SampleManifestEntrySchema>;

/** Fetch the sample catalogue. Empty array on any failure (missing/invalid
 *  manifest must never block the wizard — samples are optional, not required). */
export async function loadSampleManifest(): Promise<SampleManifestEntry[]> {
  try {
    const res = await fetch("/samples/manifest.json");
    if (!res.ok) return [];
    const parsed = z.array(SampleManifestEntrySchema).safeParse(await res.json());
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Fetch and validate one sample's bundle by its manifest filename. */
export async function loadSampleBundle(file: string): Promise<ProjectBundle | null> {
  try {
    const res = await fetch(`/samples/${encodeURIComponent(file)}`);
    if (!res.ok) return null;
    return parseBundle(await res.json());
  } catch {
    return null;
  }
}
