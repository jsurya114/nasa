-- Issue #166: link an edited ledger entry to the entry that replaces it. An edit is one atomic action in the
-- application: the original is voided and a corrected entry is recorded; this row ties the three together with the
-- reason, the admin and the time, so the before and after can always be shown. Nothing is changed or deleted.
-- Additive only: one new table. The ledger table itself is untouched.
--
-- Rules the table enforces itself:
-- - Rows are never edited or deleted (trigger below).
-- - An entry can be edited once (unique original), and can replace only one entry (unique replacement). To change it
--   again, edit the replacement.
--
-- Needs 2026-11-03-issue-142-driver-ledger.sql.
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS driver_ledger_edits (
  id                    bigserial     PRIMARY KEY,
  request_id            uuid          NOT NULL UNIQUE,
  original_entry_id     bigint        NOT NULL UNIQUE REFERENCES driver_ledger_entries(id),
  void_entry_id         bigint        NOT NULL UNIQUE REFERENCES driver_ledger_entries(id),
  replacement_entry_id  bigint        NOT NULL UNIQUE REFERENCES driver_ledger_entries(id),
  driver_id             integer       NOT NULL REFERENCES drivers(id),
  city_id               integer       NOT NULL REFERENCES city(id),
  reason                text          NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  created_by            integer       NOT NULL REFERENCES admin(id),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  CHECK (original_entry_id <> replacement_entry_id AND original_entry_id <> void_entry_id AND void_entry_id <> replacement_entry_id)
);

CREATE OR REPLACE FUNCTION driver_ledger_edits_no_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'driver_ledger_edits rows cannot be changed or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_ledger_edits_no_change ON driver_ledger_edits;
CREATE TRIGGER trg_driver_ledger_edits_no_change
  BEFORE UPDATE OR DELETE ON driver_ledger_edits
  FOR EACH ROW EXECUTE FUNCTION driver_ledger_edits_no_change();

-- Should list the table.
SELECT to_regclass('driver_ledger_edits') AS created;
