-- Rollback for issue #22 (device tokens): removes the table. The only data in it is push tokens, which
-- phones register again the next time the app starts, so nothing of business value is lost.
DROP TABLE IF EXISTS device_tokens;
