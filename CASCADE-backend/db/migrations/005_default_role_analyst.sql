-- Migration 005 — signed-in users default to 'analyst' (ADR-0010 amendment)
--
-- Original posture (migration 002): every self-registered user lands as
-- 'viewer' and an admin promotes manually. In practice sign-in already
-- requires a VERIFIED email (the /callback exchange rejects unverified id
-- tokens), and the real abuse defenses are the per-role Entitlements
-- (ADR-0008: max_nodes cap -> 413, evals/minute token bucket -> 429), not
-- the role gate. Manual promotion of every single signup added operator
-- toil without adding safety.
--
-- New posture: 'viewer' is reserved for the not-signed-in experience (the
-- frontend previews guests with viewer permissions; guests hold no DB row
-- at all) and for explicit demotions. A verified, signed-in user gets
-- 'analyst' — can propagate/sync within their entitlement caps.
ALTER TABLE users ALTER COLUMN role_name SET DEFAULT 'analyst';

-- Retroactively lift users the old default left at 'viewer'. Safe at this
-- point in v1: no admin has deliberately demoted anyone yet (the platform
-- has no real users before this migration ships). Do NOT re-run this logic
-- outside the migration — after go-live, 'viewer' may be an intentional
-- demotion.
UPDATE users SET role_name = 'analyst', updated_at = now()
 WHERE role_name = 'viewer';
