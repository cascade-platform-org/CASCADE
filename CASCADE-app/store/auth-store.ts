/**
 * auth-store.ts — who the current user is, and what they may do.
 *
 * Three modes:
 *   - "oidc"  : signed in via Zitadel (production). Carries a real access token.
 *   - "local" : a named local session (dev, or a labelled guest in production).
 *   - "guest" : anonymous viewer.
 *
 * The backend's /api/auth/me tells us whether auth is actually enforced
 * (`authEnabled`). In local-only mode (no IdP) every request is a synthetic
 * admin, so a "local" profile has full rights; with a real IdP, only a genuine
 * OIDC token does — a "local" profile is then treated as a labelled viewer.
 *
 * Session choice is persisted to localStorage so the gate isn't shown on every
 * reload. (The OIDC token is persisted too for convenience; a hardened setup
 * would use an httpOnly cookie + refresh flow — noted as future work.)
 */
import { create } from "zustand";
import { fetchAuthConfig, fetchMe, oidcLoginUrl, setAuthToken } from "@/lib/api-client";
import type { MeResponse } from "@/lib/schemas/auth";

// Frontend mirror of the backend role→permission map (auth/rbac.py). Kept in
// sync manually; used only to gate UI affordances — the backend is the real
// enforcer.
const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  viewer: ["can_view_analysis"],
  analyst: ["can_propagate", "can_view_analysis", "can_sync"],
  manager: ["can_propagate", "can_view_analysis", "can_sync", "can_manage_users"],
  admin: ["can_admin"], // wildcard
};

function roleGrants(roles: readonly string[], permission: string): boolean {
  return roles.some((r) => {
    const granted = ROLE_PERMISSIONS[r] ?? [];
    return granted.includes("can_admin") || granted.includes(permission);
  });
}

export type AuthMode = "unknown" | "guest" | "local" | "oidc";

export interface SessionUser {
  sub: string;
  email: string;
  displayName: string;
  roles: string[];
}

interface Persisted {
  mode: AuthMode;
  user: SessionUser | null;
  token: string | null;
}

const STORAGE_KEY = "cascade.auth";

function loadPersisted(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function savePersisted(p: Persisted): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function clearPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function userFromMe(me: MeResponse): SessionUser {
  return {
    sub: me.sub,
    email: me.email,
    displayName: me.display_name || me.email || me.sub,
    roles: me.roles,
  };
}

const GUEST_USER: SessionUser = {
  sub: "guest",
  email: "",
  displayName: "Guest",
  roles: ["viewer"],
};

interface AuthState {
  initialized: boolean;
  /** Whether the backend enforces auth (has an IdP). Null until init() runs. */
  authEnabled: boolean;
  mode: AuthMode;
  user: SessionUser | null;
  token: string | null;

  /** Run once on app load: learn auth mode and restore any saved session. */
  init: () => Promise<void>;
  continueAsGuest: () => void;
  setLocalProfile: (displayName: string, email: string) => void;
  loginWithOidc: () => void;
  /** Called by the OIDC callback page once a token has been obtained. */
  completeOidcLogin: (token: string) => Promise<void>;
  signOut: () => void;
  /** UI-level permission check (backend still enforces authoritatively). */
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  authEnabled: false,
  mode: "unknown",
  user: null,
  token: null,

  init: async () => {
    if (get().initialized) return;

    const persisted = loadPersisted();

    // Learn whether auth is ENFORCED from the public config endpoint — this
    // must not require a token, or a guest could never discover sign-in.
    // null (server unreachable) is treated as not-enforced (local-only).
    const authEnabled = (await fetchAuthConfig()) ?? false;

    const restoreChoice = (): void => {
      // Restore a prior guest/local choice; otherwise show the gate.
      setAuthToken(null);
      const keep = persisted?.mode === "guest" || persisted?.mode === "local";
      set({
        initialized: true,
        authEnabled,
        mode: keep ? persisted!.mode : "unknown",
        user: keep ? persisted!.user : null,
        token: null,
      });
    };

    if (!authEnabled) {
      restoreChoice();
      return;
    }

    // Auth is enforced: validate any persisted OIDC token via /me.
    if (persisted?.token) {
      setAuthToken(persisted.token);
      const me = await fetchMe();
      if (me) {
        set({
          initialized: true,
          authEnabled: true,
          mode: "oidc",
          user: userFromMe(me),
          token: persisted.token,
        });
        return;
      }
      // token invalid/expired — fall through to the gate.
    }

    restoreChoice();
  },

  continueAsGuest: () => {
    setAuthToken(null);
    savePersisted({ mode: "guest", user: GUEST_USER, token: null });
    set({ mode: "guest", user: GUEST_USER, token: null });
  },

  setLocalProfile: (displayName, email) => {
    setAuthToken(null);
    const user: SessionUser = {
      sub: `local:${email || displayName}`,
      email,
      displayName: displayName || email || "User",
      roles: ["viewer"], // meaningful only when authEnabled; ignored in local dev
    };
    savePersisted({ mode: "local", user, token: null });
    set({ mode: "local", user, token: null });
  },

  loginWithOidc: () => {
    // Full-page redirect to the backend, which redirects on to Zitadel.
    if (typeof window !== "undefined") {
      window.location.href = oidcLoginUrl();
    }
  },

  completeOidcLogin: async (token) => {
    setAuthToken(token);
    const me = await fetchMe();
    if (!me) {
      setAuthToken(null);
      return;
    }
    const user = userFromMe(me);
    savePersisted({ mode: "oidc", user, token });
    set({ authEnabled: true, mode: "oidc", user, token });
  },

  signOut: () => {
    setAuthToken(null);
    clearPersisted();
    set({ mode: "unknown", user: null, token: null });
  },

  hasPermission: (permission) => {
    const { mode, authEnabled, user } = get();
    if (mode === "oidc") return roleGrants(user?.roles ?? ["viewer"], permission);
    // Guests preview the viewer experience even in local dev, so the mode is
    // meaningful before deployment.
    if (mode === "guest") return roleGrants(["viewer"], permission);
    if (!authEnabled) return true; // local dev backend treats everyone as admin
    return roleGrants(["viewer"], permission); // labelled local profile in prod
  },
}));
