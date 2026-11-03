-- Issue #177: driver names are unique ignoring case and extra spaces. "Sai Venkat", "sai venkat" and "Sai  Venkat" are one name.
-- Carrier claims name the driver only by the Courier column, so one name must mean one driver.
--
-- The existing exact UNIQUE (name) constraint stays. This adds a unique index on the normalized name. Nothing is rewritten.
--
-- If drivers already clash, this REFUSES to run and lists them: someone must decide which driver keeps the name and rename
-- the others first (renaming cascades to excel_data through its foreign key). Nothing is changed in that case.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.
-- The expression must match NAME_KEY_SQL in Backend/services/admin/driverName.js.

DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(format('%s (ids %s)', n, ids), '; ') INTO clashes
    FROM (SELECT min(name) AS n, string_agg(id::text, ', ' ORDER BY id) AS ids
            FROM drivers
           GROUP BY lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
          HAVING count(*) > 1) d;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'driver names clash ignoring case and spaces; rename the extra drivers first: %', clashes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_name_normalized_key
  ON drivers ((lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))));

-- Should list the index.
SELECT indexname FROM pg_indexes WHERE tablename = 'drivers' AND indexname = 'drivers_name_normalized_key';
