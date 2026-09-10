-- 007_project_working_copies.sql — ADR-0017, the Working Copy.
--
-- A Working Copy is NOT a version. requirements.md §13.4 requires that every
-- explicit save be a new, never-overwritten row, with 10 kept per project name;
-- auto-saving into that model at any useful interval would churn the version
-- list into "the last few minutes" and evict the user's own explicit saves.
-- So auto-save gets its own table with ONE row per (owner, name), UPSERTed.
--
-- Same privacy posture as `projects` (ADR-0007): written only when the user
-- opts a project into Sync, owner-scoped on every read, and ON DELETE CASCADE
-- so "Delete account" takes it with the rest (privacy-and-data-protection.md
-- §4 Erasure).

CREATE TABLE IF NOT EXISTS project_working_copies (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    -- Full project + config bundle, exactly as `projects.data`.
    data        JSONB        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- The UPSERT target: one working copy per project name per owner.
    CONSTRAINT project_working_copies_owner_name_key UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_project_working_copies_owner_id
    ON project_working_copies(owner_id);
