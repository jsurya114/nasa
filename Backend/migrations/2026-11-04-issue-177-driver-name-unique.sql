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
-- form feed, vertical tab or no-break space becomes one space, then spaces at the ends are removed (collapsing comes first, so an edge
-- tab is not left behind as an edge space), then Unicode normal form NFC, then lower case using the ICU collation "und-x-icu".
-- That collation is named on purpose: plain lower() follows the database locale and, under the C locale, leaves accented capitals
-- ("Émile") unchanged, so two names differing only by an accented capital would not clash. The check below stops with a clear
-- message if the database cannot do this (it needs UTF8 and the ICU collation).

DO $$
DECLARE
  clashes text;
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'driver name uniqueness needs a UTF8 database (this one is %)', current_setting('server_encoding');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') THEN
    RAISE EXCEPTION 'driver name uniqueness needs the ICU collation und-x-icu, which this PostgreSQL does not have';
  END IF;
  SELECT string_agg(format('%s (ids %s)', n, ids), '; ') INTO clashes
    FROM (SELECT min(name) AS n, string_agg(id::text, ', ' ORDER BY id) AS ids
            FROM drivers
           GROUP BY lower((normalize(btrim(regexp_replace(name, '[ \t\n\r\f\v\u00a0]+', ' ', 'g'), ' '), NFC)) COLLATE "und-x-icu")
          HAVING count(*) > 1) d;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'driver names clash ignoring case and spaces; rename the extra drivers first: %', clashes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_name_normalized_key
  ON drivers ((lower((normalize(btrim(regexp_replace(name, '[ \t\n\r\f\v\u00a0]+', ' ', 'g'), ' '), NFC)) COLLATE "und-x-icu")));

-- Should list the index.
SELECT indexname FROM pg_indexes WHERE tablename = 'drivers' AND indexname = 'drivers_name_normalized_key';
