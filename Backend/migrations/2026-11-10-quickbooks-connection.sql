-- QuickBooks Online for Desi (1099) drivers, part 1: the connection and which QuickBooks vendor each Desi driver is.
-- One connection per environment (sandbox or production): the company (realm) and its OAuth tokens, stored ENCRYPTED. One live vendor link per
-- Desi driver and environment. A driver's tax ID is never stored here: it goes straight to QuickBooks and only the fact that it was supplied is kept.
-- Additive: new tables only. Nothing existing changes.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Safe to run more than once.

CREATE TABLE IF NOT EXISTS quickbooks_connection (
  environment        text PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  realm_id           text NOT NULL CHECK (realm_id ~ '^[0-9]{5,20}$'),
  access_token_enc   text NOT NULL,
  refresh_token_enc  text NOT NULL,
  access_expires_at  timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  connected_by       integer NOT NULL REFERENCES admin(id),
  connected_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A one-time value that ties the QuickBooks sign-in redirect back to the admin who started it.
CREATE TABLE IF NOT EXISTS quickbooks_connect_state (
  state_hash  text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  admin_id    integer NOT NULL REFERENCES admin(id),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS quickbooks_vendors (
  id                  bigserial PRIMARY KEY,
  driver_id           integer NOT NULL REFERENCES drivers(id),
  environment         text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  realm_id            text NOT NULL,
  vendor_id           text NOT NULL CHECK (vendor_id ~ '^[0-9]{1,20}$'),   -- QuickBooks' own Vendor Id
  link_source         text NOT NULL CHECK (link_source IN ('existing_vendor', 'created_by_onboarding')),
  tax_id_supplied     boolean NOT NULL DEFAULT false,
  w9_certified_at     timestamptz,                                          -- when the driver certified the tax ID in the portal (new drivers only)
  vendor_1099         boolean NOT NULL DEFAULT false,
  linked_by           integer REFERENCES admin(id),                         -- empty when the driver onboarded themself
  linked_at           timestamptz NOT NULL DEFAULT now(),
  unlinked_by         integer REFERENCES admin(id),
  unlinked_at         timestamptz,
  unlink_reason       text,
  CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL)),
  CHECK (unlinked_at IS NULL OR (unlink_reason IS NOT NULL AND length(btrim(unlink_reason)) >= 3))
);
ALTER TABLE quickbooks_vendors ADD COLUMN IF NOT EXISTS w9_certified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quickbooks_vendors_driver ON quickbooks_vendors (driver_id, environment) WHERE unlinked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quickbooks_vendors_vendor ON quickbooks_vendors (realm_id, vendor_id, environment) WHERE unlinked_at IS NULL;
