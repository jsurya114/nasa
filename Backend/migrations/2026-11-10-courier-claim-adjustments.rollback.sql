-- Rolls back 2026-11-10-courier-claim-adjustments.sql. Refunds already set against stored claims stay as they are (those are superseded versions);
-- only the memory is dropped, so an older report could then bring a refunded amount back.
DROP TABLE IF EXISTS courier_claim_adjustments;
ALTER TABLE courier_claims DROP COLUMN IF EXISTS origin_facts_key;
