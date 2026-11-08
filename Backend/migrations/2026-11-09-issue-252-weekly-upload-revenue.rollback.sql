-- Rollback for 2026-11-09-issue-252-weekly-upload-revenue.sql. Back up first. It removes the saved weekly imports (and the files kept in them) and the tie on
-- statements. The statements themselves, their lines, groups and audit events are not touched, and nothing in payroll or payment_dashboard is.
DROP TRIGGER IF EXISTS carrier_statement_imports_guard ON carrier_statement_imports;
DROP FUNCTION IF EXISTS carrier_statement_imports_guard();
DROP TABLE IF EXISTS carrier_statement_imports;

-- The guard as it was before this migration (it must stop reading the column that is dropped next).
CREATE OR REPLACE FUNCTION carrier_statements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'carrier statements cannot be deleted; void the statement instead';
  END IF;
  IF NEW.id <> OLD.id OR NEW.carrier <> OLD.carrier OR NEW.fleet <> OLD.fleet OR NEW.city_id <> OLD.city_id
     OR NEW.period_start <> OLD.period_start OR NEW.period_end <> OLD.period_end OR NEW.billing_week <> OLD.billing_week
     OR NEW.bill_number <> OLD.bill_number OR NEW.fingerprint <> OLD.fingerprint OR NEW.version <> OLD.version OR NEW.origin <> OLD.origin
     OR NEW.detail_fee_cents <> OLD.detail_fee_cents OR NEW.offset_cents <> OLD.offset_cents OR NEW.claims_cents <> OLD.claims_cents
     OR NEW.adjustments_cents <> OLD.adjustments_cents OR NEW.settlement_payable_cents <> OLD.settlement_payable_cents
     OR NEW.prepaid_cents <> OLD.prepaid_cents OR NEW.withdrawal_fee_cents <> OLD.withdrawal_fee_cents
     OR NEW.detail_lines <> OLD.detail_lines OR NEW.offset_lines <> OLD.offset_lines
     OR NEW.carrier_deliveries IS DISTINCT FROM OLD.carrier_deliveries OR NEW.source_label <> OLD.source_label
     OR NEW.imported_by IS DISTINCT FROM OLD.imported_by OR NEW.imported_at <> OLD.imported_at
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'carrier statement figures cannot be changed';
  END IF;
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'a voided carrier statement cannot be changed';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'a superseded carrier statement cannot be brought back';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE carrier_statements DROP COLUMN IF EXISTS source_import_id;
