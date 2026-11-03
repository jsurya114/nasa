-- Issue #140: keep the carrier's waybill -> Delivery ID -> route evidence for good.
--
-- The weekly GOFO upload used to count rows and throw the waybills away. These tables keep what a report says
-- about who carried which package, so a claim that arrives later (issue #141) can be matched to a driver and
-- to the city the package belonged to at the time. Nothing here changes pay, and nothing reads these tables
-- into pay. Additive only: three new tables and one view, no existing table is touched.
--
-- Safe to run twice. Run it in one transaction (psql --single-transaction -v ON_ERROR_STOP=1 -f ...), on a copy first,
-- after a backup. Rollback: ...issue-140-carrier-assignment-history.rollback.sql

-- One row per report file that was read. The file name is only a label; the hash of the file's bytes is what
-- recognises a renamed copy.
CREATE TABLE IF NOT EXISTS carrier_assignment_imports (
  id            BIGSERIAL PRIMARY KEY,
  carrier       TEXT        NOT NULL CHECK (carrier IN ('gofo')),
  report_hash   TEXT        NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  -- '' when the whole report was recorded. For a city admin, the cities they may use ('jobs:Name|Name'): the same
  -- file recorded by someone with a wider scope is a separate import, so it adds what the narrow one left out.
  scope_key     TEXT        NOT NULL DEFAULT '',
  source_label  TEXT        NOT NULL CHECK (char_length(source_label) BETWEEN 1 AND 200),
  imported_by   INTEGER,                       -- admin id; no foreign key so removing an admin never removes history
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_from   DATE,
  signed_to     DATE,
  fee_rows      INTEGER     NOT NULL DEFAULT 0 CHECK (fee_rows >= 0),
  offset_rows   INTEGER     NOT NULL DEFAULT 0 CHECK (offset_rows >= 0),
  recorded_rows INTEGER     NOT NULL DEFAULT 0 CHECK (recorded_rows >= 0),   -- assignments this file added
  known_rows    INTEGER     NOT NULL DEFAULT 0 CHECK (known_rows >= 0),      -- assignments an earlier file already held
  problem_rows  INTEGER     NOT NULL DEFAULT 0 CHECK (problem_rows >= 0),    -- rows without a usable waybill or Delivery ID
  skipped_rows  INTEGER     NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),    -- rows left out because the admin may not use their city
  voided_at     TIMESTAMPTZ,
  voided_by     INTEGER,
  void_reason   TEXT,
  CONSTRAINT carrier_assignment_imports_void_complete
    CHECK ((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT carrier_assignment_imports_report_once UNIQUE (carrier, report_hash, scope_key)
);

-- One row per distinct fact "this waybill was assigned to this Delivery ID on this route on this day".
-- The same fact in a renamed, reordered or overlapping report is the same row. Two different Delivery IDs for
-- one waybill are two rows: a conflict is kept, never settled by picking the first.
CREATE TABLE IF NOT EXISTS carrier_package_assignments (
  id                   BIGSERIAL PRIMARY KEY,
  carrier              TEXT        NOT NULL CHECK (carrier IN ('gofo')),
  identity_hash        TEXT        NOT NULL CHECK (identity_hash ~ '^[0-9a-f]{64}$'),
  waybill              TEXT        NOT NULL CHECK (waybill <> ''),            -- as written in the report (trimmed)
  waybill_key          TEXT        NOT NULL CHECK (waybill_key <> ''),        -- upper case, no spaces: how claims find it
  external_delivery_id TEXT        NOT NULL CHECK (external_delivery_id <> ''), -- the carrier's Delivery ID, exact text
  id_form              TEXT        NOT NULL CHECK (id_form IN ('canonical', 'unusable')),
  route_code           TEXT,                                                   -- the report's Region/route, as written
  signed_at            TIMESTAMP,                                              -- the carrier's own clock, no zone
  signed_on            DATE,
  -- Filled in by NASA from the evidence above and then frozen. The driver's current city is never used.
  driver_state         TEXT        NOT NULL CHECK (driver_state IN ('resolved', 'unknown_driver', 'unusable_id')),
  driver_id            INTEGER     REFERENCES drivers (id),
  route_state          TEXT        NOT NULL CHECK (route_state IN ('resolved', 'unknown_route', 'no_route')),
  route_id             INTEGER     REFERENCES routes (id),
  city_id              INTEGER     REFERENCES city (id),
  first_import_id      BIGINT      NOT NULL REFERENCES carrier_assignment_imports (id),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  driver_resolved_at   TIMESTAMPTZ,                                            -- when the Delivery ID was linked to the driver
  route_resolved_at    TIMESTAMPTZ,                                            -- when the route was linked to its city
  CONSTRAINT carrier_package_assignments_identity UNIQUE (identity_hash),
  CONSTRAINT carrier_package_assignments_driver_consistent
    CHECK ((driver_state = 'resolved') = (driver_id IS NOT NULL)),
  CONSTRAINT carrier_package_assignments_route_consistent
    CHECK ((route_state = 'resolved') = (route_id IS NOT NULL AND city_id IS NOT NULL)),
  CONSTRAINT carrier_package_assignments_unusable_id
    CHECK ((id_form = 'unusable') = (driver_state = 'unusable_id'))
);

-- Where each fact was seen: which report, which sheet, which row. A fact seen in two reports has two rows.
CREATE TABLE IF NOT EXISTS carrier_assignment_sightings (
  assignment_id BIGINT  NOT NULL REFERENCES carrier_package_assignments (id),
  import_id     BIGINT  NOT NULL REFERENCES carrier_assignment_imports (id),
  source_sheet  TEXT    NOT NULL CHECK (source_sheet IN ('fee_details', 'offset_details')),
  source_row    INTEGER NOT NULL CHECK (source_row >= 2),
  PRIMARY KEY (assignment_id, import_id, source_sheet)
);

CREATE INDEX IF NOT EXISTS idx_carrier_assignments_waybill
  ON carrier_package_assignments (carrier, waybill_key);
CREATE INDEX IF NOT EXISTS idx_carrier_assignments_open
  ON carrier_package_assignments (id) WHERE driver_state <> 'resolved' OR route_state <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_carrier_sightings_import
  ON carrier_assignment_sightings (import_id);

-- History is append-only. The evidence columns never change. Driver, route and city may be filled in later,
-- when the driver or route is added to NASA, and once filled in they are final.
CREATE OR REPLACE FUNCTION carrier_package_assignments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'carrier assignment history cannot be deleted; void the import instead';
  END IF;
  IF NEW.id <> OLD.id OR NEW.carrier <> OLD.carrier OR NEW.identity_hash <> OLD.identity_hash
     OR NEW.waybill <> OLD.waybill OR NEW.waybill_key <> OLD.waybill_key
     OR NEW.external_delivery_id <> OLD.external_delivery_id OR NEW.id_form <> OLD.id_form
     OR NEW.route_code IS DISTINCT FROM OLD.route_code OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.signed_on IS DISTINCT FROM OLD.signed_on OR NEW.first_import_id <> OLD.first_import_id
     OR NEW.recorded_at <> OLD.recorded_at THEN
    RAISE EXCEPTION 'carrier assignment evidence cannot be changed';
  END IF;
  IF OLD.driver_state = 'resolved' AND (NEW.driver_state <> OLD.driver_state OR NEW.driver_id <> OLD.driver_id OR NEW.driver_resolved_at IS DISTINCT FROM OLD.driver_resolved_at) THEN
    RAISE EXCEPTION 'a resolved driver on carrier assignment history cannot be changed';
  END IF;
  IF OLD.route_state = 'resolved' AND (NEW.route_state <> OLD.route_state OR NEW.route_id <> OLD.route_id OR NEW.city_id <> OLD.city_id OR NEW.route_resolved_at IS DISTINCT FROM OLD.route_resolved_at) THEN
    RAISE EXCEPTION 'a resolved route and city on carrier assignment history cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carrier_package_assignments_guard ON carrier_package_assignments;
CREATE TRIGGER carrier_package_assignments_guard
  BEFORE UPDATE OR DELETE ON carrier_package_assignments
  FOR EACH ROW EXECUTE FUNCTION carrier_package_assignments_guard();

CREATE OR REPLACE FUNCTION carrier_assignment_sightings_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'carrier assignment sightings cannot be changed or deleted; void the import instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carrier_assignment_sightings_guard ON carrier_assignment_sightings;
CREATE TRIGGER carrier_assignment_sightings_guard
  BEFORE UPDATE OR DELETE ON carrier_assignment_sightings
  FOR EACH ROW EXECUTE FUNCTION carrier_assignment_sightings_guard();

-- An import can be voided (with a reason) but never edited or deleted. Only the void columns may change.
CREATE OR REPLACE FUNCTION carrier_assignment_imports_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'carrier assignment imports cannot be deleted; void the import instead';
  END IF;
  IF OLD.voided_at IS NOT NULL AND (NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.void_reason IS DISTINCT FROM OLD.void_reason OR NEW.voided_by IS DISTINCT FROM OLD.voided_by) THEN
    RAISE EXCEPTION 'a voided carrier assignment import cannot be changed';
  END IF;
  IF NEW.id <> OLD.id OR NEW.carrier <> OLD.carrier OR NEW.report_hash <> OLD.report_hash OR NEW.scope_key <> OLD.scope_key
     OR NEW.source_label <> OLD.source_label OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
     OR NEW.imported_at <> OLD.imported_at THEN
    RAISE EXCEPTION 'carrier assignment import details cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carrier_assignment_imports_guard ON carrier_assignment_imports;
CREATE TRIGGER carrier_assignment_imports_guard
  BEFORE UPDATE OR DELETE ON carrier_assignment_imports
  FOR EACH ROW EXECUTE FUNCTION carrier_assignment_imports_guard();

-- The facts that still stand: seen in at least one report that has not been voided.
CREATE OR REPLACE VIEW carrier_package_assignments_live AS
SELECT a.*
  FROM carrier_package_assignments a
 WHERE EXISTS (
         SELECT 1
           FROM carrier_assignment_sightings s
           JOIN carrier_assignment_imports i ON i.id = s.import_id
          WHERE s.assignment_id = a.id AND i.voided_at IS NULL
       );

