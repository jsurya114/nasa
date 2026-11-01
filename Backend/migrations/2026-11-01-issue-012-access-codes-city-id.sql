-- Issue #12, access codes, step 1: add the city an access code belongs to.
-- Safe to run more than once. Nothing reads or writes the column until the next
-- pull request is released, and every existing row stays NULL ("no city yet").
-- BACK UP THE DATABASE FIRST and run on a copy before production.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS city_id integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_codes_city_id_fkey') THEN
    ALTER TABLE access_codes
      ADD CONSTRAINT access_codes_city_id_fkey FOREIGN KEY (city_id) REFERENCES city(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_access_codes_city_id ON access_codes (city_id);
