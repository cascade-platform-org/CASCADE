import { z } from "zod";

/**
 * Response of GET /api/auth/me. Validated at the boundary. `auth_enabled` tells
 * the client whether the backend has a real IdP wired (production) or is in
 * local-only mode (every request is a synthetic admin).
 */
export const MeResponseSchema = z.object({
  sub: z.string(),
  email: z.string(),
  display_name: z.string(),
  roles: z.array(z.string()),
  /** Effective (wildcard-expanded) permissions, computed server-side by
   *  auth/rbac.py — the client tests membership, it never maps roles itself. */
  permissions: z.array(z.string()),
  auth_enabled: z.boolean(),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * Response of GET /api/auth/config — the UNauthenticated way to learn whether
 * the backend enforces auth (so a guest/pre-login user can discover sign-in).
 */
export const AuthConfigSchema = z.object({
  auth_enabled: z.boolean(),
});

export type AuthConfig = z.infer<typeof AuthConfigSchema>;
