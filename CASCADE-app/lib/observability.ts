/**
 * lib/observability.ts — real-user error and performance reporting.
 *
 * Self-hosted, Sentry-protocol-compatible (GlitchTip — see
 * docs/project/deployment.md). A no-op unless NEXT_PUBLIC_SENTRY_DSN is set at
 * build time — it cannot be a runtime env var, same reason as
 * NEXT_PUBLIC_SITE_URL (lib/site-metadata.ts): a static export has already
 * shipped its JS bundle by the time a running container's env would change.
 *
 * Privacy (ADR-0007 — the Persistence Boundary): this SDK never carries
 * project content. A Graph, an Element name, a Scenario — none of it is
 * reachable from a JS stack trace (source file/line, not data) or a
 * page-load/navigation timing, which is all this reports. `sendDefaultPii` is
 * explicitly off, and the default breadcrumb integrations record fetch/XHR
 * method+URL+status, never a request or response body — so an API call never
 * has its payload attached even by accident.
 */
import * as Sentry from "@sentry/browser";

/**
 * Errors thrown by scripts the visitor's BROWSER injects into the page, which
 * surface through our global error handler although no line of CASCADE is on
 * the stack. Each pattern names a global only the injecting browser defines:
 *
 *  - `__firefox__` — Firefox for iOS injects helper scripts (reader mode,
 *    night mode) that reference `window.__firefox__`; when the page is loaded
 *    in a context where that object is missing, the helper throws.
 *  - `window.ethereum` — crypto-wallet browsers and extensions inject a
 *    provider object under this name and their own script trips over it.
 *
 * Matched against the event's "Type: message" text and dropped in the browser,
 * before anything is sent. Keep the patterns this specific: a broad one
 * ("undefined is not an object") would also swallow our own bugs.
 */
export const INJECTED_SCRIPT_ERRORS: RegExp[] = [/__firefox__/, /window\.ethereum/];

let initialized = false;

/** Idempotent — safe to call from more than one root layout's mount effect. */
export function initObservability(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Core Web Vitals + navigation/resource timing ride along on this
    // integration's pageload transaction — no separate web-vitals package.
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
    ignoreErrors: INJECTED_SCRIPT_ERRORS,
  });
}
