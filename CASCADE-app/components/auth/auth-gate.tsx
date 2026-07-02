"use client";

/**
 * AuthGate — the first screen: identify yourself, or continue as a guest.
 *
 * - "Continue" with a name/email = a local session identity (full rights in
 *   local dev; a labelled viewer against a real backend).
 * - "Sign in with Zitadel" (only shown when the backend enforces auth) starts
 *   the OIDC redirect.
 * - "Continue as guest" = anonymous viewer.
 */

import { useState } from "react";
import { User, LogIn, Eye } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";

export function AuthGate({ onDone }: { onDone: () => void }) {
  const authEnabled = useAuthStore((s) => s.authEnabled);
  const setLocalProfile = useAuthStore((s) => s.setLocalProfile);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const loginWithOidc = useAuthStore((s) => s.loginWithOidc);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() && !email.trim()) return;
    setLocalProfile(name.trim(), email.trim());
    onDone();
  }

  function handleGuest() {
    continueAsGuest();
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

        {authEnabled && (
          <>
            <button
              onClick={loginWithOidc}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn size={16} /> Sign in with Zitadel
            </button>
            <div className="mb-4 flex items-center gap-3 text-xs text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              or continue without an account
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </>
        )}

        <form onSubmit={handleContinue} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Email <span className="text-zinc-400">(optional)</span>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() && !email.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            <User size={16} /> Continue
          </button>
        </form>

        <button
          onClick={handleGuest}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Eye size={16} /> Continue as guest (viewer)
        </button>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Guests and viewers can build, analyse, and save locally. Running the
          propagation engine and server sync require an account.
        </p>
      </div>
    </div>
  );
}
