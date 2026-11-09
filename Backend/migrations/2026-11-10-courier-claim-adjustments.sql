-- Courier claim refunds (issue #138): the carrier's Claims Detail sheet can hold a penalty and, later, a "Prior Period Claim Refund" for the same
-- waybill. The refund is set against the penalty when a file is read. This table REMEMBERS that, against the penalty's original facts (its claim key,
-- original amount and dates), so an older report that lists the same original penalty again can never bring the refunded amount back, and a penalty
-- that was refunded in full before NASA ever stored it stays cancelled. A carrier amendment has different original facts, so it is not affected.
--
-- Additive only: one new table, no existing table or column changes, and nothing here deducts or credits pay.
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once. Rollback: the .rollback.sql file next to this one.

CREATE TABLE IF NOT EXISTS courier_claim_adjustments (
  id               bigserial PRIMARY KEY,
  courier          text          NOT NULL CHECK (courier IN ('gofo', 'speedx')),
  claim_key        text          NOT NULL CHECK (claim_key ~ '^[0-9a-f]{64}$'),
  -- the penalty's original facts as one key: claim key + original amount + dates (see claimRules.js factsKey)
  facts_key        text          NOT NULL CHECK (facts_key ~ '^[0-9a-f]{64}$'),
  import_city_id   integer       NOT NULL REFERENCES city(id),
  original_charge  numeric(12,2) NOT NULL CHECK (original_charge < 0),
  claim_at         timestamp     NOT NULL,
  confirmed_at     timestamp,
  refunded         numeric(12,2) NOT NULL CHECK (refunded > 0),
  net              numeric(12,2) NOT NULL CHECK (net >= 0 AND net = abs(original_charge) - refunded),
  source_file      text          NOT NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  -- per city: a claim belongs to the city it was first imported for, so one city's report can never remember a refund against another city's claim
  UNIQUE (claim_key, facts_key, import_city_id)
);

-- Should list the table.
SELECT table_name FROM information_schema.tables WHERE table_name = 'courier_claim_adjustments';
