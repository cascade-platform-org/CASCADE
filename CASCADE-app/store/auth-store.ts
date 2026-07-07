/**
 * auth-store.ts — who the current user is, and what they may do.
 *
 * Three modes:
 *   - "oidc"  : signed in via Zitadel (production). The session lives in
 *     httpOnly cookies set by the backend — this store never sees a token.
 *   - "local" : a named local session (dev, or a labelled guest in production).
 *   - "guest" : anonymous viewer.
 *
 * The backend's /api/auth/me tells us whether auth is actually enforced
 * (`authEnabled`). In local-only mode (no IdP) every request is a synthetic
 * admin, so a "local" profile has full rights; with a real IdP, only a genuine
 * OIDC session does — a "local" profile is then treated as a labelled viewer.
 *
 * Session choice (mode + display user) is persisted to localStorage so the
 * gate isn't shown on every reload. Tokens are NOT stored here: they live in
 * httpOnly cookies (cascade_access / cascade_refresh) that JavaScript cannot
 * read, so an XSS cannot exfiltrate the session.
 */
import { create } from "zustand";
import { z } from "zod";
import {
  deleteMyAccount,
  fetchAuthConfig,
  fetchMe,
  logoutSession,
  oidcLoginUrl,
  refreshSession,
  setTokenRefresher,
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
// write anything there) — validate on load instead of casting. Tokens are NOT
// part of this (httpOnly cookies own them); entries written by older versions
// carried token/refreshToken keys, which Zod simply ignores here.
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
  /** True when a previously signed-in session could not be restored (cookies
   *  expired and the refresh failed) — the gate shows a notice instead of
   *  silently demoting the user to guest with no explanation. */
  sessionExpired: boolean;

  /** Run once on app load: learn auth mode and restore any saved session. */
  init: () => Promise<void>;
  continueAsGuest: () => void;
  setLocalProfile: (displayName: string, email: string) => void;
  loginWithOidc: () => Promise<void>;
  /** Called by the OIDC callback page after the code exchange set the session
   *  cookies. Resolves the identity via /me. */
  completeOidcLogin: () => Promise<void>;
  /** Ends the session: clears cookies server-side and follows the IdP's
   *  end_session URL so the SSO session dies too (otherwise the next sign-in
   *  silently re-authenticates the same account). */
  signOut: () => Promise<void>;
  /** Return to the identity gate WITHOUT ending any session — used by
   *  "Cancel" flows (e.g. the project wizard) where the user wants to change
   *  who they are, not log out. An OIDC session's cookies stay valid, so
   *  re-picking sign-in is instant. */
  showGate: () => void;
  /** Self-service GDPR erasure (app DB + IdP), then sign-out. Returns an
   *  error message, or null on success. */
  deleteAccount: () => Promise<string | null>;
  /** UI-level permission check (backend still enforces authoritatively). */
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  initialized: false,
  authEnabled: false,
  mode: "unknown",
  user: null,
  sessionExpired: false,

  init: async () => {
    if (get().initialized) return;

    const persisted = loadPersisted();

    // Learn whether auth is ENFORCED from the public config endpoint — this
    // must not require a token, or a guest could never discover sign-in.
    // null (server unreachable) is treated as not-enforced (local-only).
    const authEnabled = (await fetchAuthConfig()) ?? false;

    const restoreChoice = (expired = false): void => {
      // Restore a prior guest/local choice; otherwise show the gate.
      const keep = persisted?.mode === "guest" || persisted?.mode === "local";
      set({
        initialized: true,
        authEnabled,
        mode: keep ? persisted!.mode : "unknown",
        user: keep ? persisted!.user : null,
        sessionExpired: expired && !keep,
      });
    };

    if (!authEnabled) {
      restoreChoice();
      return;
    }

    // Auth is enforced: a prior OIDC session lives in httpOnly cookies the
    // browser sends automatically — probe /me to see if it is still valid.
    if (persisted?.mode === "oidc") {
      const me = await fetchMe();
      if (me) {
        const user = userFromMe(me);
        savePersisted({ mode: "oidc", user });
        set({
          initialized: true,
          authEnabled: true,
          mode: "oidc",
          user,
          sessionExpired: false,
        });
        return;
      }
      // Access cookie expired — try rotating via the refresh cookie.
      if (await refreshSession()) {
        const me2 = await fetchMe();
        if (me2) {
          const user = userFromMe(me2);
          savePersisted({ mode: "oidc", user });
          set({
            initialized: true,
            authEnabled: true,
            mode: "oidc",
            user,
            sessionExpired: false,
          });
          return;
        }
      }
      // The session is genuinely gone: fall through to the gate, flagged so
      // the user sees WHY they are suddenly signed out.
      clearPersisted();
      restoreChoice(true);
      return;
    }

    restoreChoice();
  },

  continueAsGuest: () => {
    savePersisted({ mode: "guest", user: GUEST_USER });
    set({ mode: "guest", user: GUEST_USER, sessionExpired: false });
  },

  setLocalProfile: (displayName, email) => {
    const user: SessionUser = {
      sub: `local:${email || displayName}`,
      email,
      displayName: displayName || email || "User",
      roles: ["viewer"], // meaningful only when authEnabled; ignored in local dev
    };
    savePersisted({ mode: "local", user });
    set({ mode: "local", user, sessionExpired: false });
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

  completeOidcLogin: async () => {
    // The code exchange already set the httpOnly cookies; /me proves they work
    // and tells us who we are.
    const me = await fetchMe();
    if (!me) return;
    const user = userFromMe(me);
    savePersisted({ mode: "oidc", user });
    set({ authEnabled: true, mode: "oidc", user, sessionExpired: false });
  },

  signOut: async () => {
    const wasOidc = get().mode === "oidc";
    clearPersisted();
    set({ mode: "unknown", user: null, sessionExpired: false });
    if (wasOidc) {
      // Backend clears the cookies and hands back the IdP end_session URL.
      // Following it is what actually logs the user out of Zitadel — without
      // it the SSO session survives and the next sign-in silently
      // re-authenticates the same account (bad on a shared computer).
      const logoutUrl = await logoutSession();
      if (logoutUrl) window.location.href = logoutUrl;
    }
  },

  showGate: () => {
    clearPersisted();
    set({ mode: "unknown", user: null, sessionExpired: false });
  },

  deleteAccount: async () => {
    const error = await deleteMyAccount();
    if (error) return error;
    await get().signOut();
    return null;
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
// import cycle). On a 401 the client calls this; the backend rotates the
// session cookies, or we sign out if the refresh session is dead.
setTokenRefresher(async () => {
  if (useAuthStore.getState().mode !== "oidc") return false;
  const ok = await refreshSession();
  if (!ok) {
    clearPersisted();
    useAuthStore.setState({ mode: "unknown", user: null, sessionExpired: true });
  }
  return ok;
});
