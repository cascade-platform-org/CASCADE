"use client";

/**
 * AuthGate — the first screen: sign in / register, or continue as a guest.
 *
 * - "Sign-In or Register" (only shown when the backend enforces auth) starts the
 *   OIDC redirect to Zitadel, which hosts both login and self-service sign-up.
 * - "Continue as a Guest" = a local session identity. The Name is optional; when
 *   left blank a random guest name is generated. Guests have full rights in local
 *   dev and are a labelled viewer against a real backend.
 */

import { useState } from "react";
import { LogIn, Eye } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";

/** Friendly random guest name used when the visitor leaves the Name field blank. */
function randomGuestName(): string {
  const adjectives = ["Swift", "Calm", "Bright", "Quiet", "Bold", "Clever", "Gentle", "Brave"];
  const animals = ["Otter", "Falcon", "Heron", "Fox", "Lynx", "Ibis", "Marten", "Wren"];
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(adjectives)} ${pick(animals)}`;
}

export function AuthGate({ onDone }: { onDone: () => void }) {
  const authEnabled = useAuthStore((s) => s.authEnabled);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const setLocalProfile = useAuthStore((s) => s.setLocalProfile);
  const loginWithOidc = useAuthStore((s) => s.loginWithOidc);

  const [name, setName] = useState("");

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
            <button
              onClick={loginWithOidc}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn size={16} /> Sign-In or Register
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
