-- Rollback for issue #31 part 5: removes the three status columns (what we saw on the last look at Everee) and restores the previous guard.
-- The pay date of a payment is lost; run it only if you do not need it. Refuses to run if any item has a pay date, because that is evidence.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM everee_payment_items WHERE everee_pay_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Everee payment items have pay dates; leave these columns in place';
  END IF;
END $$;
ALTER TABLE everee_payment_items DROP CONSTRAINT IF EXISTS everee_items_check_note_length;
ALTER TABLE everee_payment_items DROP COLUMN IF EXISTS check_note;
ALTER TABLE everee_payment_items DROP COLUMN IF EXISTS last_checked_at;
ALTER TABLE everee_payment_items DROP COLUMN IF EXISTS everee_pay_date;
CREATE OR REPLACE FUNCTION everee_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'everee_payment_batches' THEN
    RAISE EXCEPTION 'everee_payment_batches rows cannot be changed';
  ELSIF TG_TABLE_NAME = 'everee_payment_items' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'everee_payable_status', 'everee_payment_id', 'payout_requested_at', 'deposit_returned', 'attempts', 'last_attempt_at', 'error_message', 'paid_at', 'updated_at'])
       <> (to_jsonb(OLD) - ARRAY['status', 'everee_payable_status', 'everee_payment_id', 'payout_requested_at', 'deposit_returned', 'attempts', 'last_attempt_at', 'error_message', 'paid_at', 'updated_at']) THEN
      RAISE EXCEPTION 'everee_payment_items: who is paid how much cannot be changed';
    END IF;
  ELSE
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
