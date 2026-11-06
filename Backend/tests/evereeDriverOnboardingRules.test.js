import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProfile, EXPERIENCES, OnboardingError, profileGaps, STATES, stateOf } from '../services/payments/everee/driverOnboarding.js';
import { driverOnboardingGate, readEvereeConfig } from '../services/payments/everee/evereeConfig.js';
import { createEvereeClient } from '../services/payments/everee/evereeClient.js';

// The rules of driver onboarding with no database and no network. Made-up people only.
const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const driver = (over = {}) => ({ id: 1, name: 'Alice Rider', email: 'alice@example.com', phone_number: '5551230001', driver_type: 'LOCAL', enabled: true, agreement_signed: true, joining_date: '2026-10-01', ...over });
const view = (over = {}) => stateOf({ driver: driver(), on: true, configured: true, link: null, row: null, tenantId: '4321', ...over });
const link = (over = {}) => ({ tenant_id: '4321', onboarding_complete: false, tin_status: null, terminated: false, last_checked_at: null, ...over });

test('the switch: off unless EVEREE_DRIVER_ONBOARDING_ENABLED is exactly "true", and only when Everee is set up', () => {
  const config = readEvereeConfig(SANDBOX);
  assert.equal(driverOnboardingGate(config, SANDBOX).enabled, false);
  assert.equal(driverOnboardingGate(config, { ...SANDBOX, EVEREE_DRIVER_ONBOARDING_ENABLED: 'yes' }).enabled, false);
  assert.equal(driverOnboardingGate(config, { ...SANDBOX, EVEREE_DRIVER_ONBOARDING_ENABLED: 'true' }).enabled, true);
  assert.equal(driverOnboardingGate(readEvereeConfig({}), { EVEREE_DRIVER_ONBOARDING_ENABLED: 'true' }).enabled, false);
});

test('who is asked to onboard: only an enabled LOCAL driver, never a Desi or an unclassified one', () => {
  assert.equal(view({ on: false }).state, STATES.NOT_REQUIRED);
  assert.equal(view({ driver: driver({ enabled: false }) }).state, STATES.NOT_REQUIRED);
  assert.equal(view({ driver: driver({ driver_type: null }) }).state, STATES.CLASSIFICATION_REQUIRED);
  assert.equal(view({ driver: driver({ driver_type: 'DESI' }) }).state, STATES.NOT_REQUIRED);
  assert.equal(view({ driver: driver({ driver_type: 'DESI' }) }).required, false);
  assert.equal(view({ driver: driver({ driver_type: null }) }).required, false, 'an unclassified driver is not treated as Desi, nor as required');
  const local = view();
  assert.deepEqual([local.state, local.required, local.canStart], [STATES.NOT_STARTED, true, true]);
});

test('a Local driver who has not signed the agreement cannot start; Everee not set up is service-unavailable', () => {
  const unsigned = view({ driver: driver({ agreement_signed: false }) });
  assert.deepEqual([unsigned.state, unsigned.canStart, unsigned.blockedBy], [STATES.NOT_STARTED, false, 'agreement']);
  assert.equal(view({ configured: false }).state, STATES.SERVICE_UNAVAILABLE);
});

test('the stored states map to the words the screens use', () => {
  assert.equal(view({ row: { state: 'creating' } }).state, STATES.CREATING);
  assert.equal(view({ row: { state: 'verifying' } }).state, STATES.VERIFYING);
  assert.deepEqual([view({ row: { state: 'needs_review', review_reason: 'possible_existing_worker' } }).state, view({ row: { state: 'needs_review', review_reason: 'possible_existing_worker' } }).reason], [STATES.NEEDS_REVIEW, 'possible_existing_worker']);
  assert.equal(view({ link: link() }).state, STATES.IN_PROGRESS);
  assert.equal(view({ link: link() }).required, true);
});

test('complete means Everee said so; payment readiness is separate (a failed tax ID is complete but not ready)', () => {
  const done = view({ link: link({ onboarding_complete: true }), row: { verified_at: '2026-11-07T00:00:00Z' } });
  assert.deepEqual([done.state, done.required, done.paymentReady, done.verifiedAt], [STATES.COMPLETE, false, true, '2026-11-07T00:00:00Z']);
  const failedTin = view({ link: link({ onboarding_complete: true, tin_status: 'VERIFICATION_FAILED' }) });
  assert.deepEqual([failedTin.state, failedTin.paymentReady], [STATES.COMPLETE, false]);
});

test('a link without this tenant is never trusted', () => {
  const legacy = view({ link: link({ tenant_id: null, onboarding_complete: true }) });
  assert.deepEqual([legacy.state, legacy.reason, legacy.required], [STATES.NEEDS_REVIEW, 'link_not_verified_for_tenant', true]);
  assert.equal(view({ link: link({ tenant_id: '9999', onboarding_complete: true }) }).state, STATES.NEEDS_REVIEW);
});

test('the details sent to Everee come from the driver, are never invented, and a missing one is reported', () => {
  const ok = buildProfile(driver(), { homeAddress: { line1: '1 Test Street', city: 'Austin', state: 'tx', postalCode: '78701' } });
  assert.deepEqual(ok, { firstName: 'Alice', lastName: 'Rider', email: 'alice@example.com', phoneNumber: '5551230001', startDate: '2026-10-01', homeAddress: { line1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701' } });
  assert.throws(() => buildProfile(driver(), {}), (e) => e instanceof OnboardingError && e.status === 422 && e.missing.includes('homeAddress.line1') && e.missing.includes('homeAddress.postalCode'));
  const one = driver({ name: 'Bobby', phone_number: '12', email: 'x', joining_date: null });
  assert.throws(() => buildProfile(one, { homeAddress: { line1: 'a', city: 'b', state: 'TX', postalCode: '78701' } }), (e) => ['name', 'email', 'phone', 'startDate'].every((k) => e.missing.includes(k)));
  assert.throws(() => buildProfile(driver(), { homeAddress: { line1: 'a', city: 'b', state: 'Texas', postalCode: '787' } }), (e) => e.missing.includes('homeAddress.state') && e.missing.includes('homeAddress.postalCode'));
  assert.deepEqual(profileGaps(driver()), ['homeAddress'], 'the address is never stored by NASA, so it is always asked for');
  assert.ok(profileGaps(driver({ name: 'Bobby' })).includes('name'));
});

test('only the documented screens can be opened, each with its documented version', () => {
  assert.deepEqual(Object.keys(EXPERIENCES).sort(), ['ONBOARDING', 'PAYMENT_DEPOSIT', 'PAYMENT_HISTORY']);
  assert.deepEqual(Object.values(EXPERIENCES).map((e) => e.version).sort(), ['V1_0', 'V1_0', 'V2_0']);
});

test('the client sends the embedded calls to the documented paths, with the body as given and no token in an error', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, method: init.method, body: init.body }); return { ok: true, status: 201, headers: { get: () => null }, json: async () => ({ id: 'w1', url: 'https://x.everee.com/s' }) }; };
  const client = createEvereeClient({ baseUrl: 'https://api.everee.com', token: 'tsk_test_SECRET', tenantId: '4321' }, { fetchImpl });
  await client.createEmbeddedContractor({ externalWorkerId: 'nasa-driver-1', firstName: 'A' });
  await client.createEmbeddedSession({ workerId: 'w1', experience: 'ONBOARDING', experienceVersion: 'V2_0', eventHandlerName: 'h' });
  assert.deepEqual(seen.map((s) => [s.method, s.url]), [['POST', 'https://api.everee.com/integration/v1/embedded/workers/contractor'], ['POST', 'https://api.everee.com/integration/v1/embedded/session']]);
  assert.deepEqual(JSON.parse(seen[1].body), { workerId: 'w1', experience: 'ONBOARDING', experienceVersion: 'V2_0', eventHandlerName: 'h' });
});

test('the driver routes sit below the sign-in check and the controller reads only the token', () => {
  const routes = readFileSync(new URL('../routes/driverRoutes.js', import.meta.url), 'utf8');
  const guard = routes.indexOf('router.use(driverAuth)');
  for (const path of ['/everee/status', '/everee/onboarding', '/everee/session', '/everee/refresh']) {
    const at = routes.indexOf(`"${path}"`);
    assert.ok(at > guard && guard > -1, `${path} must be below router.use(driverAuth)`);
  }
  const controller = readFileSync(new URL('../controllers/driver/evereeOnboardingController.js', import.meta.url), 'utf8');
  assert.doesNotMatch(controller, /req\.params|req\.query|body\.driverId|body\.workerId|body\.driver_type/);
  assert.match(controller, /req\.driver\?\.id/);
  assert.match(controller, /no-store/);
});
