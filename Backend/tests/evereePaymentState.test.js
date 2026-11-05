import test from 'node:test';
import assert from 'node:assert/strict';
import { readPayable, readPayoutState } from '../services/payments/everee/paymentState.js';

test('a payment has landed only when EVERY payout is PAID', () => {
  const state = (netPayouts, extra = {}) => readPayoutState({ paymentId: 'p1', netPayouts, ...extra });
  assert.equal(state([{ id: 'a', status: 'PAID' }]).state, 'landed');
  assert.equal(state([{ id: 'a', status: 'PAID' }, { id: 'b', status: 'PAID' }]).state, 'landed');
  assert.equal(state([{ id: 'a', status: 'PAID' }, { id: 'b', status: 'PENDING' }]).state, 'pending');
  assert.equal(state([{ id: 'a', status: 'PAID' }, { id: 'b', status: 'FAILED' }]).state, 'returned');
  assert.equal(state([{ id: 'a', status: 'PENDING' }, { id: 'b', status: 'FAILED' }]).state, 'returned', 'a returned payout is never hidden by a pending one');
  assert.equal(state([{ id: 'a', status: 'paid' }]).state, 'landed', 'case does not matter');
});

test('anything not understood is unknown, never paid', () => {
  for (const body of [null, undefined, 'PAID', [], {}, { netPayouts: [] }, { netPayouts: 'PAID' }, { netPayouts: [{ id: 'a' }] }, { netPayouts: [{ status: 'DONE' }] },
    { netPayouts: [{ status: 'PAID' }, { status: 'SETTLED' }] }, { netPayouts: [null] }, { status: 'PAID' }, { paymentStatus: 'PAID' }]) {
    assert.equal(readPayoutState(body).state, 'unknown', JSON.stringify(body));
  }
});

test('the payout total and the pay date are read only when they are plainly stated', () => {
  assert.equal(readPayoutState({ netPayouts: [{ status: 'PAID', netAmount: 12.5 }, { status: 'PAID', netAmount: { amount: '7.25', currency: 'USD' } }] }).netCents, 1975);
  assert.equal(readPayoutState({ netPayouts: [{ status: 'PAID', netAmount: 12.5 }, { status: 'PAID' }] }).netCents, null, 'one amount missing: no total');
  assert.equal(readPayoutState({ netPayouts: [{ status: 'PAID', netAmount: 'twelve' }] }).netCents, null);
  assert.equal(readPayoutState({ netPayouts: [{ status: 'PAID' }], payDate: '2026-11-09' }).payDate, '2026-11-09');
  assert.equal(readPayoutState({ netPayouts: [{ status: 'PAID' }], payDate: 'tomorrow' }).payDate, null);
});

test('a payable answer gives only a status and a safe payment ID', () => {
  assert.deepEqual(readPayable({ paymentStatus: 'PAID', paymentId: 'pay_1', name: 'x' }), { paymentStatus: 'PAID', paymentId: 'pay_1' });
  assert.deepEqual(readPayable({ paymentStatus: 5, paymentId: 'bad id!' }), { paymentStatus: null, paymentId: null });
  assert.deepEqual(readPayable(null), { paymentStatus: null, paymentId: null });
});

test('the payment ID in Everee\'s payable answer is a number (the real answer): it is read as the same ID as text, and only a safe whole number counts', () => {
  assert.deepEqual(readPayable({ paymentStatus: 'PENDING_PAYMENT', paymentId: 29684488 }), { paymentStatus: 'PENDING_PAYMENT', paymentId: '29684488' });
  for (const bad of [0, -5, 1.5, NaN, Infinity, 2 ** 60, true, {}, [], 'bad id!', '']) {
    assert.equal(readPayable({ paymentId: bad }).paymentId, null, `not an ID: ${String(bad)}`);
  }
});
