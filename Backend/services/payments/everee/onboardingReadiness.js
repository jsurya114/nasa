import { PayrollError, assertCityAllowed, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { readEvereeConfig } from './evereeConfig.js';
import { enforcement } from './onboardingGate.js';

const STATES = ['not-started', 'creating', 'in-progress', 'verifying', 'complete', 'needs-review', 'classification-required', 'not-required', 'service-unavailable'];
// "Open work" is a rough count: unclosed rows of the last OPEN_WORK_DAYS days only, so old rows that were never closed do not inflate it.
export const OPEN_WORK_DAYS = 60;
export const readinessParams = (input = {}) => {
  const positive = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max) throw new PayrollError(400, 'invalid page or city');
    return Number(value);
  };
  const state = input.state ?? '';
  if (state !== '' && !STATES.includes(state)) throw new PayrollError(400, 'invalid setup status');
  return { cityId: positive(input.cityId, null, 2147483647), page: positive(input.page, 1, 100000), state };
};

// Readiness is a preview even while enforcement is off. No provider call or stored state is changed.
export const onboardingReadiness = async (db, admin, input, { env = process.env } = {}) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can view payment setup');
  const { cityId, page, state } = readinessParams(input);
  if (!cityId) throw new PayrollError(400, 'choose a city');
  await assertCityAllowed(db, admin, cityId);
  if (!(await db.query('SELECT 1 FROM city WHERE id = $1', [cityId])).rowCount) throw new PayrollError(404, 'city not found');
  const config = readEvereeConfig(env);
  const { rows: [result] } = await db.query(`WITH base AS (
    SELECT d.id AS "driverId", d.name, d.driver_type AS "driverType", d.agreement_signed AS "agreementSigned", d.contact_changed_at, d.email AS driver_email, d.phone_number AS driver_phone,
      w.onboarding_complete, w.tin_status, w.terminated, w.last_checked_at AS "lastCheckedAt",
      w.tenant_id AS link_tenant, w.id AS link_id, o.state AS intent_state, o.review_reason,
      EXISTS (SELECT 1 FROM everee_workers old WHERE old.driver_id = d.id AND old.environment = $2 AND old.unlinked_at IS NOT NULL) AS unlinked,
      EXISTS (SELECT 1 FROM everee_payment_items i JOIN everee_payment_batches b ON b.id = i.batch_id
        WHERE i.driver_id = d.id AND b.environment = $2 AND (i.status IN ('submitted', 'unconfirmed', 'not_submitted') OR i.deposit_returned)) AS "outstandingPayment",
      EXISTS (SELECT 1 FROM payment_dashboard pd WHERE pd.driver_id = d.id AND NOT COALESCE(pd.closed, false) AND pd.journey_date >= current_date - $7::int) AS "openWork"
    FROM drivers d
    LEFT JOIN everee_workers w ON w.driver_id = d.id AND w.environment = $2 AND w.unlinked_at IS NULL
    LEFT JOIN everee_onboarding o ON o.driver_id = d.id AND o.environment = $2 AND o.tenant_id = $3
    WHERE d.enabled AND d.city_id = $1
  ), classified AS (
    SELECT *, CASE
      WHEN "driverType" IS NULL THEN 'classification-required'
      WHEN "driverType" <> 'LOCAL' THEN 'not-required'
      WHEN NOT $4 THEN 'service-unavailable'
      WHEN link_id IS NOT NULL AND link_tenant IS DISTINCT FROM $3 THEN 'needs-review'
      WHEN link_id IS NOT NULL AND onboarding_complete THEN 'complete'
      WHEN link_id IS NOT NULL THEN 'in-progress'
      WHEN unlinked OR contact_changed_at IS NOT NULL OR intent_state = 'needs_review' THEN 'needs-review'
      WHEN intent_state = 'creating' THEN 'creating'
      WHEN intent_state = 'verifying' THEN 'verifying'
      ELSE 'not-started' END AS state
    FROM base
  ), visible AS (
    SELECT "driverId", name, "driverType", "agreementSigned", "lastCheckedAt", state, CASE WHEN contact_changed_at IS NOT NULL AND link_id IS NULL THEN contact_changed_at END AS "contactChangedAt",
      CASE WHEN contact_changed_at IS NOT NULL AND link_id IS NULL THEN driver_email END AS "contactEmail", CASE WHEN contact_changed_at IS NOT NULL AND link_id IS NULL THEN driver_phone END AS "contactPhone", "openWork", "outstandingPayment",
      CASE WHEN state = 'needs-review' THEN CASE WHEN link_id IS NOT NULL THEN 'link_not_verified_for_tenant' WHEN unlinked THEN 'previously_unlinked' WHEN contact_changed_at IS NOT NULL THEN 'contact_changed' ELSE review_reason END
           WHEN NOT "agreementSigned" AND "driverType" = 'LOCAL' THEN 'agreement_required' ELSE NULL END AS reason,
      (state = 'complete' AND NOT COALESCE(terminated, false) AND COALESCE(tin_status, '') <> 'VERIFICATION_FAILED') AS "paymentReady"
    FROM classified WHERE $5 = '' OR state = $5 ORDER BY lower(name), "driverId" LIMIT 50 OFFSET $6
  ) SELECT
    (SELECT jsonb_build_object('activeDrivers', count(*), 'localDrivers', count(*) FILTER (WHERE "driverType" = 'LOCAL'),
      'complete', count(*) FILTER (WHERE state = 'complete'), 'wouldHold', count(*) FILTER (WHERE "driverType" = 'LOCAL' AND state <> 'complete'),
      'unclassified', count(*) FILTER (WHERE "driverType" IS NULL), 'needsReview', count(*) FILTER (WHERE state = 'needs-review'),
      'driversWithOpenWork', count(*) FILTER (WHERE "openWork"), 'driversWithOutstandingPayments', count(*) FILTER (WHERE "outstandingPayment"),
      'openWorkRoutes', (SELECT count(DISTINCT pd.route_id) FROM payment_dashboard pd JOIN drivers d ON d.id = pd.driver_id WHERE d.enabled AND d.city_id = $1 AND NOT COALESCE(pd.closed, false) AND pd.journey_date >= current_date - $7::int)) FROM classified) AS summary,
    (SELECT count(*)::int FROM classified WHERE $5 = '' OR state = $5) AS total,
    COALESCE((SELECT jsonb_agg(v) FROM visible v), '[]'::jsonb) AS drivers`,
  [cityId, config.environment, config.tenantId, config.configured, state, (page - 1) * 50, OPEN_WORK_DAYS]);
  return { ...result, cityId, page, pageSize: 50, environment: config.environment, configured: config.configured,
    onboardingEnabled: String(env.EVEREE_DRIVER_ONBOARDING_ENABLED ?? '').trim().toLowerCase() === 'true',
    enforced: enforcement(env).enforced, checkedAt: new Date().toISOString() };
};
