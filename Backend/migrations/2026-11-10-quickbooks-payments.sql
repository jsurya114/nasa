-- QuickBooks for Desi (1099) drivers, part 3: paying a finalized pay run by recording each driver's bill and bill payment in QuickBooks.
-- Adds the records that let it be done safely: the expense and bank accounts to use, one batch per confirmed click, one item per pay statement
-- (a statement can have at most ONE item, for ever), and a log of every attempt written before the request is sent. Nothing here calls QuickBooks;
-- the service does, and only when QUICKBOOKS_PAYMENTS_ENABLED is true. Needs: part 1 (quickbooks-connection), issue-143 pay runs.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS quickbooks_settings (
  environment        text PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  expense_account_id text NOT NULL CHECK (expense_account_id ~ '^[0-9]{1,20}$'),   -- where the driver pay is booked
  bank_account_id    text NOT NULL CHECK (bank_account_id ~ '^[0-9]{1,20}$'),      -- the account the payment is recorded from
  updated_by         integer NOT NULL REFERENCES admin(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quickbooks_payment_batches (
  id            bigserial PRIMARY KEY,
  request_id    uuid NOT NULL UNIQUE,                 -- made by the confirm click: a double click or a retry returns the same batch
  pay_run_id    bigint NOT NULL REFERENCES pay_runs(id),
  city_id       integer NOT NULL REFERENCES city(id),
  environment   text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  realm_id      text NOT NULL,
  preview_hash  text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  paid_on       date NOT NULL,
  driver_count  integer NOT NULL CHECK (driver_count > 0),
  total         numeric(12,2) NOT NULL CHECK (total > 0),
  created_by    integer NOT NULL REFERENCES admin(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quickbooks_batches_run ON quickbooks_payment_batches (pay_run_id, id);

-- One item per pay statement, ever. doc_number is the bill's number in QuickBooks and our idempotency key: before a bill is made QuickBooks is
-- asked for one with this number, so a retry can never make a second bill. status mirrors pay_statements.payout_status.
CREATE TABLE IF NOT EXISTS quickbooks_payment_items (
  id                 bigserial PRIMARY KEY,
  batch_id           bigint NOT NULL REFERENCES quickbooks_payment_batches(id),
  pay_statement_id   bigint NOT NULL UNIQUE REFERENCES pay_statements(id),
  driver_id          integer NOT NULL REFERENCES drivers(id),
  driver_type        text,
  vendor_id          text NOT NULL,
  doc_number         text NOT NULL UNIQUE CHECK (doc_number ~ '^NASA-S[0-9]+$'),
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  status             text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'paid', 'failed', 'unconfirmed')),
  bill_id            text,
  bill_payment_id    text,
  attempts           integer NOT NULL DEFAULT 0,
  last_attempt_at    timestamptz,
  error_message      text CHECK (error_message IS NULL OR length(error_message) <= 500),
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quickbooks_items_batch ON quickbooks_payment_items (batch_id, id);
CREATE INDEX IF NOT EXISTS idx_quickbooks_items_open ON quickbooks_payment_items (status) WHERE status IN ('submitted', 'unconfirmed');

-- Every attempt. Written BEFORE the request is sent (finished_at empty), then completed once. One never finished means the answer is unknown
-- (a crash or a lost reply) and is reconciled by asking QuickBooks, never guessed.
CREATE TABLE IF NOT EXISTS quickbooks_payment_attempts (
  id            bigserial PRIMARY KEY,
  item_id       bigint NOT NULL REFERENCES quickbooks_payment_items(id),
  attempt_no    integer NOT NULL CHECK (attempt_no > 0),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  outcome       text CHECK (outcome IN ('paid', 'refused', 'rate_limited', 'unreachable', 'timeout', 'server_error', 'unexpected_answer')),
  http_status   integer,
  intuit_tid    text,
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 500),
  UNIQUE (item_id, attempt_no),
  CHECK ((finished_at IS NULL) = (outcome IS NULL))
);
