/**
 * Zod schemas for the client-side activity log.
 *
 * The activity log records the user's local session actions. It is stored in
 * localStorage. When server sync is enabled and the user grants permission,
 * the log can be uploaded to the server via POST /api/audit/activity.
 *
 * The server-side audit log (propagation runs, role changes, login events) is
 * defined in backend/db/schema.sql and is only accessible to admins.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

/**
 * Actions recorded in the client-side activity log.
 * Keep this list minimal — log actions that are useful for debugging or
 * sharing context with support, not every UI click.
 */
export const ActivityActionSchema = z.enum([
  "propagate",         // Sent payload to engine, received result
  "event_applied",     // Applied a Hazard or Disservice Event to the network
  "event_cleared",     // Cleared the effects of an Event
  "timeline_step",     // Advanced the Temporal Propagation Sequence clock
  "save_project",      // Explicit save (file download or server sync)
  "load_project",      // Loaded a project from file or server
  "sync_upload",       // Uploaded project to server
  "sync_download",     // Downloaded project from server
]);

// ---------------------------------------------------------------------------
// Activity log entry
// ---------------------------------------------------------------------------

export const ActivityLogEntrySchema = z.object({
  /** Random UUID generated at log time. */
  id: z.string(),
  /** UUID generated at session start; groups entries from one browser session. */
  session_id: z.string(),
  action: ActivityActionSchema,
  /**
   * Action-specific context. For "propagate": { project_name, scope, canvas_id,
   * node_count, edge_count, duration_ms }. Never include raw project data.
   */
  details: z.record(z.string(), z.unknown()),
  occurred_at: z.string(), // ISO 8601, UTC
});

export const ActivityLogSchema = z.array(ActivityLogEntrySchema);

// ---------------------------------------------------------------------------
// Upload envelope (sent to server when sharing is enabled)
// ---------------------------------------------------------------------------

export const ActivityLogUploadSchema = z.object({
  entries: ActivityLogSchema,
  /** Semver string, e.g. "1.0.0". Helps server interpret entry details. */
  app_version: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type ActivityAction = z.infer<typeof ActivityActionSchema>;
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;
export type ActivityLog = z.infer<typeof ActivityLogSchema>;
export type ActivityLogUpload = z.infer<typeof ActivityLogUploadSchema>;
