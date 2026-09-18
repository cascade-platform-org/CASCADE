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
  });
}
