-- Issue #220 (NASA Insights connector), part 1: sign-in records for the private Claude connector.
-- These tables hold ONLY connector sign-in state (registered Claude clients, pending sign-ins, grants, hashed tokens).
-- They hold no business data and are never read by the reporting role. Tokens and codes are stored as SHA-256
-- hashes only; the real values are shown once and never saved.
-- Additive: new tables only, nothing existing changes. The connector is off unless MCP_ENABLED=true.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

-- Claude registers itself here (Dynamic Client Registration). Only Claude's exact redirect URL is accepted.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id     uuid PRIMARY KEY,
  client_name   text,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

-- A sign-in the owner has been sent to (one row per consent page shown). Single use, short lived.
CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
  request_hash   text PRIMARY KEY,
  client_id      uuid NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  state          text,
  scope          text NOT NULL,
  resource       text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_requests_expires ON mcp_oauth_requests (expires_at);

-- What the owner agreed to: one NASA super admin, one Claude client, one scope. Revoking sets revoked_at.
-- Deleting the admin removes the grant.
CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  id            uuid PRIMARY KEY,
  admin_id      integer NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  scope         text NOT NULL,
  resource      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_admin ON mcp_oauth_grants (admin_id) WHERE revoked_at IS NULL;

-- One-time codes, access tokens and refresh tokens, by hash.
CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash     text PRIMARY KEY,
  grant_id       uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  code_challenge text,
  redirect_uri   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_grant ON mcp_oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tokens_expires ON mcp_oauth_tokens (expires_at);
