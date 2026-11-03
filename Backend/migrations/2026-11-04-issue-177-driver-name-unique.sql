-- Issue #177: driver names are unique ignoring case and extra spaces. "Sai Venkat", "sai venkat" and "Sai  Venkat" are one name,
-- and so are old names with a tab, newline or no-break space at an end or inside ("Sai Venkat" and "<tab>Sai Venkat").
-- Carrier claims name the driver only by the Courier column, so one name must mean one driver.
--
-- The existing exact UNIQUE (name) constraint stays. This adds a unique index on the normalized name. Nothing is rewritten.
--
-- If drivers already clash, this REFUSES to run and lists them: someone must decide which driver keeps the name and rename
-- the others first (renaming cascades to excel_data through its foreign key). Nothing is changed in that case.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.
-- The expression must match NAME_KEY_SQL in Backend/services/admin/driverName.js: every run of space, tab, newline, carriage return,
-- form feed, vertical tab or no-break space becomes one space, then spaces at the ends are removed, then lower case. Collapsing comes
-- first, so an edge tab is not left behind as an edge space.

DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(format('%s (ids %s)', n, ids), '; ') INTO clashes
    FROM (SELECT min(name) AS n, string_agg(id::text, ', ' ORDER BY id) AS ids
            FROM drivers
           GROUP BY lower(btrim(regexp_replace(name, '[ \t\n\r\f\v\u00a0]+', ' ', 'g'), ' '))
          HAVING count(*) > 1) d;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'driver names clash ignoring case and spaces; rename the extra drivers first: %', clashes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_name_normalized_key
  ON drivers ((lower(btrim(regexp_replace(name, '[ \t\n\r\f\v\u00a0]+', ' ', 'g'), ' '))));

-- Should list the index.
SELECT indexname FROM pg_indexes WHERE tablename = 'drivers' AND indexname = 'drivers_name_normalized_key';
