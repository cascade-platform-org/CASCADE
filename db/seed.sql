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

-- ---------------------------------------------------------------------------
-- Default permissions per role
-- ---------------------------------------------------------------------------

INSERT INTO role_permissions (role_name, permission) VALUES
    -- viewer
    ('viewer',  'can_view_analysis'),

    -- analyst
    ('analyst', 'can_propagate'),
    ('analyst', 'can_view_analysis'),
    ('analyst', 'can_sync'),

    -- manager
    ('manager', 'can_propagate'),
    ('manager', 'can_view_analysis'),
    ('manager', 'can_sync'),
    ('manager', 'can_manage_users'),

    -- admin (wildcard — checked via can_admin in rbac.py)
    ('admin',   'can_admin')
ON CONFLICT (role_name, permission) DO NOTHING;
