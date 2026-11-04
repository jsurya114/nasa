import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalIdOf, isTimeZone, noonInZone, payableBody } from '../services/payments/everee/payableRules.js';
import { classifyFailure } from '../services/payments/everee/batchSubmit.js';
import { EvereeError } from '../services/payments/everee/evereeClient.js';

const iso = (seconds) => new Date(seconds * 1000).toISOString();

test('the earning date is noon on the last day of the run in the city\'s time zone, also across the clock change', () => {
  assert.equal(iso(noonInZone('2026-11-03', 'America/Chicago')), '2026-11-03T18:00:00.000Z'); // winter time, UTC-6
  assert.equal(iso(noonInZone('2026-10-31', 'America/Chicago')), '2026-10-31T17:00:00.000Z'); // summer time, UTC-5
  assert.equal(iso(noonInZone('2026-11-01', 'America/Chicago')), '2026-11-01T18:00:00.000Z'); // the day the clocks go back at 2 am
  assert.equal(iso(noonInZone('2026-03-08', 'America/Chicago')), '2026-03-08T17:00:00.000Z'); // the day they go forward
  assert.equal(iso(noonInZone('2026-11-03', 'UTC')), '2026-11-03T12:00:00.000Z');
  assert.equal(iso(noonInZone('2026-11-03', 'America/New_York')), '2026-11-03T17:00:00.000Z');
  assert.throws(() => noonInZone('2026-11-03', 'Mars/Olympus'));
  assert.throws(() => noonInZone('03/11/2026', 'UTC'));
});

test('time zone names are checked', () => {
  assert.equal(isTimeZone('America/Chicago'), true);
  assert.equal(isTimeZone('UTC'), true);
  for (const bad of ['', 'Mars/Olympus', 'x', null, undefined, 7, 'a'.repeat(70)]) assert.equal(isTimeZone(bad), false, String(bad));
});

test('the idempotency key is made only from the statement, so a retry always repeats it', () => {
  assert.equal(externalIdOf(42), 'nasa-stmt-42');
  assert.equal(externalIdOf(42), externalIdOf('42'));
});

test('the payable is the frozen net, the agreed pay code and earning date, with no personal data', () => {
  const body = payableBody({
    statementId: 7, amount: '125.50', worker: { workerId: 'EW-1', externalWorkerId: null },
    periodStart: '2026-11-01', periodEnd: '2026-11-07', timeZone: 'America/Chicago', workLocationId: null,
  });
  assert.deepEqual(body, {
    externalId: 'nasa-stmt-7', workerId: 'EW-1', type: 'NASA_PAY_RUN', label: 'NASA pay 2026-11-01 to 2026-11-07',
    amount: { amount: 125.5, currency: 'USD' }, payableModel: 'PRE_CALCULATED', payCode: 'CONTRACTOR', earningTimestamp: noonInZone('2026-11-07', 'America/Chicago'),
  });
  const named = payableBody({ statementId: 7, amount: '0.01', worker: { workerId: 'EW-1', externalWorkerId: 'nasa-sandbox-driver-3' }, periodStart: '2026-11-01', periodEnd: '2026-11-07', timeZone: 'UTC', workLocationId: '88' });
  assert.equal(named.externalWorkerId, 'nasa-sandbox-driver-3');
  assert.equal('workerId' in named, false, 'one way of naming the worker');
  assert.equal(named.workLocationId, 88);
  assert.equal(named.amount.amount, 0.01);
});

test('an Everee failure is "not taken" (safe to retry) or "unknown" (must be reconciled); a timeout is never "failed"', () => {
  const e = (message, status = null) => new EvereeError(message, { status });
  assert.deepEqual(classifyFailure(e('Everee did not answer in time')), { outcome: 'timeout', definite: false, status: null });
  assert.deepEqual(classifyFailure(e('Everee could not be reached')), { outcome: 'unreachable', definite: false, status: null });
  assert.deepEqual(classifyFailure(e('Everee answered 500', 500)), { outcome: 'server_error', definite: false, status: 500 });
  assert.deepEqual(classifyFailure(e('Everee answered 503', 503)), { outcome: 'server_error', definite: false, status: 503 });
  assert.deepEqual(classifyFailure(e('limit', 429)), { outcome: 'rate_limited', definite: true, status: 429 });
  for (const status of [400, 401, 403, 404, 409, 422]) assert.deepEqual(classifyFailure(e('refused', status)), { outcome: 'refused', definite: true, status });
  assert.equal(classifyFailure(new TypeError('a bug')).definite, false, 'anything not understood is unknown, never "failed"');
});
