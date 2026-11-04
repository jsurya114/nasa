-- Rollback for issue #31 part 2: removes the stored webhook events. Events Everee already delivered are not re-sent after about 6.6 days,
-- so keep a copy first if they matter. Run only if no later Everee migration (payment batches) uses them.
DROP TRIGGER IF EXISTS trg_everee_webhook_events_guard ON everee_webhook_events;
DROP FUNCTION IF EXISTS everee_webhook_events_guard();
DROP TABLE IF EXISTS everee_webhook_events;
