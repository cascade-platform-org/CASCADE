"use client";

/**
 * UserButton — the current identity chip in the topbar, with a sign-out menu.
 * Shows the display name and an effective-role badge (Guest/Viewer/Analyst/…).
 */

import { useState, useRef, useEffect } from "react";
import { User, LogOut, LogIn, Users, Trash2, Download, FolderOpen } from "lucide-react";
import Link from "next/link";
import { downloadMyData } from "@/lib/api-client";
import { useAuthStore, type AuthMode, type SessionUser } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";

function effectiveRole(
  mode: AuthMode,
  authEnabled: boolean,
  user: SessionUser | null,
): string {
  if (mode === "guest") return "Guest";
  if (mode === "oidc") return user?.roles?.[0] ?? "viewer";
  if (!authEnabled) return "Admin (local)";
  return "Viewer";
}

export function UserButton() {
  const mode = useAuthStore((s) => s.mode);
  const authEnabled = useAuthStore((s) => s.authEnabled);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const loginWithOidc = useAuthStore((s) => s.loginWithOidc);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [open, setOpen] = useState(false);
  // One slot for whatever the last menu action reported — sign-in, export and
  // delete are mutually exclusive, and a silent failure in any of them leaves
  // the user with no idea why nothing happened.
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const name = mode === "guest" ? "Guest" : user?.displayName ?? "User";
  const role = effectiveRole(mode, authEnabled, user);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        title={user?.email || name}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          <User size={14} />
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {name}
            </p>
            {user?.email && (
              <p className="truncate text-xs text-zinc-500">{user.email}</p>
            )}
            <span className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800">
              {role}
            </span>
          </div>
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          {/* File management (save/load, recovery folder, Auto-save opt-in,
              Version history) lives in the File panel, not here — but this is
              the account menu people look for settings in, so it gets a
              shortcut regardless of mode: even a guest has local files to
              manage, sync or not. */}
          <button
            onClick={() => { setOpen(false); useUiStore.getState().toggleFileIoPanel(); }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <FolderOpen size={14} /> File &amp; sync
          </button>
          {authEnabled && mode !== "oidc" && (
            <button
              onClick={() => {
                setActionError(null);
                // loginWithOidc resolves to a message when the redirect can't
                // start (blocked browser storage). Dropping it left the user
                // pressing a button that silently did nothing.
                void (async () => {
                  const err = await loginWithOidc();
                  if (err) setActionError(err);
                })();
              }}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
            >
              <LogIn size={14} /> Sign in
            </button>
          )}
          {mode === "oidc" && hasPermission("can_manage_users") && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Users size={14} /> Manage users
            </Link>
          )}
          <button
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <LogOut size={14} /> {mode === "guest" ? "Switch account" : "Sign out"}
          </button>
          {mode === "oidc" && (
            <>
              <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
              <button
                disabled={exporting}
                onClick={() => {
                  // GDPR right of access (Art. 15) / portability (Art. 20).
                  // Kept in-page (fetch + blob) so an expired session refreshes
                  // and retries instead of navigating the app away.
                  setActionError(null);
                  setExporting(true);
                  void (async () => {
                    const err = await downloadMyData();
                    setExporting(false);
                    if (err) setActionError(err);
                    else setOpen(false);
                  })();
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Download size={14} />{" "}
                {exporting ? "Preparing download…" : "Download my data"}
              </button>
              <button
                onClick={() => {
                  // GDPR self-service erasure — irreversible, so double-confirm.
                  if (
                    !window.confirm(
                      "Delete your account permanently? This removes your login and " +
                        "server-side records. Projects saved as local files are NOT deleted.",
                    )
                  )
                    return;
                  void (async () => {
                    const err = await deleteAccount();
                    if (err) setActionError(err);
                  })();
                }}
                className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                <Trash2 size={14} /> Delete account
              </button>
            </>
          )}
          {actionError && (
            <p role="alert" className="px-3 py-1 text-xs text-red-500">
              {actionError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
