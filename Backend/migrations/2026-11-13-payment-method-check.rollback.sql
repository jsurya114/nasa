-- Rolls back 2026-11-13-payment-method-check.sql. One ALTER TABLE statement: if any payment record already has method 'check' it is refused as a whole,
-- and the current constraint stays in place. Those records must stay, so do not force it.
ALTER TABLE pay_run_payment_records
  DROP CONSTRAINT IF EXISTS pay_run_payment_records_method_check,
  ADD CONSTRAINT pay_run_payment_records_method_check CHECK (method IN ('bank_transfer', 'cash', 'other'));
