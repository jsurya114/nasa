-- Rolls back 2026-11-11-driver-contact-review.sql. Drops the case-insensitive email index and the contact_changed_at column (the holds it recorded are lost).
-- Roll back the code first: the new code reads this column.
DROP INDEX IF EXISTS drivers_email_lower_key;
ALTER TABLE drivers DROP COLUMN IF EXISTS contact_changed_at;
