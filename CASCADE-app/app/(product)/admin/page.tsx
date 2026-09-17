"use client";

/**
 * /admin — user management for managers/admins (can_manage_users).
 *
 * A thin UI over the existing admin API (api/admin_routes.py): list users,
 * change roles, delete accounts. The backend enforces every rule (permission,
 * admin-escalation guard, audited writes) — this page only surfaces them, so
 * a viewer poking at the route sees data-free errors, not data.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, Trash2, RefreshCw } from "lucide-react";
import {
  adminDeleteUser,
  adminListRoles,
  adminListUsers,
  adminSetRole,
  type AdminRole,
  type AdminUser,
} from "@/lib/api-client";
import { useAuthStore } from "@/store/auth-store";

export default function AdminPage() {
  const mode = useAuthStore((s) => s.mode);
  const initialized = useAuthStore((s) => s.initialized);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const me = useAuthStore((s) => s.user);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, r] = await Promise.all([adminListUsers(), adminListRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait for the auth store to restore the session before probing the API.
    if (initialized && mode === "oidc" && hasPermission("can_manage_users")) {
      void reload();
    }
  }, [initialized, mode, hasPermission, reload]);

  async function changeRole(user: AdminUser, role: string) {
    setBusyId(user.id);
    const err = await adminSetRole(user.id, role);
    if (err) setError(err);
    await reload();
    setBusyId(null);
  }

  async function removeUser(user: AdminUser) {
    if (
      !window.confirm(
        `Delete ${user.email || user.display_name || user.id} permanently? ` +
          "This erases the account in both the app and the identity provider.",
      )
    )
      return;
    setBusyId(user.id);
    const err = await adminDeleteUser(user.id);
    if (err) setError(err);
    await reload();
    setBusyId(null);
  }

  if (!initialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-400 dark:bg-zinc-950">
        Loading…
      </div>
    );
  }

  if (mode !== "oidc" || !hasPermission("can_manage_users")) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-zinc-900">
          <ShieldAlert className="mx-auto mb-3 text-amber-500" size={28} />
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
            User management requires a signed-in manager or admin account.
          </p>
          <Link href="/app" className="text-sm font-medium text-blue-600 hover:underline">
            Back to CASCADE
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/app"
              className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <ArrowLeft size={16} /> Back
            </Link>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              User management
            </h1>
          </div>
          <button
            onClick={() => void reload()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-400">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-400">
                    No users yet.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelf = me?.email !== "" && u.email === me?.email;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">
                          {u.display_name || u.email || u.id}
                          {isSelf && (
                            <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              you
                            </span>
                          )}
                        </p>
                        {u.email && <p className="text-xs text-zinc-500">{u.email}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={busyId === u.id || isSelf}
                          title={
                            isSelf
                              ? "You cannot change your own role — ask another admin (avoids locking yourself out)."
                              : undefined
                          }
                          onChange={(e) => void changeRole(u, e.target.value)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          {roles.map((r) => (
                            <option key={r.name} value={r.name}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => void removeUser(u)}
                          disabled={busyId === u.id || isSelf}
                          title={
                            isSelf
                              ? "Use 'Delete account' in your own profile menu instead."
                              : "Delete account (app + identity provider)"
                          }
                          className="rounded-md p-1.5 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-zinc-400">
          Role changes and deletions are audited. Granting or removing{" "}
          <span className="font-mono">admin</span> requires an admin account;
          deletion erases the user in the identity provider too (GDPR).
        </p>
      </div>
    </div>
  );
}
