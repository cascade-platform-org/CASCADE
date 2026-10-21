-- 008_agent_tokens.sql — ADR-0024, personal tokens for the Agent Bridge.
--
-- A personal token lets one program (the Agent Kit's cascade-mcp, run by the
-- user's agent) reach the user's OWN open CASCADE tab through the relay. It
-- grants nothing else: no REST endpoint accepts it, and the tools it reaches
-- run in the tab with the tab's own session. Only the SHA-256 of the token is
-- stored; the token itself is shown once, at creation. ON DELETE CASCADE so
-- "Delete account" takes the tokens with the rest (privacy-and-data-protection.md).

CREATE TABLE IF NOT EXISTS agent_tokens (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    token_hash    CHAR(64)     NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_owner_id ON agent_tokens(owner_id);
