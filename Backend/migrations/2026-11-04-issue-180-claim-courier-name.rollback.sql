-- Rollback for issue #180: removes the courier name from claims. Claims already matched keep their driver; only the stored
-- names (used to match later reports) are lost.
DROP INDEX IF EXISTS idx_courier_claims_name_key;
ALTER TABLE courier_claims DROP COLUMN IF EXISTS courier_name_key;
ALTER TABLE courier_claims DROP COLUMN IF EXISTS courier_name;
