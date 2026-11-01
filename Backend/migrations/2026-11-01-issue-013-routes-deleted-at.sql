-- Issue #13, step 2: add a column that will mark a route as archived.
-- Safe to run more than once. Nothing reads or writes the column yet, and every
-- existing row stays NULL ("not archived"), so the app behaves exactly as before.
-- BACK UP THE DATABASE FIRST and run on a copy before production (issue #13, step 1).
ALTER TABLE routes ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
