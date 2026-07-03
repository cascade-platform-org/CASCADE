-- Migration 004 — v1 hardening (pre-go-live review fixes)
--
-- 1. users.email becomes nullable. The OIDC `email` claim is optional (scope
--    not granted, or IdP without email); NOT NULL + UNIQUE meant the *second*
--    email-less user hit a unique violation on '' and could never log in.
--    Identity is external_id (the OIDC sub); email is display/contact data.
--
-- 2. role_permissions is dropped. The role→permission mapping was defined
--    twice — in this table (never read by any code path) and in auth/rbac.py
--    (what the API actually enforces). Two sources of truth drift; code wins.
--    Role *assignment* stays in the users table per ADR-0010.
--
-- 3. analysis_logs implements the Analysis Log (ADR-0007): one append-only,
--    operator-only row per Propagation, storing input shape + run metadata
--    only. Config-level vocabulary (category names, graph types) is allowed;
--    anything naming or locating a real-world Element or Entity is not.
--    user_id is SET NULL on user deletion so the trail survives erasure
--    without retaining the identity link.

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

DROP TABLE IF EXISTS role_permissions;

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
