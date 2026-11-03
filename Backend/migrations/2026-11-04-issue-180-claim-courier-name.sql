-- Issue #180: a claim is matched to a driver by the driver's name. The Claims Detail sheet's Courier column (the driver's name)
-- is kept on the claim, with its normalized form (see Backend/services/admin/driverName.js), so a claim that cannot be matched
-- on the day it is uploaded can be matched by a later report. Additive only: two nullable columns and one index. Claims stored
-- before this change have no name and are not touched.
--
-- Needs 2026-11-03-issue-141-courier-claims.sql.
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

ALTER TABLE courier_claims ADD COLUMN IF NOT EXISTS courier_name text;
ALTER TABLE courier_claims ADD COLUMN IF NOT EXISTS courier_name_key text;

-- Current claims of a city that are waiting for a name to be matched.
CREATE INDEX IF NOT EXISTS idx_courier_claims_name_key
  ON courier_claims (import_city_id, courier_name_key) WHERE superseded_at IS NULL;

-- Should list both columns.
SELECT column_name FROM information_schema.columns WHERE table_name = 'courier_claims' AND column_name IN ('courier_name', 'courier_name_key') ORDER BY 1;
