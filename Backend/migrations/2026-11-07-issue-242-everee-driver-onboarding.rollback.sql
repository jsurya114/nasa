-- Rollback of 2026-11-07-issue-242-everee-driver-onboarding.sql. BACK UP FIRST.
-- Refuses to run if a driver-made link exists: that row has no admin, so the old NOT NULL rule cannot come back. Unlink and handle those rows first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM everee_workers WHERE linked_by IS NULL) THEN
    RAISE EXCEPTION 'rollback stopped: some everee_workers rows were linked by a driver; resolve them first';
  END IF;
END $$;

DROP TABLE IF EXISTS everee_onboarding_events;
DROP TABLE IF EXISTS everee_onboarding;

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

ALTER TABLE everee_workers DROP CONSTRAINT IF EXISTS everee_workers_link_source_check;
ALTER TABLE everee_workers ADD CONSTRAINT everee_workers_link_source_check
  CHECK (link_source IN ('matched_email', 'matched_phone', 'matched_email_and_phone', 'created_sandbox'));
ALTER TABLE everee_workers DROP CONSTRAINT IF EXISTS everee_workers_one_actor_check;
ALTER TABLE everee_workers DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE everee_workers DROP COLUMN IF EXISTS linked_by_driver_id;
ALTER TABLE everee_workers ALTER COLUMN linked_by SET NOT NULL;
