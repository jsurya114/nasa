import test from 'node:test';
import assert from 'node:assert/strict';
import { countsAsLanded, ownPayableIsPaidInPayment, readPayable, readPayoutState } from '../services/payments/everee/paymentState.js';

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

test('the sandbox counts a payment whose own status is PAID as landed; production and returned payouts never do', () => {
  const read = (status, payoutStatus) => readPayoutState({ status, netPayouts: [{ id: 'a', status: payoutStatus }] });
  assert.equal(read('PAID', 'PENDING').paymentPaid, true);
  assert.equal(read('paid', 'PENDING').paymentPaid, true, 'case does not matter');
  assert.equal(read('PENDING', 'PENDING').paymentPaid, false);
  assert.equal(readPayoutState({ netPayouts: [{ id: 'a', status: 'PENDING' }] }).paymentPaid, false, 'no payment status: not paid');
  assert.equal(countsAsLanded('sandbox', read('PAID', 'PENDING')), true);
  assert.equal(countsAsLanded('sandbox', read('PAID', 'PAID')), true);
  assert.equal(countsAsLanded('sandbox', read('PENDING', 'PENDING')), false, 'the payment is not PAID yet');
  assert.equal(countsAsLanded('sandbox', read('PAID', 'FAILED')), false, 'a returned payout is never covered');
  assert.equal(countsAsLanded('sandbox', readPayoutState({ status: 'PAID' })), false, 'an answer not understood is never paid');
  assert.equal(countsAsLanded('production', read('PAID', 'PENDING')), false, 'production waits for the payouts');
  assert.equal(countsAsLanded('production', read('PAID', 'PAID')), true);
});

test('the sandbox trusts its own payable inside a larger payment; production and any mismatch never do', () => {
  const own = (extra = {}) => ({ paymentStatus: 'PAID', paymentId: 29684089, amount: { amount: 402.59, currency: 'USD' }, ...extra });
  const want = { paymentId: '29684089', amount: '402.59' };
  assert.equal(ownPayableIsPaidInPayment('sandbox', own(), want), true);
  assert.equal(ownPayableIsPaidInPayment('production', own(), want), false);
  assert.equal(ownPayableIsPaidInPayment('sandbox', own({ paymentStatus: 'PENDING_PAYMENT' }), want), false, 'not paid');
  assert.equal(ownPayableIsPaidInPayment('sandbox', own({ paymentId: 1 }), want), false, 'in another payment');
  assert.equal(ownPayableIsPaidInPayment('sandbox', own({ paymentId: undefined }), want), false, 'no payment');
  assert.equal(ownPayableIsPaidInPayment('sandbox', own({ amount: { amount: 805.18 } }), want), false, 'another amount');
  assert.equal(ownPayableIsPaidInPayment('sandbox', own({ amount: undefined }), want), false, 'no amount');
  assert.equal(ownPayableIsPaidInPayment('sandbox', null, want), false);
});
