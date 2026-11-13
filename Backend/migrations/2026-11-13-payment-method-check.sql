-- Desi drivers are paid by check. Allow 'check' as a payment method on a recorded payment, next to 'cash'. Existing rows keep their method; nothing is updated.
-- Safe to run again. Apply before deploying the code that records 'check'. Rollback: 2026-11-13-payment-method-check.rollback.sql
ALTER TABLE pay_run_payment_records DROP CONSTRAINT IF EXISTS pay_run_payment_records_method_check;
ALTER TABLE pay_run_payment_records ADD CONSTRAINT pay_run_payment_records_method_check CHECK (method IN ('bank_transfer', 'cash', 'check', 'other'));
