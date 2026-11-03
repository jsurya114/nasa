-- Rollback for issue #141 (courier claims): removes both tables.
-- BACK UP FIRST if claims were imported: this deletes the imported claim evidence and match results.
-- Nothing else reads these tables until the pay-run work (#143) ships; if it has, roll that back first.
DROP TABLE IF EXISTS courier_claim_matches;
DROP TABLE IF EXISTS courier_claims;
