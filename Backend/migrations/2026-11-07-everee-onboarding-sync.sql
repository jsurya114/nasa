-- Issue #242: durable retry scheduling. No worker, driver or payment history is changed.
-- Run after 2026-11-07-issue-242-everee-driver-onboarding.sql, on a backed-up copy first.
CREATE TABLE IF NOT EXISTS everee_onboarding_sync (
  driver_id integer NOT NULL REFERENCES drivers(id),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  tenant_id text NOT NULL,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  PRIMARY KEY (driver_id, environment, tenant_id)
);
CREATE TABLE IF NOT EXISTS everee_onboarding_job (
  environment text NOT NULL,
  tenant_id text NOT NULL,
  retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_everee_onboarding_sync_due ON everee_onboarding_sync (environment, tenant_id, next_check_at, driver_id);
