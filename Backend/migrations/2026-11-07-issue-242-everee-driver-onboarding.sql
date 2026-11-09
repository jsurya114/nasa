-- Issue #242 (Everee onboarding for Local drivers), PR A: a legitimate actor for driver-started links, the tenant a link belongs to, and the
-- onboarding state of each driver. Additive: nothing existing is removed or rewritten, and every existing row stays valid.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once. Rollback: the .rollback.sql file next to this one.

-- 1. who linked a worker. A link is made by exactly one actor: an admin (as before) or the driver themselves. A driver is never recorded as an admin.
ALTER TABLE everee_workers ALTER COLUMN linked_by DROP NOT NULL;
ALTER TABLE everee_workers ADD COLUMN IF NOT EXISTS linked_by_driver_id integer REFERENCES drivers(id);
ALTER TABLE everee_workers DROP CONSTRAINT IF EXISTS everee_workers_one_actor_check;
ALTER TABLE everee_workers ADD CONSTRAINT everee_workers_one_actor_check CHECK ((linked_by IS NOT NULL) <> (linked_by_driver_id IS NOT NULL));

-- 2. the Everee company (tenant) a link belongs to, next to the environment. Existing links stay NULL ("not verified for any tenant"): they are never
--    assumed to belong to the tenant that happens to be configured now. A NULL can be filled in once, by a person who has checked it; it can never be changed.
ALTER TABLE everee_workers ADD COLUMN IF NOT EXISTS tenant_id text;

-- 3. a worker created through the driver's own onboarding
ALTER TABLE everee_workers DROP CONSTRAINT IF EXISTS everee_workers_link_source_check;
ALTER TABLE everee_workers ADD CONSTRAINT everee_workers_link_source_check
  CHECK (link_source IN ('matched_email', 'matched_phone', 'matched_email_and_phone', 'created_sandbox', 'embedded_onboarding'));

-- 4. the guard: who is linked to whom still cannot be rewritten (the actor columns are part of that), and the tenant may only be filled in once.
CREATE OR REPLACE FUNCTION everee_workers_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'everee_workers rows cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['onboarding_complete', 'tin_status', 'terminated', 'last_checked_at', 'external_worker_id', 'unlinked_by', 'unlinked_at', 'unlink_reason', 'tenant_id'])
     <> (to_jsonb(OLD) - ARRAY['onboarding_complete', 'tin_status', 'terminated', 'last_checked_at', 'external_worker_id', 'unlinked_by', 'unlinked_at', 'unlink_reason', 'tenant_id']) THEN
    RAISE EXCEPTION 'everee_workers: who is linked to whom cannot be changed; unlink and link again';
  END IF;
  IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'everee_workers: the tenant of a link cannot be changed once it is set';
  END IF;
  IF OLD.unlinked_at IS NOT NULL AND NEW.unlinked_at IS DISTINCT FROM OLD.unlinked_at THEN
    RAISE EXCEPTION 'everee_workers: an unlinked row stays unlinked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. one onboarding record per driver, environment and tenant. It is written BEFORE Everee is asked to create anything (the intent), so a lost answer,
--    a double click or a second tab can be recognised and never creates a second worker. `external_worker_id` is our stable ID for the worker.
CREATE TABLE IF NOT EXISTS everee_onboarding (
  id                  bigserial PRIMARY KEY,
  driver_id           integer NOT NULL REFERENCES drivers(id),
  environment         text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  tenant_id           text NOT NULL,
  external_worker_id  text NOT NULL,
  state               text NOT NULL CHECK (state IN ('creating', 'in_progress', 'verifying', 'complete', 'needs_review')),
  request_id          uuid NOT NULL UNIQUE,
  attempts            integer NOT NULL DEFAULT 0,
  lease_until         timestamptz,                 -- while in the future, one request is talking to Everee for this driver
  post_uncertain_at   timestamptz,                 -- set when a create request got no clear answer; cleared once the worker is found
  review_reason       text CHECK (review_reason IS NULL OR length(review_reason) <= 300),
  last_error          text CHECK (last_error IS NULL OR length(last_error) <= 300),
  verified_at         timestamptz,                 -- when Everee itself said onboarding is complete (separate from being ready to pay)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, environment, tenant_id)
);

-- 6. a short audit of what a driver did here. It never holds a link, a session URL or any profile or bank data.
CREATE TABLE IF NOT EXISTS everee_onboarding_events (
  id          bigserial PRIMARY KEY,
  driver_id   integer NOT NULL REFERENCES drivers(id),
  event       text NOT NULL CHECK (length(event) <= 60),
  detail      text CHECK (detail IS NULL OR length(detail) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_everee_onboarding_events_driver ON everee_onboarding_events (driver_id, event, created_at DESC);

-- Should list the two tables and the new columns.
SELECT table_name FROM information_schema.tables WHERE table_name IN ('everee_onboarding', 'everee_onboarding_events');
SELECT column_name FROM information_schema.columns WHERE table_name = 'everee_workers' AND column_name IN ('linked_by_driver_id', 'tenant_id');
