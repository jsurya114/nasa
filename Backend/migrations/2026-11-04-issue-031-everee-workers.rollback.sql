-- Rollback for issue #31 part 1: removes the table that links drivers to Everee workers. Nothing else depends on it yet; no payment
-- is recorded here. Run only if no later Everee migration (payment batches) exists.
DROP TRIGGER IF EXISTS trg_everee_workers_guard ON everee_workers;
DROP FUNCTION IF EXISTS everee_workers_guard();
DROP TABLE IF EXISTS everee_workers;
