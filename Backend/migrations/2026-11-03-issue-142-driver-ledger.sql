-- Issue #142: a ledger for manual driver money entries (advances, advance repayments, expenses,
-- reimbursements, manual claims and corrections). Additive only: one new table, its trigger and indexes.
-- Nothing here pays or deducts anything. Applying entries to a pay run, exactly once, is issue #143.
--
-- Rules the table enforces itself:
-- - Entries are never edited or deleted (trigger below). A mistake is undone by a later "void" entry that
--   reverses it, and each entry can be voided at most once.
-- - "debit" means the driver owes NASA more; "credit" means the driver owes less, or NASA owes the driver.
-- - A repeated submission of the same form (same request_id) can never create a second entry.
--
-- Needs the courier claims tables from 2026-11-03-issue-141-courier-claims.sql only for the application's
-- duplicate-claim check, not for this file.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS driver_ledger_entries (
  id                         bigserial     PRIMARY KEY,
  request_id                 uuid          NOT NULL UNIQUE,
  driver_id                  integer       NOT NULL REFERENCES drivers(id),
  city_id                    integer       NOT NULL REFERENCES city(id),
  entry_type                 text          NOT NULL CHECK (entry_type IN
                               ('advance', 'advance_repayment', 'expense', 'reimbursement', 'manual_claim', 'correction', 'void')),
  direction                  text          NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount                     numeric(12,2) NOT NULL CHECK (amount > 0),
  reason                     text          NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  effective_date             date          NOT NULL,
  intended_payday            date,
  disbursed_outside_payroll  boolean       NOT NULL DEFAULT false,
  -- How a debit is recovered from pay (issue #143): all on the next payday, or fixed instalments. NULL means no
  -- arrangement was recorded: the entry is flagged for review and never recovered automatically.
  recovery_plan              text          CHECK (recovery_plan IN ('full_next_payday', 'installments')),
  installment_amount         numeric(12,2),
  claim_type                 text,
  waybill                    text,
  exempt                     boolean       NOT NULL DEFAULT false,
  voids_entry_id             bigint        UNIQUE REFERENCES driver_ledger_entries(id),
  created_by                 integer       NOT NULL REFERENCES admin(id),
  created_at                 timestamptz   NOT NULL DEFAULT now(),
  CHECK (disbursed_outside_payroll = false OR entry_type = 'advance'),
  CHECK (recovery_plan IS NULL OR (direction = 'debit' AND entry_type <> 'void')),
  CHECK ((recovery_plan = 'installments') = (installment_amount IS NOT NULL)),
  CHECK (installment_amount IS NULL OR (installment_amount > 0 AND installment_amount < amount)),
  CHECK ((entry_type = 'manual_claim') = (claim_type IS NOT NULL)),
  CHECK (exempt = false OR entry_type = 'manual_claim'),
  CHECK ((entry_type = 'void') = (voids_entry_id IS NOT NULL)),
  CHECK (voids_entry_id IS NULL OR voids_entry_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_driver_ledger_driver ON driver_ledger_entries (driver_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_driver_ledger_city ON driver_ledger_entries (city_id, effective_date);

-- Entries are history: no edits, no deletes.
CREATE OR REPLACE FUNCTION driver_ledger_entries_no_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'driver_ledger_entries rows cannot be changed or deleted; add a void or correction entry';
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_ledger_entries_no_change ON driver_ledger_entries;
CREATE TRIGGER trg_driver_ledger_entries_no_change
  BEFORE UPDATE OR DELETE ON driver_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION driver_ledger_entries_no_change();

-- Should list the table.
SELECT to_regclass('driver_ledger_entries') AS created;
