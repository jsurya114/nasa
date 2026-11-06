-- Rollback for the payment driver type columns. This DELETES the recorded driver types of past payments (the payments themselves stay).
ALTER TABLE everee_payment_items DROP COLUMN IF EXISTS driver_type;
ALTER TABLE pay_run_payment_items DROP COLUMN IF EXISTS driver_type;
ALTER TABLE pay_run_payment_items DROP COLUMN IF EXISTS driver_id;
