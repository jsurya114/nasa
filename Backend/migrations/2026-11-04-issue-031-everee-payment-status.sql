-- Issue #31 (Everee payments), part 5: reading a payment's progress back. Adds to each Everee payment item the date Everee paid it, when we last
-- looked, and a short note on what the last look found (kept apart from the failure message). Additive; needs issue-031-everee-payments.
-- The item guard is re-created so these three columns may change like the other "what Everee said" columns; who is paid how much still cannot.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

ALTER TABLE everee_payment_items ADD COLUMN IF NOT EXISTS everee_pay_date date;
ALTER TABLE everee_payment_items ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE everee_payment_items ADD COLUMN IF NOT EXISTS check_note text;
-- Where the item's payment ID came from: 'payable' (Everee's answer for the payable) or 'event' (a verified webhook that named it). A payment
-- found through an event is only ever marked paid when its amount can be read and matches.
ALTER TABLE everee_payment_items ADD COLUMN IF NOT EXISTS payment_link text CHECK (payment_link IS NULL OR payment_link IN ('payable', 'event'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'everee_items_check_note_length') THEN
    ALTER TABLE everee_payment_items ADD CONSTRAINT everee_items_check_note_length CHECK (check_note IS NULL OR length(check_note) <= 300);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION everee_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'everee_payment_batches' THEN
    RAISE EXCEPTION 'everee_payment_batches rows cannot be changed';
  ELSIF TG_TABLE_NAME = 'everee_payment_items' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'everee_payable_status', 'everee_payment_id', 'payout_requested_at', 'deposit_returned', 'attempts', 'last_attempt_at', 'error_message', 'paid_at', 'updated_at', 'everee_pay_date', 'last_checked_at', 'check_note', 'payment_link'])
       <> (to_jsonb(OLD) - ARRAY['status', 'everee_payable_status', 'everee_payment_id', 'payout_requested_at', 'deposit_returned', 'attempts', 'last_attempt_at', 'error_message', 'paid_at', 'updated_at', 'everee_pay_date', 'last_checked_at', 'check_note', 'payment_link']) THEN
      RAISE EXCEPTION 'everee_payment_items: who is paid how much cannot be changed';
    END IF;
  ELSE -- attempts and payout requests: completed once
    IF OLD.finished_at IS NOT NULL THEN
      RAISE EXCEPTION '% rows cannot be changed once finished', TG_TABLE_NAME;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['finished_at', 'outcome', 'http_status', 'everee_request_id', 'error_message', 'taken_count'])
       <> (to_jsonb(OLD) - ARRAY['finished_at', 'outcome', 'http_status', 'everee_request_id', 'error_message', 'taken_count']) THEN
      RAISE EXCEPTION '% rows: only the result can be written', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Should list the four columns.
SELECT column_name FROM information_schema.columns WHERE table_name = 'everee_payment_items' AND column_name IN ('everee_pay_date', 'last_checked_at', 'check_note', 'payment_link') ORDER BY 1;
