"use client";

/**
 * /auth/callback — where Zitadel redirects back after login. Reads the
 * ?code=..., exchanges it for an access token via the backend, stores the
 * session, and returns to the app. This is a static page (works with the
 * static export); the code is read client-side from the URL.
 *
 * Requires OIDC_REDIRECT_URI to point here, e.g. https://app.<domain>/auth/callback
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { exchangeOidcCode } from "@/lib/api-client";
import {
  OIDC_RETURN_KEY,
  OIDC_STATE_KEY,
  OIDC_VERIFIER_KEY,
  useAuthStore,
} from "@/store/auth-store";

/** Turn an OIDC error redirect (`?error=access_denied&…`) into a sentence a
 *  non-technical user can act on.
 *
 *  The IdP's own `error_description` is deliberately NOT rendered: anyone can
 *  craft `…/auth/callback?error=x&error_description=<anything>` and the text
 *  would then appear on CASCADE's real origin, which is a ready-made phishing
 *  page ("your account is locked, call this number"). React escapes it so there
 *  is no XSS, but the social-engineering value is the risk. The raw value goes
 *  to the console for debugging instead. */
function describeOidcError(code: string): string {
  switch (code) {
    case "access_denied":
      return "Sign-in was cancelled or not granted. You can try again when you're ready.";
    case "login_required":
    case "interaction_required":
      return "Sign-in needs you to log in again. Please start over from CASCADE.";
    default:
      return "Sign-in didn't complete. Please return to CASCADE and try again.";
  }
}

/** Where to send the user after a successful sign-in: the page they started
 *  from, if we stored one and it is unambiguously an in-app path.
 *
 *  The stored value is same-origin by construction (auth-store writes
 *  `location.pathname + location.search`), so this is defence in depth against
 *  a tampered sessionStorage. Browsers normalise a backslash to a slash in
 *  URLs, so "/\evil.com" would become the protocol-relative "//evil.com" — an
 *  open redirect. Reject backslashes and control characters outright. */
function returnPath(): string {
  try {
    const stored = window.sessionStorage.getItem(OIDC_RETURN_KEY);
    window.sessionStorage.removeItem(OIDC_RETURN_KEY);
    if (
      stored &&
      stored.startsWith("/") &&
      !stored.startsWith("//") &&
      !/[\\\u0000-\u001F\u007F]/.test(stored)
    ) {
      return stored;
    }
  } catch {
    /* storage blocked — fall through */
  }
  // The editor, which lives at /app since the landing page took the root.
  return "/app";
}

export default function OidcCallback() {
  const [error, setError] = useState<string | null>(null);
  // OIDC codes are single-use; guard against React StrictMode's double effect
  // invocation (dev) exchanging the same code twice.
  const exchanged = useRef(false);

  useEffect(() => {
    // The double-invocation guard must fire synchronously — deferring it
    // below like the rest of the body would let StrictMode's second effect
    // invocation slip past it before the first one claims the exchange.
    if (exchanged.current) return;
    exchanged.current = true;

    queueMicrotask(async () => {
      const params = new URLSearchParams(window.location.search);

      // Zitadel signals a failed/declined login by redirecting back with
      // ?error=… instead of ?code=… — show that, not a generic "missing code".
      const errCode = params.get("error");
      if (errCode) {
        console.error("OIDC error redirect:", errCode, params.get("error_description"));
        setError(describeOidcError(errCode));
        return;
      }

      const code = params.get("code");
      if (!code) {
        setError("This sign-in link is incomplete. Please start again from CASCADE.");
        return;
      }

      // Anti-CSRF: the state we sent must come back unchanged. A missing or
      // mismatched state means this callback was not initiated by this browser
      // session (e.g. an attacker-crafted URL trying to log the user into a
      // foreign account). Fail closed — if no state was stored, we cannot prove
      // this session started the flow, so we must reject rather than accept.
      const expectedState = window.sessionStorage.getItem(OIDC_STATE_KEY);
      window.sessionStorage.removeItem(OIDC_STATE_KEY);
      if (!expectedState || params.get("state") !== expectedState) {
        console.error("OIDC state mismatch: callback not initiated by this browser session.");
        setError(
          "This sign-in link has expired or was opened in a different browser. " +
            "Please return to CASCADE and sign in again.",
        );
        return;
      }

      // PKCE: the verifier generated before the redirect proves this session
      // (not a static secret) requested the code being exchanged. Missing =
      // fail closed, same reasoning as the state check above.
      const codeVerifier = window.sessionStorage.getItem(OIDC_VERIFIER_KEY);
      window.sessionStorage.removeItem(OIDC_VERIFIER_KEY);
      if (!codeVerifier) {
        console.error("OIDC verifier missing from sessionStorage.");
        setError(
          "This sign-in link has expired or was opened in a different browser. " +
            "Please return to CASCADE and sign in again.",
        );
        return;
      }

      // On success the backend set the httpOnly session cookies; no tokens
      // ever reach this page's JavaScript.
      const result = await exchangeOidcCode(code, codeVerifier);
      if (!result.ok) {
        // Branch on the backend's stable code. Matching the message text instead
        // would also catch the generic "Could not verify your sign-in", telling
        // users with an expired token that their email is unverified.
        if (result.code === "email_not_verified") {
          setError(
            "Your email address isn't verified yet. Open the verification link " +
              "we emailed you, then sign in again.",
          );
        } else if (result.code === "network_error") {
          setError("Couldn't reach CASCADE to finish signing in. Check your connection and try again.");
        } else {
          setError("Sign-in couldn't be completed. Please try again.");
        }
        return;
      }
      await useAuthStore.getState().completeOidcLogin();
      window.location.replace(returnPath());
    });
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-zinc-900">
        {error ? (
          <>
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
            <Link
              href="/app"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Back to CASCADE
            </Link>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
