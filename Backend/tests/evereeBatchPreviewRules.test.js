import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewHashOf, workerProblems } from '../services/payments/everee/batchPreview.js';
import { paymentsGate, readEvereeConfig } from '../services/payments/everee/evereeConfig.js';

const item = (o = {}) => ({ statementId: 1, driverId: 10, amountCents: 8050, workerId: 'W-1', ...o });
const hash = (items, o = {}) => previewHashOf({ runId: 5, environment: 'sandbox', items, ...o });

test('the preview hash is the same for the same facts, in any order, and different when anything that is paid changes', () => {
  const a = item({ statementId: 1 });
  const b = item({ statementId: 2, driverId: 11, workerId: 'W-2' });
  assert.equal(hash([a, b]), hash([b, a]));
  assert.match(hash([a, b]), /^[0-9a-f]{64}$/);
  assert.notEqual(hash([a, b]), hash([a]), 'a driver more or less');
  assert.notEqual(hash([a, b]), hash([a, { ...b, amountCents: 8051 }]), 'one cent');
  assert.notEqual(hash([a, b]), hash([a, { ...b, workerId: 'W-3' }]), 'another Everee worker');
  assert.notEqual(hash([a, b]), hash([a, { ...b, driverId: 12 }]), 'another driver');
  assert.notEqual(hash([a, b]), hash([a, b], { runId: 6 }), 'another run');
  assert.notEqual(hash([a, b]), hash([a, b], { environment: 'production' }), 'another environment');
});

test('what is wrong with a linked worker is named', () => {
  assert.deepEqual(workerProblems({ onboarding_complete: true, tin_status: 'VERIFIED', terminated: false }), []);
  assert.deepEqual(workerProblems({ onboarding_complete: false, tin_status: null, terminated: false }), ['onboarding_incomplete']);
  assert.deepEqual(workerProblems({ onboarding_complete: true, tin_status: 'VERIFICATION_FAILED', terminated: false }), ['tin_verification_failed']);
  assert.deepEqual(workerProblems({ onboarding_complete: false, tin_status: 'VERIFICATION_FAILED', terminated: true }), ['onboarding_incomplete', 'tin_verification_failed', 'separated']);
  assert.deepEqual(workerProblems({ onboarding_complete: true, tin_status: 'NEEDS_VERIFICATION', terminated: false }), [], 'not yet checked is not a failure');
});

test('sending payments is off unless Everee is set up and EVEREE_PAYMENTS_ENABLED is exactly "true"', () => {
  const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
  const gate = (env) => paymentsGate(readEvereeConfig(env), env);
  assert.equal(gate({}).enabled, false);
  assert.match(gate({}).reason, /not set up/);
  assert.equal(gate(SANDBOX).enabled, false);
  assert.match(gate(SANDBOX).reason, /switched off/);
  for (const value of ['yes', '1', 'TRUEISH', 'false', '']) assert.equal(gate({ ...SANDBOX, EVEREE_PAYMENTS_ENABLED: value }).enabled, false, value);
  assert.deepEqual(gate({ ...SANDBOX, EVEREE_PAYMENTS_ENABLED: 'true' }), { enabled: true, reason: null });
  assert.equal(gate({ ...SANDBOX, EVEREE_PAYMENTS_ENABLED: ' TRUE ' }).enabled, true);
  // production needs its own deliberate setting as well; the flag alone does not make a production token usable
  const prodToken = { EVEREE_API_TOKEN: 'tsk_prod_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_PAYMENTS_ENABLED: 'true' };
  assert.equal(gate(prodToken).enabled, false);
  const prod = { ...prodToken, EVEREE_ENVIRONMENT: 'production' };
  assert.equal(gate(prod).enabled, false, 'a production setup is still not approved');
  assert.match(gate(prod).reason, /not approved/);
  assert.equal(gate({ ...prod, EVEREE_PRODUCTION_PAYMENTS_APPROVED: 'yes' }).enabled, false);
  assert.equal(gate({ ...prod, EVEREE_PRODUCTION_PAYMENTS_APPROVED: 'true' }).enabled, true, 'only with its own explicit approval');
  assert.equal(gate({ ...SANDBOX, EVEREE_PAYMENTS_ENABLED: 'true', EVEREE_PRODUCTION_PAYMENTS_APPROVED: 'true' }).enabled, true, 'the sandbox does not need it');
});
