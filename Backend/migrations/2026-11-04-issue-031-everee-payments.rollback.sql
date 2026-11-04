-- Rollback for issue #31 part 4. A payment record must be kept: this refuses to run if any Everee batch exists, because those rows are the
-- evidence of what was sent. Remove only an empty set of tables (for example before the first payment).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM everee_payment_batches) THEN
    RAISE EXCEPTION 'Everee payment batches exist; leave these tables in place';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_everee_payout_requests_guard ON everee_payout_requests;
DROP TRIGGER IF EXISTS trg_everee_attempts_guard ON everee_payment_attempts;
DROP TRIGGER IF EXISTS trg_everee_items_guard ON everee_payment_items;
DROP TRIGGER IF EXISTS trg_everee_batches_guard ON everee_payment_batches;
DROP TABLE IF EXISTS everee_payout_requests;
DROP TABLE IF EXISTS everee_payment_attempts;
DROP TABLE IF EXISTS everee_payment_items;
DROP TABLE IF EXISTS everee_payment_batches;
DROP TABLE IF EXISTS everee_city_settings;
DROP FUNCTION IF EXISTS everee_payments_guard();
