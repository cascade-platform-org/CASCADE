-- CASCADE Propagation Platform — Database Schema
--
-- Only identity, RBAC, optional project sync, and audit data live here.
-- Project graph data is local-first (JSON on the user's machine) by default.
-- Server sync is opt-in; see /api/projects endpoints.
--
-- Apply: psql $DATABASE_URL -f db/schema.sql
-- Seed:  psql $DATABASE_URL -f db/seed.sql

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- RBAC: roles and permissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
    name        VARCHAR(50)  PRIMARY KEY,
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- NOTE: the role→permission mapping lives in code (auth/rbac.py), not in a
-- table — one source of truth. Role *assignment* lives on users (ADR-0010).

-- ---------------------------------------------------------------------------
-- Users (created on first OAuth2/OIDC login)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(255) UNIQUE NOT NULL,  -- "sub" claim from the OIDC token
    -- Nullable: the OIDC email claim is optional. Identity is external_id.
    email       VARCHAR(255) UNIQUE,
    name        VARCHAR(255),
    role_name   VARCHAR(50)  NOT NULL DEFAULT 'analyst' REFERENCES roles(name),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);

-- ---------------------------------------------------------------------------
-- Server-side project sync (opt-in)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    -- Full project + config bundle stored as JSONB for indexed queries.
    -- Only populated when the user has can_sync permission and enables sync.
    data        JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);

-- ---------------------------------------------------------------------------
-- Server-side audit log
--
-- Records actions taken by authenticated users on the server.
-- Rows are append-only — never updated or deleted (for compliance purposes).
-- Only users with can_admin permission can read this table via the API.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         REFERENCES users(id) ON DELETE SET NULL,
    user_email  VARCHAR(255),               -- denormalised: preserves identity after user deletion
    action      VARCHAR(100) NOT NULL,      -- e.g. "propagate", "sync_upload", "role_change", "login"
    details     JSONB        NOT NULL DEFAULT '{}',
    -- For propagation runs: { project_name, scope, canvas_count, node_count,
    --   edge_count, iterations, duration_ms, warnings_count }
    -- For role changes:     { target_user_id, old_role, new_role }
    -- For sync operations:  { project_id, project_name, operation }
    occurred_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id     ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action      ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at ON audit_logs(occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Analysis Log (ADR-0007) — one append-only, operator-only row per Propagation
--
-- Stores ONLY input shape + run metadata. Config-level vocabulary (category
-- names, graph types) may be persisted; anything naming or locating a
-- real-world Element or Entity may not. No outcomes, no geo, no labels.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analysis_logs (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID        REFERENCES users(id) ON DELETE SET NULL,
    role_name              VARCHAR(50),
    scope                  VARCHAR(10) NOT NULL,          -- 'local' | 'global'
    node_count             INT         NOT NULL,
    edge_count             INT         NOT NULL,
    canvas_count           INT         NOT NULL,
    category_names         TEXT[]      NOT NULL DEFAULT '{}',
    functionality_scale_n  INT         NOT NULL,
    event_definition_count INT         NOT NULL,
    rule_count             INT         NOT NULL,
    graph_types            TEXT[]      NOT NULL DEFAULT '{}',
    engine_version         VARCHAR(50),
    compute_time_ms        INT,
    occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_logs_user_id     ON analysis_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_occurred_at ON analysis_logs(occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Client-side activity log uploads (opt-in, requires can_sync permission)
--
-- Users can share their local activity log with the server for support or
-- collaborative debugging. Entries record local actions (hazard application,
-- propagation triggers, file saves) with no raw graph data.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity_log_uploads (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  UUID         NOT NULL,
    app_version VARCHAR(50),
    entries     JSONB        NOT NULL DEFAULT '[]',
    uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_uploads_user_id    ON activity_log_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_uploads_session_id ON activity_log_uploads(session_id);

-- ---------------------------------------------------------------------------
-- No batch-propagation table.
--
-- A speculative `batch_propagation_jobs` table lived here until migration 006
-- removed it: no endpoint was ever built, and its `results` JSONB would have
-- persisted Propagation outputs, which ADR-0007 forbids. Any future batch
-- feature designs its storage against that boundary from the start.
--
-- Every table above that carries a `user_id` must also appear in db/export.py
-- (GDPR access) and, if it is a log, in scripts/purge_expired.py (retention).
-- ---------------------------------------------------------------------------
