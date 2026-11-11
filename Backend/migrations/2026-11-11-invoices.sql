-- Invoices module: saved vendors, invoices and their lines, so the super admin can create invoices, find earlier ones, edit an unpaid one and record
-- a payment received. Additive: three new tables, one reporting view and guards. Nothing existing changes. No money moves: "payment received" records a
-- full payment that already arrived outside NASA.
--
-- invoice_vendors  reusable billing details (name, address, optional contact, Hourly or Item-based). Editing one never rewrites a saved invoice.
-- invoices         one row per invoice: number (unique, ignoring case and spaces at the ends), type, invoice date, billing period, the vendor it was made
--                  for, a SNAPSHOT of the bill-to block, issuer, terms and template version (what is needed to draw the same invoice again), the total,
--                  status (pending or paid) and who did what when. A paid invoice can never be changed.
-- invoice_lines    the lines of an invoice, hourly (job and hours) or item-based (date, item, rate, quantity). Locked once the invoice is paid.
-- reporting.invoice_payments  paid invoices (total and payment received date) for Insights; read only.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Run as the database owner (it creates a view in the reporting schema). Safe to run more
-- than once. Rollback: the .rollback.sql file next to this one (drops the invoice tables and everything in them).

CREATE TABLE IF NOT EXISTS invoice_vendors (
  id             bigserial PRIMARY KEY,
  billing_name   text        NOT NULL CHECK (char_length(btrim(billing_name)) BETWEEN 1 AND 80),
  address_line1  text        NOT NULL DEFAULT '' CHECK (char_length(address_line1) <= 80),
  address_line2  text        NOT NULL DEFAULT '' CHECK (char_length(address_line2) <= 80),
  contact_name   text        NOT NULL DEFAULT '' CHECK (char_length(contact_name) <= 80),
  contact_email  text        NOT NULL DEFAULT '' CHECK (char_length(contact_email) <= 150),
  billing_type   text        NOT NULL CHECK (billing_type IN ('hourly', 'item')),
  created_by     integer,                          -- admin id; no foreign key, so removing an admin never removes history
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     integer,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One vendor per name, ignoring case and spaces at the ends.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_vendors_name_once ON invoice_vendors (lower(btrim(billing_name)));

CREATE TABLE IF NOT EXISTS invoices (
  id                   bigserial PRIMARY KEY,
  invoice_number       text          NOT NULL CHECK (invoice_number = btrim(invoice_number) AND char_length(invoice_number) BETWEEN 1 AND 20),
  invoice_type         text          NOT NULL CHECK (invoice_type IN ('hourly', 'item')),
  invoice_date         date          NOT NULL,     -- the date in America/Chicago when the invoice was first saved; never changes
  period_start         date          NOT NULL,
  period_end           date          NOT NULL,
  vendor_id            bigint        NOT NULL REFERENCES invoice_vendors (id),
  bill_to              jsonb         NOT NULL,     -- snapshot: { name, line1, line2, contactName, contactEmail }
  issuer               jsonb         NOT NULL,     -- snapshot: { name, addressLines, phone, emails }
  terms                text          NOT NULL,
  template_version     text          NOT NULL,
  include_signature    boolean       NOT NULL DEFAULT true,
  total                numeric(12,2) NOT NULL CHECK (total >= 0),
  status               text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  payment_received_on  date,
  payment_reference    text          CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 80),
  payment_recorded_by  integer,
  payment_recorded_at  timestamptz,
  version              integer       NOT NULL DEFAULT 1 CHECK (version >= 1),   -- bumped by every saved edit, so a stale edit is refused
  request_id           uuid          UNIQUE,       -- the browser's key for "create": a retried create returns the invoice it already made
  created_by           integer,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_by           integer,
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT invoices_period CHECK (period_start <= period_end),
  -- Paid means the payment was recorded, by someone, with a date; pending means none of that is set.
  CONSTRAINT invoices_payment_complete CHECK (
    (status = 'pending' AND payment_received_on IS NULL AND payment_reference IS NULL AND payment_recorded_by IS NULL AND payment_recorded_at IS NULL)
    OR (status = 'paid' AND payment_received_on IS NOT NULL AND payment_recorded_at IS NOT NULL))
);
-- One invoice per number, ignoring case.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_once ON invoices (upper(invoice_number));
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices (invoice_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_paid_on ON invoices (payment_received_on) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices (vendor_id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS request_id uuid UNIQUE;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           bigserial PRIMARY KEY,
  invoice_id   bigint        NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position     integer       NOT NULL CHECK (position >= 1),
  kind         text          NOT NULL CHECK (kind IN ('hourly', 'item')),
  -- hourly
  job          text          CHECK (job IS NULL OR char_length(job) <= 40),
  re_hours     numeric(10,2) CHECK (re_hours IS NULL OR re_hours >= 0),
  overtime     numeric(10,2) CHECK (overtime IS NULL OR overtime >= 0),
  total_hours  numeric(10,2) CHECK (total_hours IS NULL OR total_hours >= 0),
  -- item-based
  line_date    date,
  item         text          CHECK (item IS NULL OR char_length(item) <= 80),
  rate         numeric(12,2) CHECK (rate IS NULL OR rate >= 0),
  quantity     numeric(10,2) CHECK (quantity IS NULL OR quantity >= 0),
  -- both: the line's money (hourly: the cost as entered; item: rate x quantity rounded to cents)
  line_total   numeric(12,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (invoice_id, position),
  CONSTRAINT invoice_lines_shape CHECK (
    (kind = 'hourly' AND job IS NOT NULL AND re_hours IS NOT NULL AND overtime IS NOT NULL AND total_hours IS NOT NULL
      AND line_date IS NULL AND item IS NULL AND rate IS NULL AND quantity IS NULL)
    OR (kind = 'item' AND line_date IS NOT NULL AND item IS NOT NULL AND rate IS NOT NULL AND quantity IS NOT NULL
      AND job IS NULL AND re_hours IS NULL AND overtime IS NULL AND total_hours IS NULL
      AND line_total = round(rate * quantity, 2)))
);

-- A paid invoice is final: its row can no longer change, and neither can its lines. The only change allowed to an invoice is an edit while pending, or
-- the single move from pending to paid. Nothing is ever deleted once paid.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'paid' THEN RAISE EXCEPTION 'invoices: a paid invoice cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'invoices: a paid invoice cannot be changed';
  END IF;
  IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'invoices: the invoice date and who created it never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoices_guard ON invoices;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_guard();

CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF parent_status = 'paid' THEN
    RAISE EXCEPTION 'invoice_lines: the lines of a paid invoice cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoice_lines_guard ON invoice_lines;
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();

-- The GOFO preset the old invoice form filled in, carried forward as an editable Hourly vendor.
INSERT INTO invoice_vendors (billing_name, address_line1, address_line2, billing_type)
SELECT 'GOFO INC.', '36-47 MAIN STREET,', 'FLUSHING, NY, 11354, USA', 'hourly'
 WHERE NOT EXISTS (SELECT 1 FROM invoice_vendors WHERE lower(btrim(billing_name)) = 'gofo inc.');

-- Paid invoices for Insights: one row per invoice, counted by the date the payment was received. Pending invoices are not in it.
DO $$
BEGIN
  IF to_regnamespace('reporting') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW reporting.invoice_payments AS
      SELECT i.id AS invoice_id, i.invoice_type, i.payment_received_on, i.total
        FROM invoices i
       WHERE i.status = 'paid'
    $view$;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN
      GRANT SELECT ON reporting.invoice_payments TO nasa_reporting_reader;
    END IF;
  END IF;
END $$;

-- Should list the three tables (and the view when the reporting schema exists).
SELECT table_name FROM information_schema.tables WHERE table_name IN ('invoice_vendors', 'invoices', 'invoice_lines') ORDER BY table_name;
