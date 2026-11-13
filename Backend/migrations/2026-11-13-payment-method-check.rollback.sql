-- Rolls back 2026-11-13-payment-method-check.sql. It fails if any payment record already has method 'check'; those must stay, so do not force it.
ALTER TABLE pay_run_payment_records DROP CONSTRAINT IF EXISTS pay_run_payment_records_method_check;
ALTER TABLE pay_run_payment_records ADD CONSTRAINT pay_run_payment_records_method_check CHECK (method IN ('bank_transfer', 'cash', 'other'));
