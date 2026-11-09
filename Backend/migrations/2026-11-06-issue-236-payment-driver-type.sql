-- Local / Desi payments: every payment row keeps the driver's type AS IT WAS when the payment was made, so changing a driver's
-- type later never rewrites payment history. Existing rows stay NULL ("made before driver type existed"): payment history is
-- append-only (a trigger refuses UPDATE and DELETE on pay_run_payment_items), so nothing is backfilled and nothing is guessed.
--
-- Adds nullable columns only (instant, no row is rewritten). Safe to run more than once. Needs the driver type migration
-- (2026-11-06-issue-232-driver-type.sql) first.
--
-- HOW TO RUN: back up the database first and run on a copy first.

ALTER TABLE pay_run_payment_items ADD COLUMN IF NOT EXISTS driver_id integer REFERENCES drivers(id);
ALTER TABLE pay_run_payment_items ADD COLUMN IF NOT EXISTS driver_type text CHECK (driver_type IN ('LOCAL', 'DESI'));
ALTER TABLE everee_payment_items ADD COLUMN IF NOT EXISTS driver_type text CHECK (driver_type IN ('LOCAL', 'DESI'));
