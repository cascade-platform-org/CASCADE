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
import { exchangeOidcCode } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";

export default function OidcCallback() {
  const [error, setError] = useState<string | null>(null);
  // OIDC codes are single-use; guard against React StrictMode's double effect
  // invocation (dev) exchanging the same code twice.
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      setError("Missing authorization code.");
      return;
    }
    (async () => {
      const token = await exchangeOidcCode(code);
      if (!token) {
        setError("Sign-in failed. Please try again.");
        return;
      }
      await useAuthStore.getState().completeOidcLogin(token);
      window.location.replace("/");
    })();
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-zinc-900">
        {error ? (
          <>
            <p className="mb-4 text-sm text-red-600">{error}</p>
            <a
              href="/"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              Back to CASCADE
            </a>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
