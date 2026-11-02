-- Issue #22, push notifications, step 1: a table for the phones that may receive push messages.
-- One row per Expo push token. A token belongs to one person at a time: when a different person signs in
-- on the same phone, registering the token again moves it to them. Nothing reads this table until the
-- sender (next pull request) ships, and it is additive: no existing table or column changes.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.
-- Plain "psql -f" works; the file needs no special transaction handling.

CREATE TABLE IF NOT EXISTS device_tokens (
  id           bigserial PRIMARY KEY,
  user_type    text        NOT NULL CHECK (user_type IN ('driver', 'admin')),
  user_id      integer     NOT NULL,
  push_token   text        NOT NULL UNIQUE,
  platform     text        NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

-- The sender looks tokens up by person, and only the active ones.
CREATE INDEX IF NOT EXISTS idx_device_tokens_active_user
  ON device_tokens (user_type, user_id)
  WHERE revoked_at IS NULL;

-- Should list the table and both indexes.
SELECT indexname FROM pg_indexes WHERE tablename = 'device_tokens' ORDER BY indexname;
