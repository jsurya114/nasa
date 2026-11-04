-- A populated payment ledger must be retained. Never remove recorded payment history to undo a UI change.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pay_run_payment_records) THEN
    RAISE EXCEPTION 'payment history exists; leave these additive tables in place';
  END IF;
END $$;
DROP TABLE IF EXISTS pay_run_payment_items;
DROP TABLE IF EXISTS pay_run_payment_records;
DROP FUNCTION IF EXISTS guard_run_payment_history();
