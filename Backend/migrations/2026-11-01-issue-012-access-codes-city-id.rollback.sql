-- Rollback for 2026-11-01-issue-012-access-codes-city-id.sql.
-- Only run it if the code that reads city_id has not been released (or has been rolled back first):
-- dropping the column forgets which city each access code was given.
DROP INDEX IF EXISTS idx_access_codes_city_id;
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_city_id_fkey;
ALTER TABLE access_codes DROP COLUMN IF EXISTS city_id;
