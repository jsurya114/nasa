-- Issue #143: pay runs, frozen statements and the recovery limit setting. Additive only: new tables, triggers and
-- indexes. No existing table or column changes, and nothing here marks pay rows paid or sends money (#31, #144).
-- Needs the #141 claims and #142 ledger migrations first.
--
-- payroll_settings          business settings for payroll. "recovery_limit" starts NULL: not confirmed with the
--                           client, so nothing is recovered automatically until a super admin sets it.
-- payroll_settings_history  every change to a setting: who, when, old and new value.
-- pay_runs                  one city, one period, daily or weekly: draft -> finalized, or discarded / voided.
-- pay_statements            one per driver per run, with the totals worked out by payCalculator.js.
-- pay_statement_lines       each earning, insurance, reimbursement, claim and recovery on a statement. A line is
--                           "active" while its run is a draft or finalized; discarding or voiding a run releases it.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS payroll_settings (
  key         text        PRIMARY KEY CHECK (key IN ('recovery_limit')),
  value       jsonb,
  changed_by  integer     REFERENCES admin(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payroll_settings (key, value) VALUES ('recovery_limit', NULL) ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS payroll_settings_history (
  id          bigserial   PRIMARY KEY,
  key         text        NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  reason      text        NOT NULL,
  changed_by  integer     NOT NULL REFERENCES admin(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pay_runs (
  id              bigserial   PRIMARY KEY,
  request_id      uuid        NOT NULL UNIQUE,
  city_id         integer     NOT NULL REFERENCES city(id),
  period_start    date        NOT NULL,
  period_end      date        NOT NULL CHECK (period_end >= period_start),
  data_type       text        NOT NULL CHECK (data_type IN ('daily', 'weekly')),
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'discarded', 'voided')),
  recovery_limit  jsonb,                               -- the setting as it was when the run was made
  created_by      integer     NOT NULL REFERENCES admin(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  finalized_by    integer     REFERENCES admin(id),
  finalized_at    timestamptz,
  closed_by       integer     REFERENCES admin(id),     -- who discarded or voided it
  closed_at       timestamptz,
  close_reason    text,
  CHECK ((status = 'finalized') = (finalized_at IS NOT NULL) OR status = 'voided'),
  CHECK ((status IN ('discarded', 'voided')) = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_pay_runs_city ON pay_runs (city_id, period_start);

CREATE TABLE IF NOT EXISTS pay_statements (
  id                bigserial     PRIMARY KEY,
  pay_run_id        bigint        NOT NULL REFERENCES pay_runs(id),
  driver_id         integer       NOT NULL REFERENCES drivers(id),
  gross             numeric(12,2) NOT NULL,
  insurance         numeric(12,2) NOT NULL,
  reimbursements    numeric(12,2) NOT NULL,
  claim_deductions  numeric(12,2) NOT NULL,
  recoveries        numeric(12,2) NOT NULL,
  net               numeric(12,2) NOT NULL,
  carried_forward   numeric(12,2) NOT NULL,
  flags             jsonb         NOT NULL DEFAULT '[]',
  -- Filled by the payout work (#31). A timeout is "unconfirmed", never "failed", until reconciled.
  payout_status     text          NOT NULL DEFAULT 'not_submitted'
                    CHECK (payout_status IN ('not_submitted', 'submitted', 'paid', 'failed', 'unconfirmed')),
  payout_reference  text,
  paid_at           timestamptz,
  UNIQUE (pay_run_id, driver_id),
  CHECK (net = gross - insurance + reimbursements - claim_deductions - recoveries)
);

CREATE TABLE IF NOT EXISTS pay_statement_lines (
  id                    bigserial     PRIMARY KEY,
  statement_id          bigint        NOT NULL REFERENCES pay_statements(id),
  line_type             text          NOT NULL CHECK (line_type IN ('earning', 'insurance', 'reimbursement', 'claim', 'recovery')),
  amount                numeric(12,2) NOT NULL,
  payment_dashboard_id  integer       REFERENCES payment_dashboard(id),
  claim_id              bigint        REFERENCES courier_claims(id),
  ledger_entry_id       bigint        REFERENCES driver_ledger_entries(id),
  journey_date          date,
  active                boolean       NOT NULL DEFAULT true,
  CHECK (line_type NOT IN ('earning', 'insurance') OR payment_dashboard_id IS NOT NULL),
  CHECK (line_type <> 'claim' OR (claim_id IS NOT NULL AND amount < 0)),
  CHECK (line_type <> 'recovery' OR (ledger_entry_id IS NOT NULL AND amount < 0)),
  CHECK (line_type <> 'reimbursement' OR (ledger_entry_id IS NOT NULL AND amount > 0))
);
CREATE INDEX IF NOT EXISTS idx_pay_lines_statement ON pay_statement_lines (statement_id);
CREATE INDEX IF NOT EXISTS idx_pay_lines_claim ON pay_statement_lines (claim_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_pay_lines_ledger ON pay_statement_lines (ledger_entry_id) WHERE active;

-- Exactly once: a pay row is earned on one live statement only, and a reimbursement is paid once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_lines_earning ON pay_statement_lines (payment_dashboard_id) WHERE active AND line_type = 'earning';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pay_lines_reimbursement ON pay_statement_lines (ledger_entry_id) WHERE active AND line_type = 'reimbursement';

-- Lines are history: the only change allowed is releasing one (active true -> false) when its run is discarded or voided.
CREATE OR REPLACE FUNCTION pay_statement_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pay_statement_lines rows cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'active') <> (to_jsonb(OLD) - 'active') OR (OLD.active = false AND NEW.active = true) THEN
    RAISE EXCEPTION 'pay_statement_lines rows cannot be changed; only a live line can be released';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pay_statement_lines_guard ON pay_statement_lines;
CREATE TRIGGER trg_pay_statement_lines_guard BEFORE UPDATE OR DELETE ON pay_statement_lines
  FOR EACH ROW EXECUTE FUNCTION pay_statement_lines_guard();

-- Statement amounts are frozen; only the payout fields (#31) may change.
CREATE OR REPLACE FUNCTION pay_statements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pay_statements rows cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['payout_status', 'payout_reference', 'paid_at']) <> (to_jsonb(OLD) - ARRAY['payout_status', 'payout_reference', 'paid_at']) THEN
    RAISE EXCEPTION 'pay_statements amounts cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_pay_statements_guard ON pay_statements;
CREATE TRIGGER trg_pay_statements_guard BEFORE UPDATE OR DELETE ON pay_statements
  FOR EACH ROW EXECUTE FUNCTION pay_statements_guard();

-- Should list five tables.
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('payroll_settings', 'payroll_settings_history', 'pay_runs', 'pay_statements', 'pay_statement_lines')
 ORDER BY table_name;
