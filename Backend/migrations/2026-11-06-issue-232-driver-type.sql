-- Driver type (Local or Desi) for the Drivers table and its bulk "Change" action.
--
-- Adds one nullable column. NOTHING is classified for you: every existing driver stays NULL ("Not set" on screen) until an admin
-- picks Local or Desi. We cannot tell the two apart from the data we hold, and a wrong guess would be worse than a blank.
-- The CHECK only allows LOCAL or DESI (NULL means "not set yet"). Adding a nullable column with no default is instant and
-- rewrites no rows. Safe to run more than once.
--
-- HOW TO RUN: back up the database first and run on a copy first.

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_driver_type_check') THEN
    ALTER TABLE drivers ADD CONSTRAINT drivers_driver_type_check CHECK (driver_type IN ('LOCAL', 'DESI'));
  END IF;
END
$$;
