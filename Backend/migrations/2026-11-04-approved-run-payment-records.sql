-- Manual confirmation of payments made outside NASA. No money is sent by this migration or its API.
-- Apply after issue-143-pay-runs. Payment history is append-only; existing amounts are never recalculated.
CREATE TABLE IF NOT EXISTS pay_run_payment_records (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  pay_run_id bigint NOT NULL REFERENCES pay_runs(id),
  recorded_by integer NOT NULL REFERENCES admin(id),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'other')),
  reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 3 AND 200),
  selection jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pay_run_payment_items (
  payment_record_id bigint NOT NULL REFERENCES pay_run_payment_records(id),
  statement_id bigint NOT NULL UNIQUE REFERENCES pay_statements(id),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (payment_record_id, statement_id)
);
CREATE INDEX IF NOT EXISTS idx_run_payment_history ON pay_run_payment_records(pay_run_id, id);
CREATE OR REPLACE FUNCTION guard_run_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment history is permanent; record a separate correction';
END;
$$;
DROP TRIGGER IF EXISTS guard_payment_records ON pay_run_payment_records;
CREATE TRIGGER guard_payment_records BEFORE UPDATE OR DELETE ON pay_run_payment_records
  FOR EACH ROW EXECUTE FUNCTION guard_run_payment_history();
DROP TRIGGER IF EXISTS guard_payment_items ON pay_run_payment_items;
CREATE TRIGGER guard_payment_items BEFORE UPDATE OR DELETE ON pay_run_payment_items
  FOR EACH ROW EXECUTE FUNCTION guard_run_payment_history();
