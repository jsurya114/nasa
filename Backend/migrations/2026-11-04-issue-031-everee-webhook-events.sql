-- Issue #31 (Everee payments), part 2: the webhook events Everee has sent us.
-- Each event has a unique ID. It is stored once per environment, so an event Everee delivers twice (it may) is processed once, and an
-- event whose processing failed is processed again when Everee re-delivers it. Only a trimmed copy of the data is kept: IDs and
-- statuses, never names, emails, phones, amounts or bank details.
-- Additive: one new table, one guard function and trigger.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS everee_webhook_events (
  id              bigserial PRIMARY KEY,
  event_id        text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 200),
  environment     text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  event_type      text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  company_id      bigint NOT NULL,
  event_timestamp bigint,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  attempts        integer NOT NULL DEFAULT 1,
  processed_at    timestamptz,
  outcome         text,
  UNIQUE (event_id, environment),
  CHECK ((processed_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_everee_webhook_events_type ON everee_webhook_events (environment, event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_everee_webhook_events_unprocessed ON everee_webhook_events (received_at) WHERE processed_at IS NULL;

-- An event is never deleted or rewritten: only the result of processing it (attempts, processed_at, outcome) changes.
CREATE OR REPLACE FUNCTION everee_webhook_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'everee_webhook_events rows cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['attempts', 'processed_at', 'outcome']) <> (to_jsonb(OLD) - ARRAY['attempts', 'processed_at', 'outcome']) THEN
    RAISE EXCEPTION 'everee_webhook_events: only the result of processing can change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_everee_webhook_events_guard ON everee_webhook_events;
CREATE TRIGGER trg_everee_webhook_events_guard BEFORE UPDATE OR DELETE ON everee_webhook_events FOR EACH ROW EXECUTE FUNCTION everee_webhook_events_guard();

-- Should list the table.
SELECT table_name FROM information_schema.tables WHERE table_name = 'everee_webhook_events';
