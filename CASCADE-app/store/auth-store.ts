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
import { z } from "zod";
import {
  fetchAuthConfig,
  fetchMe,
  oidcLoginUrl,
  refreshTokens,
  setAuthToken,
  setTokenRefresher,
  type OidcTokens,
} from "@/lib/api-client";
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

// localStorage is a boundary like any other (a user, extension, or attacker can
// write anything there) — validate on load instead of casting.
const PersistedSchema = z.object({
  mode: z.enum(["unknown", "guest", "local", "oidc"]),
  user: z
    .object({
      sub: z.string(),
      email: z.string(),
      displayName: z.string(),
      roles: z.array(z.string()),
    })
    .nullable(),
  token: z.string().nullable(),
  refreshToken: z.string().nullable(),
});

type Persisted = z.infer<typeof PersistedSchema>;

const STORAGE_KEY = "cascade.auth";
/** sessionStorage key for the OAuth anti-CSRF `state` round-trip. */
export const OIDC_STATE_KEY = "cascade.oidc.state";
/** sessionStorage key for the PKCE `code_verifier` (RFC 7636). */
export const OIDC_VERIFIER_KEY = "cascade.oidc.verifier";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 PKCE pair: a random verifier, and its SHA-256 challenge (S256).
 *  The backend is a public client (no client_secret) — PKCE is what proves
 *  this specific browser session, not a shared static secret, initiated the
 *  authorization-code exchange. */
async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  window.crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

function loadPersisted(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = PersistedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
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
  refreshToken: string | null;

  /** Run once on app load: learn auth mode and restore any saved session. */
  init: () => Promise<void>;
  continueAsGuest: () => void;
  setLocalProfile: (displayName: string, email: string) => void;
  loginWithOidc: () => Promise<void>;
  /** Called by the OIDC callback page once tokens have been obtained. */
  completeOidcLogin: (tokens: OidcTokens) => Promise<void>;
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
  refreshToken: null,

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
        refreshToken: null,
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
          refreshToken: persisted.refreshToken,
        });
        return;
      }
      // Access token invalid/expired — try to refresh before giving up.
      if (persisted.refreshToken) {
        const refreshed = await refreshTokens(persisted.refreshToken);
        if (refreshed) {
          setAuthToken(refreshed.access_token);
          const me2 = await fetchMe();
          if (me2) {
            const user = userFromMe(me2);
            savePersisted({
              mode: "oidc",
              user,
              token: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
            });
            set({
              initialized: true,
              authEnabled: true,
              mode: "oidc",
              user,
              token: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
            });
            return;
          }
        }
      }
      // fall through to the gate.
    }

    restoreChoice();
  },

  continueAsGuest: () => {
    setAuthToken(null);
    savePersisted({ mode: "guest", user: GUEST_USER, token: null, refreshToken: null });
    set({ mode: "guest", user: GUEST_USER, token: null, refreshToken: null });
  },

  setLocalProfile: (displayName, email) => {
    setAuthToken(null);
    const user: SessionUser = {
      sub: `local:${email || displayName}`,
      email,
      displayName: displayName || email || "User",
      roles: ["viewer"], // meaningful only when authEnabled; ignored in local dev
    };
    savePersisted({ mode: "local", user, token: null, refreshToken: null });
    set({ mode: "local", user, token: null, refreshToken: null });
  },

  loginWithOidc: async () => {
    // Full-page redirect to the backend, which redirects on to Zitadel.
    // A random `state` is stashed in sessionStorage; the callback page rejects
    // any response whose state does not match (login-CSRF protection). The
    // PKCE `code_verifier` is stashed alongside it — the callback sends it to
    // the backend's token exchange in place of a client_secret.
    if (typeof window !== "undefined") {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const { verifier, challenge } = await generatePkcePair();
      try {
        window.sessionStorage.setItem(OIDC_STATE_KEY, state);
        window.sessionStorage.setItem(OIDC_VERIFIER_KEY, verifier);
      } catch {
        // Without stored state/verifier the callback cannot complete the
        // round-trip and will reject (fail closed). Surface that here rather
        // than sending the user through a full redirect only to be rejected
        // on return.
        window.alert(
          "Sign-in cannot proceed: browser storage is unavailable (private mode?). " +
            "Enable site data for this page and try again.",
        );
        return;
      }
      window.location.href = oidcLoginUrl(state, challenge);
    }
  },

  completeOidcLogin: async (tokens) => {
    setAuthToken(tokens.access_token);
    const me = await fetchMe();
    if (!me) {
      setAuthToken(null);
      return;
    }
    const user = userFromMe(me);
    savePersisted({
      mode: "oidc",
      user,
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });
    set({
      authEnabled: true,
      mode: "oidc",
      user,
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });
  },

  signOut: () => {
    setAuthToken(null);
    clearPersisted();
    set({ mode: "unknown", user: null, token: null, refreshToken: null });
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

// Register the 401 refresh handler with the api-client (module-level seam, no
// import cycle). On a 401 the client calls this; we swap in a fresh access
// token, or sign out if the refresh token is dead.
setTokenRefresher(async () => {
  const { refreshToken, user } = useAuthStore.getState();
  if (!refreshToken) return null;
  const tokens = await refreshTokens(refreshToken);
  if (!tokens) {
    useAuthStore.getState().signOut();
    return null;
  }
  setAuthToken(tokens.access_token);
  savePersisted({
    mode: "oidc",
    user,
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });
  useAuthStore.setState({
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });
  return tokens.access_token;
});
