-- Migration 002 — Authorization schema
--
-- Applies two decisions made for the public deployment:
--   * ADR-0010 — new self-registered users must land at least privilege.
--   * ADR-0008 — an Entitlement (max nodes, engine-evaluation budget) is a
--                property of a Role.
--
-- Written to be idempotent so it is safe under the advisory-locked runner.

-- ADR-0010: the baseline schema defaults new users to 'analyst'; a stranger who
-- self-registers must instead start as 'viewer' and be promoted explicitly.
ALTER TABLE users ALTER COLUMN role_name SET DEFAULT 'viewer';

-- ADR-0008: entitlement quotas live on the role. NULL means "unbounded".
ALTER TABLE roles ADD COLUMN IF NOT EXISTS max_nodes        INT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS evals_per_minute INT;

-- Seed the ADR-0008 defaults. UPDATEs are naturally idempotent.
UPDATE roles SET max_nodes = 45,   evals_per_minute = 10000   WHERE name = 'viewer';
UPDATE roles SET max_nodes = 300,  evals_per_minute = 100000  WHERE name = 'analyst';
UPDATE roles SET max_nodes = 300,  evals_per_minute = 100000  WHERE name = 'manager';
UPDATE roles SET max_nodes = NULL, evals_per_minute = NULL    WHERE name = 'admin';
