-- Issue #252: one GOFO upload. The weekly workbook the admin already uploads under File Upload -> Weekly Upload is also the carrier's statement, so it is
-- checked against its own controls and published as verified revenue by the normal weekly apply. This keeps one row per weekly upload ("the import") so the
-- statement can be tied to the exact file, retried safely and, when an owner has to decide, reviewed without uploading the file again.
--
-- Additive only: one new table, one new column and the statement guard now also keeps that column fixed. Nothing here changes pay, claims or the
-- weekly staging tables. Safe to run twice. Run it in one transaction (psql --single-transaction -v ON_ERROR_STOP=1 -f ...), on a copy first, after a backup.
-- Needs 2026-11-08-issue-252-carrier-statements.sql first. Rollback: 2026-11-09-issue-252-weekly-upload-revenue.rollback.sql

CREATE TABLE IF NOT EXISTS carrier_statement_imports (
  id                   BIGSERIAL PRIMARY KEY,
  report_hash          TEXT        NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the uploaded file: recognises a renamed copy
  source_label         TEXT        NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 200),
  uploaded_by          INTEGER,                                                        -- admin id; no foreign key so removing an admin never removes history
  uploaded_by_role     TEXT,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignment_import_id BIGINT,                                                         -- the assignment-history import of the same file, when it was saved
  -- staged: checked and waiting for the weekly apply. needs_review: an owner has to look (see reason_kind). published / already_imported: done.
  -- replaced: a newer upload took its place before it was applied. dismissed: an owner closed it without publishing.
  status               TEXT        NOT NULL CHECK (status IN ('staged', 'needs_review', 'published', 'already_imported', 'replaced', 'dismissed')),
  reason_kind          TEXT        CHECK (reason_kind IN ('check_failed', 'owner_required', 'correction', 'older_version', 'publish_failed')),
  review               JSONB,                                                          -- what the check found: reasons and the figures an owner needs. Never driver names.
  statement_id         BIGINT,                                                         -- the statement this import published (plain id, no foreign key)
  is_current           BOOLEAN     NOT NULL DEFAULT false,                             -- the import tied to the weekly data now staged
  applied_at           TIMESTAMPTZ,                                                    -- when the weekly apply consumed it
  file                 BYTEA,                                                          -- kept only while an owner may still need it; emptied once resolved
  resolved_by          INTEGER,
  resolved_at          TIMESTAMPTZ,
  resolve_reason       TEXT,
  CONSTRAINT carrier_statement_imports_file_only_while_open CHECK (status IN ('staged', 'needs_review') OR file IS NULL)
);

-- Exactly one import is tied to the weekly data that is staged right now.
CREATE UNIQUE INDEX IF NOT EXISTS carrier_statement_imports_one_current ON carrier_statement_imports ((true)) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_carrier_statement_imports_open ON carrier_statement_imports (id DESC) WHERE status IN ('staged', 'needs_review');

CREATE OR REPLACE FUNCTION carrier_statement_imports_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a carrier statement import cannot be deleted; dismiss it instead';
  END IF;
  IF NEW.id <> OLD.id OR NEW.report_hash <> OLD.report_hash OR NEW.source_label <> OLD.source_label OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_by_role IS DISTINCT FROM OLD.uploaded_by_role OR NEW.uploaded_at <> OLD.uploaded_at THEN
    RAISE EXCEPTION 'what was uploaded cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carrier_statement_imports_guard ON carrier_statement_imports;
CREATE TRIGGER carrier_statement_imports_guard BEFORE UPDATE OR DELETE ON carrier_statement_imports
  FOR EACH ROW EXECUTE FUNCTION carrier_statement_imports_guard();

-- A statement published by the weekly upload remembers the import it came from. Statements published any other way (the backfill) leave it empty.
ALTER TABLE carrier_statements ADD COLUMN IF NOT EXISTS source_import_id BIGINT;

-- The statement guard keeps that tie fixed too (the rest of the function is exactly as in 2026-11-08-issue-252-carrier-statements.sql).
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
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.source_import_id IS DISTINCT FROM OLD.source_import_id THEN
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
