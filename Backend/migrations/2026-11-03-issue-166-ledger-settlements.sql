-- Issue #166: settle a ledger debit without payroll. Two ways an admin can clear all or part of one
-- entry outside the pay run: the driver repaid it ("outside_repayment", with a payment reference) or NASA
-- waived it ("waiver"). A mistaken settlement is undone by a later "reversal" row, never by editing.
-- Additive only: one new table, its trigger and indexes. Nothing is paid or deducted by this file.
--
-- Rules the table enforces itself:
-- - Rows are never edited or deleted (trigger below).
-- - Every row names the exact ledger entry it settles, so it cannot also be recovered through payroll:
--   the application subtracts it from what the entry still owes before any pay run recovers from it.
-- - A repayment carries a payment reference; every row carries a reason, the admin who made it and a time.
-- - A reversal points at one settlement, once.
--
-- Needs 2026-11-03-issue-142-driver-ledger.sql.
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS driver_ledger_settlements (
  id                      bigserial     PRIMARY KEY,
  request_id              uuid          NOT NULL UNIQUE,
  entry_id                bigint        NOT NULL REFERENCES driver_ledger_entries(id),
  driver_id               integer       NOT NULL REFERENCES drivers(id),
  city_id                 integer       NOT NULL REFERENCES city(id),
  kind                    text          NOT NULL CHECK (kind IN ('outside_repayment', 'waiver', 'reversal')),
  amount                  numeric(12,2) NOT NULL CHECK (amount > 0),
  settled_on              date          NOT NULL,
  reference               text,
  reason                  text          NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  reverses_settlement_id  bigint        UNIQUE REFERENCES driver_ledger_settlements(id),
  created_by              integer       NOT NULL REFERENCES admin(id),
  created_at              timestamptz   NOT NULL DEFAULT now(),
  CHECK (kind <> 'outside_repayment' OR char_length(btrim(COALESCE(reference, ''))) BETWEEN 3 AND 200),
  CHECK (reference IS NULL OR kind = 'outside_repayment'),
  CHECK ((kind = 'reversal') = (reverses_settlement_id IS NOT NULL)),
  CHECK (reverses_settlement_id IS NULL OR reverses_settlement_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_settlements_entry ON driver_ledger_settlements (entry_id);
CREATE INDEX IF NOT EXISTS idx_ledger_settlements_driver ON driver_ledger_settlements (driver_id, settled_on);

CREATE OR REPLACE FUNCTION driver_ledger_settlements_no_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'driver_ledger_settlements rows cannot be changed or deleted; add a reversal';
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_ledger_settlements_no_change ON driver_ledger_settlements;
CREATE TRIGGER trg_driver_ledger_settlements_no_change
  BEFORE UPDATE OR DELETE ON driver_ledger_settlements
  FOR EACH ROW EXECUTE FUNCTION driver_ledger_settlements_no_change();

-- Should list the table.
SELECT to_regclass('driver_ledger_settlements') AS created;
