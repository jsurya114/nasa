-- Rollback for the device token removals table: drops it. The rows only record recent removals, so nothing of
-- business value is lost. After this, registration no longer refuses a late registration (the code that reads the
-- table must be rolled back first, or it will error).
DROP TABLE IF EXISTS device_token_removals;
