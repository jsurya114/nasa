-- Issue #22, push notifications: remember when a person removed a phone, so a registration that arrives late
-- (the app's page gave up on it after its timeout, then the removal went through) cannot switch the phone back on.
-- A registration is refused when the access token it was sent with was issued at or before that removal. A later
-- sign-in has a newer token and registers normally. One row per person and token; rows older than a day are deleted
-- by the next removal (an access token lasts minutes, so older rows can never matter). Additive: no existing table
-- or column changes. Run after 2026-11-02-issue-022-device-tokens.sql.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.
-- Plain "psql -f" works; the file needs no special transaction handling.

CREATE TABLE IF NOT EXISTS device_token_removals (
  user_type  text        NOT NULL CHECK (user_type IN ('driver', 'admin')),
  user_id    integer     NOT NULL,
  push_token text        NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_type, user_id, push_token)
);

-- The cleanup looks for old rows.
CREATE INDEX IF NOT EXISTS idx_device_token_removals_removed_at
  ON device_token_removals (removed_at);

-- Should list the table and both indexes.
SELECT indexname FROM pg_indexes WHERE tablename = 'device_token_removals' ORDER BY indexname;
