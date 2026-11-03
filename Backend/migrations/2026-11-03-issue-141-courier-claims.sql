-- Issue #141, courier claims, part 2: where imported claims and their match results are kept.
-- Additive only: two new tables, no existing table or column changes, and nothing here deducts pay.
--
-- courier_claims         the carrier's facts, exactly as imported. Rows are never edited: a changed amount
--                        arrives as a new version, and the old version is marked superseded.
-- courier_claim_matches  what NASA worked out from delivery history: who owes the claim, in which city,
--                        and whether it is chargeable, exempt, unresolved or ambiguous. Kept apart from the
--                        facts so a later rematch never touches the evidence.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.
-- Plain "psql -f" works.

CREATE TABLE IF NOT EXISTS courier_claims (
  id               bigserial PRIMARY KEY,
  courier          text          NOT NULL CHECK (courier IN ('gofo', 'speedx')),
  claim_key        text          NOT NULL CHECK (claim_key ~ '^[0-9a-f]{64}$'),
  version          integer       NOT NULL CHECK (version >= 1),
  waybill          text          NOT NULL CHECK (waybill <> ''),
  claim_type       text          NOT NULL CHECK (claim_type <> ''),
  claim_type_key   text          NOT NULL CHECK (claim_type_key <> ''),
  claim_at         timestamp     NOT NULL,          -- the carrier's "date", in the carrier's own clock
  confirmed_at     timestamp,                       -- the carrier's "Confirm date."
  original_charge  numeric(12,2) NOT NULL CHECK (original_charge <> 0),
  deduction_amount numeric(12,2) NOT NULL CHECK (deduction_amount = abs(original_charge)),
  declared_value   numeric(12,2),                   -- evidence only, never used for the deduction
  remarks          text,
  import_city_id   integer       NOT NULL REFERENCES city(id),
  source_file      text          NOT NULL,
  source_sheet     text          NOT NULL,
  source_row       integer       NOT NULL CHECK (source_row > 0),
  imported_by      integer,
  imported_at      timestamptz   NOT NULL DEFAULT now(),
  superseded_at    timestamptz,
  UNIQUE (claim_key, version)
);

-- At most one current version of each claim.
CREATE UNIQUE INDEX IF NOT EXISTS uq_courier_claims_current
  ON courier_claims (claim_key)
  WHERE superseded_at IS NULL;

-- Rematching looks claims up by waybill.
CREATE INDEX IF NOT EXISTS idx_courier_claims_waybill ON courier_claims (courier, waybill);

CREATE TABLE IF NOT EXISTS courier_claim_matches (
  claim_id            bigint        PRIMARY KEY REFERENCES courier_claims(id),
  -- review: held, never deducted, because a hand-entered claim (#142) already covers the same waybill and claim type.
  status              text          NOT NULL CHECK (status IN ('unresolved', 'ambiguous', 'chargeable', 'exempt', 'review')),
  driver_id           integer       REFERENCES drivers(id),
  city_id             integer       REFERENCES city(id),
  carrier_delivery_id text,
  route_id            integer,
  journey_date        date,
  eligible_deduction  numeric(12,2),
  reason              text          NOT NULL,
  rule_version        text          NOT NULL,
  matched_at          timestamptz   NOT NULL DEFAULT now(),
  -- Only a matched claim names a driver and city, and only a chargeable one carries a deduction.
  CHECK (
    (status = 'chargeable' AND driver_id IS NOT NULL AND city_id IS NOT NULL AND eligible_deduction > 0)
    OR (status = 'exempt' AND driver_id IS NOT NULL AND city_id IS NOT NULL AND eligible_deduction = 0)
    OR (status IN ('unresolved', 'ambiguous', 'review') AND driver_id IS NULL AND city_id IS NULL AND eligible_deduction IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_courier_claim_matches_open
  ON courier_claim_matches (status)
  WHERE status IN ('unresolved', 'ambiguous');

CREATE INDEX IF NOT EXISTS idx_courier_claim_matches_driver ON courier_claim_matches (driver_id);

-- Should list both tables.
SELECT table_name FROM information_schema.tables
 WHERE table_name IN ('courier_claims', 'courier_claim_matches') ORDER BY table_name;
