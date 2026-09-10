/**
 * working-copy.ts — the auto-saved server-side copy of a project (ADR-0017).
 *
 * A **Working Copy** is not a version. requirements §13.4 keeps every explicit
 * Sync save a new, never-overwritten row with 10 kept per project name; an
 * auto-save at any useful interval would churn that list into "the last few
 * minutes" and evict the user's own saves. So it gets its own row, UPSERTed.
 *
 * OPT-IN PER PROJECT, OFF BY DEFAULT. ADR-0007's guarantee is that a network is
 * never stored server-side unless the user opts into Sync, and an auto-save that
 * uploaded silently would break that sentence rather than stretch it.
 *
 * The consent flag lives in localStorage, keyed by project name — NOT in the
 * project file. A file is something the user hands to a colleague, and a shared
 * file carrying "upload this to the server automatically: on" would opt someone
 * else in without asking them. Consent is per person and per device.
 */

import { syncDeleteWorkingCopy } from "@/lib/api-client";

const OPT_IN_KEY = "cascade:working-copy:opt-in";

function readOptIns(): string[] {
  try {
    const raw = localStorage.getItem(OPT_IN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this project name is opted into server auto-save on this device. */
export function isWorkingCopyEnabled(projectName: string): boolean {
  return readOptIns().includes(projectName);
}

/**
 * Turn server auto-save on or off for one project name.
 *
 * Turning it OFF deletes the stored copy rather than merely stopping the
 * writes: "off" has to mean the network is not on the server, or the opt-in
 * guarantee is only about writes and not about storage. The delete is
 * best-effort — the flag is cleared either way, so the client stops uploading
 * even when the server cannot be reached, and the user can retry.
 */
export async function setWorkingCopyEnabled(projectName: string, enabled: boolean): Promise<void> {
  const current = new Set(readOptIns());
  if (enabled) current.add(projectName);
  else current.delete(projectName);
  try {
    localStorage.setItem(OPT_IN_KEY, JSON.stringify([...current]));
  } catch {
    // Storage unavailable (private window, quota). The in-memory decision still
    // applies for this session; nothing is uploaded that the user did not ask for.
  }
  if (!enabled) {
    await syncDeleteWorkingCopy(projectName).catch(() => {
      // Offline, or no copy stored. Nothing to surface: the flag is off, so no
      // further writes happen, and a stale row is removed on the next opt-out.
    });
  }
}
