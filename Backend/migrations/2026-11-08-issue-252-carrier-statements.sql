-- Issue #252: keep the carrier's (GOFO) weekly statement as company revenue, apart from payroll.
--
-- A statement is the carrier's bill for one fleet (one city) and one billing week; one live statement per city and week. It is the source of company revenue.
-- NASA's own driver earnings stay in payment_dashboard and are never written to by these tables. Additive only: new tables,
-- triggers and one view. Nothing existing is touched, and nothing here changes pay.
--
-- Safe to run twice. Run it in one transaction (psql --single-transaction -v ON_ERROR_STOP=1 -f ...), on a copy first, after a
-- backup. Rollback: 2026-11-08-issue-252-carrier-statements.rollback.sql

-- One row per version of a statement. A corrected statement for the same fleet and week is a NEW version that supersedes the
-- old one; the old rows stay for the audit trail. Only the status columns ever change.
CREATE TABLE IF NOT EXISTS carrier_statements (
  id                       BIGSERIAL PRIMARY KEY,
  carrier                  TEXT        NOT NULL DEFAULT 'gofo' CHECK (carrier IN ('gofo')),
  fleet                    TEXT        NOT NULL CHECK (fleet <> ''),
  city_id                  INTEGER     NOT NULL REFERENCES city (id),
  period_start             DATE        NOT NULL,          -- billing week, Monday
  period_end               DATE        NOT NULL,          -- billing week, Sunday
  billing_week             TEXT        NOT NULL CHECK (billing_week <> ''),
  bill_number              TEXT        NOT NULL CHECK (bill_number <> ''),
  currency                 TEXT        NOT NULL CHECK (currency = 'USD'),
  fingerprint              TEXT        NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  version                  INTEGER     NOT NULL CHECK (version >= 1),
  status                   TEXT        NOT NULL CHECK (status IN ('published', 'superseded', 'voided')),
  origin                   TEXT        NOT NULL DEFAULT 'upload' CHECK (origin IN ('upload', 'backfill')),
  -- Whole cents, exactly as the reconciliation computed them.
  detail_fee_cents         BIGINT      NOT NULL,
  offset_cents             BIGINT      NOT NULL,
  claims_cents             BIGINT      NOT NULL,
  adjustments_cents        BIGINT      NOT NULL,
  settlement_payable_cents BIGINT      NOT NULL,
  prepaid_cents            BIGINT      NOT NULL DEFAULT 0,
  withdrawal_fee_cents     BIGINT      NOT NULL DEFAULT 0,
  detail_lines             INTEGER     NOT NULL CHECK (detail_lines >= 0),
  offset_lines             INTEGER     NOT NULL CHECK (offset_lines >= 0),
  carrier_deliveries       INTEGER,                        -- the carrier's own count (includes offset tickets); NASA keeps its own definition
  source_label             TEXT        NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 200),
  imported_by              INTEGER,                        -- admin id; no foreign key so removing an admin never removes history
  imported_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_id            BIGINT      REFERENCES carrier_statements (id),
  superseded_at            TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,
  voided_by                INTEGER,
  void_reason              TEXT,
  CONSTRAINT carrier_statements_week CHECK (period_end = period_start + 6),
  CONSTRAINT carrier_statements_version_once UNIQUE (carrier, fleet, period_start, version),
  CONSTRAINT carrier_statements_void_complete
    CHECK ((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND status = 'voided')),
  CONSTRAINT carrier_statements_superseded_complete CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);

-- The same statement is published once. A voided one may be uploaded again as a new version.
CREATE UNIQUE INDEX IF NOT EXISTS carrier_statements_fingerprint_once
  ON carrier_statements (carrier, fingerprint) WHERE status <> 'voided';
-- At most one live statement per city and week. The grain is the verified city, not the fleet text: "TST-NLC" and "TST NLC" are the same fleet, and a
-- correction that spells it differently must still replace the old version. (An earlier draft keyed this on the fleet text; drop that index if present.)
DROP INDEX IF EXISTS carrier_statements_one_published;
CREATE UNIQUE INDEX IF NOT EXISTS carrier_statements_one_published_per_city
  ON carrier_statements (carrier, city_id, period_start) WHERE status = 'published';
CREATE UNIQUE INDEX IF NOT EXISTS carrier_statements_city_version_once
  ON carrier_statements (carrier, city_id, period_start, version);
CREATE INDEX IF NOT EXISTS idx_carrier_statements_city_period ON carrier_statements (city_id, period_start) WHERE status = 'published';

-- Every line of Details of Delivery Fees ('fee') and Offset Details ('offset'), with its sheet row.
CREATE TABLE IF NOT EXISTS carrier_statement_lines (
  statement_id BIGINT    NOT NULL REFERENCES carrier_statements (id),
  kind         TEXT      NOT NULL CHECK (kind IN ('fee', 'offset')),
  source_row   INTEGER   NOT NULL CHECK (source_row >= 2),
  waybill      TEXT,
  delivery_id  TEXT      NOT NULL CHECK (delivery_id ~ '^[0-9]+$'),
  route_code   TEXT,
  signed_on    DATE      NOT NULL,                          -- the carrier's signing day, no time zone shift
  fee_cents    BIGINT    NOT NULL,
  PRIMARY KEY (statement_id, kind, source_row)
);

-- Claims, ledger adjustments, prepayments and withdrawal fees. Kept apart from delivery revenue and from driver pay.
CREATE TABLE IF NOT EXISTS carrier_statement_items (
  statement_id BIGINT  NOT NULL REFERENCES carrier_statements (id),
  kind         TEXT    NOT NULL CHECK (kind IN ('claim', 'adjustment', 'prepaid', 'withdrawal')),
  source_row   INTEGER NOT NULL CHECK (source_row >= 2),
  delivery_id  TEXT,
  on_day       DATE,
  amount_cents BIGINT  NOT NULL,
  label        TEXT,
  PRIMARY KEY (statement_id, kind, source_row)
);

-- The matching grain: the carrier's lines for one Delivery ID, signing day and route, added up. NASA's side is added up the same
-- way before the two are joined, so neither side can multiply the other. An unmatched group stays here as UNALLOCATED revenue of
-- the statement's city: it is never dropped and never forced onto a driver.
CREATE TABLE IF NOT EXISTS carrier_statement_groups (
  statement_id         BIGINT  NOT NULL REFERENCES carrier_statements (id),
  delivery_id          TEXT    NOT NULL,
  signed_on            DATE    NOT NULL,
  route_code           TEXT    NOT NULL DEFAULT '',          -- '' when the carrier gave no route
  fee_cents            BIGINT  NOT NULL,                    -- detail fees + offsets
  fee_lines            INTEGER NOT NULL CHECK (fee_lines >= 0),
  offset_lines         INTEGER NOT NULL CHECK (offset_lines >= 0),
  match_state          TEXT    NOT NULL CHECK (match_state IN ('matched', 'no_route', 'unknown_route', 'unknown_driver', 'no_pay_group')),
  route_id             INTEGER REFERENCES routes (id),
  driver_id            INTEGER REFERENCES drivers (id),
  payment_dashboard_id INTEGER REFERENCES payment_dashboard (id),   -- the NASA row this revenue is shown on (the lowest id of the day's rows)
  nasa_driver_cents    BIGINT,                                -- NASA's gross driver earnings for the same grain when it was matched (audit only)
  matched_at           TIMESTAMPTZ,
  PRIMARY KEY (statement_id, delivery_id, signed_on, route_code),
  CONSTRAINT carrier_statement_groups_matched_consistent
    CHECK ((match_state = 'matched') = (payment_dashboard_id IS NOT NULL AND driver_id IS NOT NULL AND route_id IS NOT NULL AND matched_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_carrier_statement_groups_row ON carrier_statement_groups (payment_dashboard_id) WHERE payment_dashboard_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carrier_statement_groups_open ON carrier_statement_groups (statement_id) WHERE match_state <> 'matched';

-- Who did what, and when.
CREATE TABLE IF NOT EXISTS carrier_statement_events (
  id           BIGSERIAL   PRIMARY KEY,
  statement_id BIGINT      NOT NULL REFERENCES carrier_statements (id),
  event        TEXT        NOT NULL CHECK (event IN ('published', 'superseded', 'voided', 'rematched')),
  actor_id     INTEGER,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail       TEXT
);

-- Evidence is append-only.
CREATE OR REPLACE FUNCTION carrier_statement_evidence_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'carrier statement lines, items and events cannot be changed or deleted; void the statement instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carrier_statement_lines_guard ON carrier_statement_lines;
CREATE TRIGGER carrier_statement_lines_guard BEFORE UPDATE OR DELETE ON carrier_statement_lines
  FOR EACH ROW EXECUTE FUNCTION carrier_statement_evidence_guard();
DROP TRIGGER IF EXISTS carrier_statement_items_guard ON carrier_statement_items;
CREATE TRIGGER carrier_statement_items_guard BEFORE UPDATE OR DELETE ON carrier_statement_items
  FOR EACH ROW EXECUTE FUNCTION carrier_statement_evidence_guard();
DROP TRIGGER IF EXISTS carrier_statement_events_guard ON carrier_statement_events;
CREATE TRIGGER carrier_statement_events_guard BEFORE UPDATE OR DELETE ON carrier_statement_events
  FOR EACH ROW EXECUTE FUNCTION carrier_statement_evidence_guard();

-- A statement keeps its figures forever. Only its status can move: published -> superseded or voided, superseded -> voided never.
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

DROP TRIGGER IF EXISTS carrier_statements_guard ON carrier_statements;
CREATE TRIGGER carrier_statements_guard BEFORE UPDATE OR DELETE ON carrier_statements
  FOR EACH ROW EXECUTE FUNCTION carrier_statements_guard();

-- A group's carrier evidence never changes. An unmatched group may become matched later, when the driver, route or pay day
-- reaches NASA, and once matched it is final.
CREATE OR REPLACE FUNCTION carrier_statement_groups_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'carrier statement groups cannot be deleted; void the statement instead';
  END IF;
  IF NEW.statement_id <> OLD.statement_id OR NEW.delivery_id <> OLD.delivery_id OR NEW.signed_on <> OLD.signed_on
     OR NEW.route_code <> OLD.route_code OR NEW.fee_cents <> OLD.fee_cents OR NEW.fee_lines <> OLD.fee_lines
     OR NEW.offset_lines <> OLD.offset_lines THEN
    RAISE EXCEPTION 'carrier statement group evidence cannot be changed';
  END IF;
  IF OLD.match_state = 'matched' THEN
    RAISE EXCEPTION 'a matched carrier statement group cannot be changed';
  END IF;
  IF NEW.match_state <> 'matched' AND NEW.match_state NOT IN ('unknown_route', 'unknown_driver', 'no_pay_group') THEN
    RAISE EXCEPTION 'an unmatched carrier statement group can only be matched later';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carrier_statement_groups_guard ON carrier_statement_groups;
CREATE TRIGGER carrier_statement_groups_guard BEFORE UPDATE OR DELETE ON carrier_statement_groups
  FOR EACH ROW EXECUTE FUNCTION carrier_statement_groups_guard();

-- The statements that stand, with their matched and unallocated revenue worked out from the groups, so the two can never drift apart
-- from the figures stored on the statement.
CREATE OR REPLACE VIEW carrier_statement_totals AS
SELECT s.id AS statement_id, s.city_id, s.period_start, s.period_end, s.status,
       COALESCE(sum(g.fee_cents) FILTER (WHERE g.match_state = 'matched'), 0)::bigint  AS matched_cents,
       COALESCE(sum(g.fee_cents) FILTER (WHERE g.match_state <> 'matched'), 0)::bigint AS unallocated_cents,
       (count(g.*) FILTER (WHERE g.match_state <> 'matched'))::int                     AS unallocated_groups
  FROM carrier_statements s
  LEFT JOIN carrier_statement_groups g ON g.statement_id = s.id
 GROUP BY s.id;
