-- Issue #31 (Everee payments), part 1: which Everee worker is each NASA driver.
-- A driver is linked to one existing Everee worker per environment (sandbox or production). The link is only ever made from an
-- exact, unambiguous match on the driver's email or phone (never the name), or, in the sandbox only, to a test worker created for it.
-- Additive: one new table, one guard function and trigger. Nothing existing changes.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS everee_workers (
  id                  bigserial PRIMARY KEY,
  driver_id           integer NOT NULL REFERENCES drivers(id),
  environment         text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  everee_worker_id    text NOT NULL,           -- Everee's own worker ID (always present)
  external_worker_id  text,                    -- our ID for the worker in Everee, if one was set
  link_source         text NOT NULL CHECK (link_source IN ('matched_email', 'matched_phone', 'matched_email_and_phone', 'created_sandbox')),
  onboarding_complete boolean NOT NULL DEFAULT false,
  tin_status          text,
  terminated          boolean NOT NULL DEFAULT false,
  last_checked_at     timestamptz,
  linked_by           integer NOT NULL REFERENCES admin(id),
  linked_at           timestamptz NOT NULL DEFAULT now(),
  unlinked_by         integer REFERENCES admin(id),
  unlinked_at         timestamptz,
  unlink_reason       text,
  CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL)),
  CHECK (unlinked_at IS NULL OR (unlink_reason IS NOT NULL AND length(btrim(unlink_reason)) >= 3))
);

-- One live link per driver and environment, and one driver per Everee worker. A link that was undone stays as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_everee_workers_driver ON everee_workers (driver_id, environment) WHERE unlinked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_everee_workers_worker ON everee_workers (everee_worker_id, environment) WHERE unlinked_at IS NULL;

-- Who a worker is can never be rewritten and rows are never deleted: only what Everee reports about the worker may be refreshed,
-- and a link may be closed (once, with a reason).
CREATE OR REPLACE FUNCTION everee_workers_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'everee_workers rows cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['onboarding_complete', 'tin_status', 'terminated', 'last_checked_at', 'external_worker_id', 'unlinked_by', 'unlinked_at', 'unlink_reason'])
     <> (to_jsonb(OLD) - ARRAY['onboarding_complete', 'tin_status', 'terminated', 'last_checked_at', 'external_worker_id', 'unlinked_by', 'unlinked_at', 'unlink_reason']) THEN
    RAISE EXCEPTION 'everee_workers: who is linked to whom cannot be changed; unlink and link again';
  END IF;
  IF OLD.unlinked_at IS NOT NULL AND NEW.unlinked_at IS DISTINCT FROM OLD.unlinked_at THEN
    RAISE EXCEPTION 'everee_workers: an unlinked row stays unlinked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_everee_workers_guard ON everee_workers;
CREATE TRIGGER trg_everee_workers_guard BEFORE UPDATE OR DELETE ON everee_workers FOR EACH ROW EXECUTE FUNCTION everee_workers_guard();

-- Should list the table.
SELECT table_name FROM information_schema.tables WHERE table_name = 'everee_workers';
