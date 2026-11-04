-- Issue #31 (Everee payments), part 4: paying a finalized pay run through Everee.
-- Adds the records that let a payment be sent safely: one batch per confirmed click, one item per pay statement (a statement can have at most
-- ONE item, for ever), a log of every attempt (written before the request is sent), a log of payout requests, and the per-city settings a live
-- payment needs. Nothing here sends money; the service does, only when payments are switched on.
-- Manual payment records (approved-run-payment-records) are separate and unchanged. Needs: issue-143 pay runs, issue-031 everee-workers.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

-- Per city: the time zone for the earning date (noon on the run's last day) and the Everee work location (tax jurisdiction). Live payments
-- are blocked for a city without both; the sandbox may use a default time zone and no work location.
CREATE TABLE IF NOT EXISTS everee_city_settings (
  city_id          integer PRIMARY KEY REFERENCES city(id),
  time_zone        text CHECK (time_zone IS NULL OR length(time_zone) BETWEEN 3 AND 64),
  work_location_id bigint CHECK (work_location_id IS NULL OR work_location_id > 0),
  updated_by       integer NOT NULL REFERENCES admin(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS everee_payment_batches (
  id                  bigserial PRIMARY KEY,
  request_id          uuid NOT NULL UNIQUE,            -- made by the confirm click: a double click or a retry returns the same batch
  pay_run_id          bigint NOT NULL REFERENCES pay_runs(id),
  city_id             integer NOT NULL REFERENCES city(id),
  environment         text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  preview_hash        text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  driver_count        integer NOT NULL CHECK (driver_count > 0),
  total               numeric(12,2) NOT NULL CHECK (total > 0),
  created_by          integer NOT NULL REFERENCES admin(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_everee_batches_run ON everee_payment_batches (pay_run_id, id);

-- One item per pay statement, ever: the same driver and statement can never be sent twice. external_id is our idempotency key at Everee
-- (made from the statement, never from a time or a random value). status mirrors pay_statements.payout_status.
CREATE TABLE IF NOT EXISTS everee_payment_items (
  id                  bigserial PRIMARY KEY,
  batch_id            bigint NOT NULL REFERENCES everee_payment_batches(id),
  pay_statement_id    bigint NOT NULL UNIQUE REFERENCES pay_statements(id),
  driver_id           integer NOT NULL REFERENCES drivers(id),
  everee_worker_id    text NOT NULL,
  external_worker_id  text,
  external_id         text NOT NULL UNIQUE CHECK (external_id ~ '^nasa-stmt-[0-9]+$'),
  amount              numeric(12,2) NOT NULL CHECK (amount > 0),
  status              text NOT NULL DEFAULT 'submitted' CHECK (status IN ('not_submitted', 'submitted', 'paid', 'failed', 'unconfirmed')),
  everee_payable_status text,                           -- what Everee last said about the payable
  everee_payment_id   text,
  payout_requested_at timestamptz,                      -- set when Everee confirmed it took the payable for payout
  deposit_returned    boolean NOT NULL DEFAULT false,
  attempts            integer NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  error_message       text CHECK (error_message IS NULL OR length(error_message) <= 500),
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_everee_items_batch ON everee_payment_items (batch_id, id);
CREATE INDEX IF NOT EXISTS idx_everee_items_open ON everee_payment_items (status) WHERE status IN ('submitted', 'unconfirmed');

-- Every attempt to create a payable at Everee. The row is written BEFORE the request is sent (finished_at empty), then completed once. A row
-- never finished means the answer is unknown (a crash or a lost reply) and is reconciled, never guessed.
CREATE TABLE IF NOT EXISTS everee_payment_attempts (
  id                  bigserial PRIMARY KEY,
  item_id             bigint NOT NULL REFERENCES everee_payment_items(id),
  attempt_no          integer NOT NULL CHECK (attempt_no > 0),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  outcome             text CHECK (outcome IN ('accepted', 'refused', 'rate_limited', 'unreachable', 'timeout', 'server_error', 'unexpected_answer')),
  http_status         integer,
  everee_request_id   text,
  error_message       text CHECK (error_message IS NULL OR length(error_message) <= 500),
  UNIQUE (item_id, attempt_no),
  CHECK ((finished_at IS NULL) = (outcome IS NULL))
);

-- Requests to Everee to pay out the payables of a batch (contractors are paid only after this call).
CREATE TABLE IF NOT EXISTS everee_payout_requests (
  id                  bigserial PRIMARY KEY,
  batch_id            bigint NOT NULL REFERENCES everee_payment_batches(id),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  asked_count         integer NOT NULL CHECK (asked_count > 0),
  taken_count         integer,
  outcome             text CHECK (outcome IN ('requested', 'nothing_to_process', 'refused', 'rate_limited', 'unreachable', 'timeout', 'server_error')),
  http_status         integer,
  everee_request_id   text,
  error_message       text CHECK (error_message IS NULL OR length(error_message) <= 500),
  CHECK ((finished_at IS NULL) = (outcome IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_everee_payout_requests_batch ON everee_payout_requests (batch_id, id);

-- Nothing here is deleted. Identity never changes. Only what happens to an item (status, attempts, errors, Everee's answers) may change, and an
-- attempt or payout request is completed once and then stays as written.
CREATE OR REPLACE FUNCTION everee_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'everee_payment_batches' THEN
    RAISE EXCEPTION 'everee_payment_batches rows cannot be changed';
  ELSIF TG_TABLE_NAME = 'everee_payment_items' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'everee_payable_status', 'everee_payment_id', 'payout_requested_at', 'deposit_returned', 'attempts', 'last_attempt_at', 'error_message', 'paid_at', 'updated_at'])
       <> (to_jsonb(OLD) - ARRAY['status', 'everee_payable_status', 'everee_payment_id', 'payout_requested_at', 'deposit_returned', 'attempts', 'last_attempt_at', 'error_message', 'paid_at', 'updated_at']) THEN
      RAISE EXCEPTION 'everee_payment_items: who is paid how much cannot be changed';
    END IF;
  ELSE -- attempts and payout requests: completed once
    IF OLD.finished_at IS NOT NULL THEN
      RAISE EXCEPTION '% rows cannot be changed once finished', TG_TABLE_NAME;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['finished_at', 'outcome', 'http_status', 'everee_request_id', 'error_message', 'taken_count'])
       <> (to_jsonb(OLD) - ARRAY['finished_at', 'outcome', 'http_status', 'everee_request_id', 'error_message', 'taken_count']) THEN
      RAISE EXCEPTION '% rows: only the result can be written', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_everee_batches_guard ON everee_payment_batches;
CREATE TRIGGER trg_everee_batches_guard BEFORE UPDATE OR DELETE ON everee_payment_batches FOR EACH ROW EXECUTE FUNCTION everee_payments_guard();
DROP TRIGGER IF EXISTS trg_everee_items_guard ON everee_payment_items;
CREATE TRIGGER trg_everee_items_guard BEFORE UPDATE OR DELETE ON everee_payment_items FOR EACH ROW EXECUTE FUNCTION everee_payments_guard();
DROP TRIGGER IF EXISTS trg_everee_attempts_guard ON everee_payment_attempts;
CREATE TRIGGER trg_everee_attempts_guard BEFORE UPDATE OR DELETE ON everee_payment_attempts FOR EACH ROW EXECUTE FUNCTION everee_payments_guard();
DROP TRIGGER IF EXISTS trg_everee_payout_requests_guard ON everee_payout_requests;
CREATE TRIGGER trg_everee_payout_requests_guard BEFORE UPDATE OR DELETE ON everee_payout_requests FOR EACH ROW EXECUTE FUNCTION everee_payments_guard();

-- Should list the five tables.
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('everee_city_settings', 'everee_payment_batches', 'everee_payment_items', 'everee_payment_attempts', 'everee_payout_requests') ORDER BY 1;
