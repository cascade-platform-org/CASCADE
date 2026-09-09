"use client";

/**
 * AuthGate — the first screen: sign in / register, or continue as a guest.
 *
 * - "Sign in" and "Create account" (only shown when the backend enforces auth)
 *   both start the OIDC redirect to Zitadel; "Create account" asks Zitadel to
 *   open its self-service sign-up form directly (prompt=create).
 * - "Continue as a Guest" = a local session identity. The Name is optional; when
 *   left blank a random guest name is generated. Guests have full rights in local
 *   dev and are a labelled viewer against a real backend.
 */

import { useState } from "react";
import { LogIn, UserPlus, Eye, AlertCircle } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";

/** Google's official "G" mark, inlined as SVG.
 *
 *  Inlined rather than fetched: an external image request would leak the
 *  visitor's IP to Google BEFORE they choose to sign in with it. Nothing about
 *  this page contacts Google until the user presses the button. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/** Friendly random guest name used when the visitor leaves the Name field blank. */
function randomGuestName(): string {
  const adjectives = ["Swift", "Calm", "Bright", "Quiet", "Bold", "Clever", "Gentle", "Brave"];
  const animals = ["Otter", "Falcon", "Heron", "Fox", "Lynx", "Ibis", "Marten", "Wren"];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(adjectives)} ${pick(animals)}`;
}

export function AuthGate({ onDone }: { onDone: () => void }) {
  const authEnabled = useAuthStore((s) => s.authEnabled);
  const googleLogin = useAuthStore((s) => s.googleLogin);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const setLocalProfile = useAuthStore((s) => s.setLocalProfile);
  const loginWithOidc = useAuthStore((s) => s.loginWithOidc);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "login" | "create" | "google">(null);
  const [oidcError, setOidcError] = useState<string | null>(null);

  async function startOidc(
    which: "login" | "create" | "google",
    intent: "login" | "create" = "login",
  ) {
    setOidcError(null);
    setBusy(which);
    try {
      // Resolves to an error string when the redirect can't start; otherwise the
      // browser is already navigating away and this never returns meaningfully.
      const err = await loginWithOidc(intent, which === "google" ? "google" : undefined);
      if (err) setOidcError(err);
    } catch {
      // Reached when the PKCE step throws outright — `window.crypto.subtle` is
      // undefined on an insecure origin, which is exactly how someone testing
      // over plain HTTP arrives here. Without this catch `busy` never cleared
      // and all three sign-in buttons stayed disabled for good.
      setOidcError(
        "Sign-in needs a secure connection (https). Open CASCADE over https and try again.",
      );
    } finally {
      // The redirect case never gets here (the page is gone), so this only ever
      // re-enables the buttons on a failure.
      setBusy(null);
    }
  }

  function handleGuest(e: React.FormEvent) {
    e.preventDefault();
    setLocalProfile(name.trim() || randomGuestName(), "");
    onDone();
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl dark:bg-zinc-900">
        <div className="mb-6 flex items-center gap-2">
          <span className="text-xl text-blue-600">≡</span>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Welcome to CASCADE
          </h1>
        </div>

        {sessionExpired && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            Your session expired — please sign in again to continue where you
            left off. Local work is unaffected.
          </p>
        )}

        {authEnabled && (
          <>
            {oidcError && (
              <p
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              >
                <AlertCircle size={14} className="mt-px shrink-0" />
                <span>{oidcError}</span>
              </p>
            )}
            {googleLogin && (
              <button
                onClick={() => startOidc("google")}
                disabled={busy !== null}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                <GoogleMark />
                {busy === "google" ? "Opening Google…" : "Continue with Google"}
              </button>
            )}
            <button
              onClick={() => startOidc("login")}
              disabled={busy !== null}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <LogIn size={16} />{" "}
              {busy === "login"
                ? "Opening sign-in…"
                : googleLogin
                  ? "Sign in with email"
                  : "Sign in"}
            </button>
            <button
              onClick={() => startOidc("create", "create")}
              disabled={busy !== null}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:text-blue-300 dark:hover:bg-blue-950/40"
            >
              <UserPlus size={16} />{" "}
              {busy === "create" ? "Opening sign-up…" : "Create account"}
            </button>
            <div className="mb-4 flex items-center gap-3 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              or continue without an account
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </>
        )}

        <form onSubmit={handleGuest} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Name <span className="text-zinc-400">(optional)</span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Left blank → a random name is used"
              autoFocus
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Eye size={16} /> Continue as a Guest
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Guests and viewers can build, analyse, and save locally. Running the
          propagation engine and server sync require an account.
        </p>
      </div>
    </div>
  );
}
