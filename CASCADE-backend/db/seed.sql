-- CASCADE Propagation Platform — Seed Data
--
-- Apply after schema.sql:
--   psql $DATABASE_URL -f db/schema.sql
--   psql $DATABASE_URL -f db/seed.sql

-- ---------------------------------------------------------------------------
-- Default roles
-- ---------------------------------------------------------------------------

INSERT INTO roles (name, description) VALUES
    ('viewer',  'Can view shared results but cannot run Propagation'),
    ('analyst', 'Standard user — can propagate, analyse, and sync'),
    ('manager', 'Can propagate, sync, and manage team members'' roles'),
    ('admin',   'Full access including role and permission management')
ON CONFLICT (name) DO NOTHING;

-- NOTE: role→permission mapping is defined in code (auth/rbac.py) — the
-- single source of truth the API enforces. No permissions table is seeded.
