import test from 'node:test';
import assert from 'node:assert/strict';
import { countsAsLanded, ownPayableIsPaidInPayment, readCardPayouts, readPayable, readPayoutState } from '../services/payments/everee/paymentState.js';

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

test('a payment whose own status is PAID counts as landed even while a payout is pending; a returned payout never does', () => {
  const read = (status, payoutStatus) => readPayoutState({ status, netPayouts: [{ id: 'a', status: payoutStatus }] });
  assert.equal(read('PAID', 'PENDING').paymentPaid, true);
  assert.equal(read('paid', 'PENDING').paymentPaid, true, 'case does not matter');
  assert.equal(read('PENDING', 'PENDING').paymentPaid, false);
  assert.equal(readPayoutState({ netPayouts: [{ id: 'a', status: 'PENDING' }] }).paymentPaid, false, 'no payment status: not paid');
  assert.equal(countsAsLanded(read('PAID', 'PENDING')), true);
  assert.equal(countsAsLanded(read('PAID', 'PAID')), true);
  assert.equal(countsAsLanded(read('PENDING', 'PENDING')), false, 'the payment is not PAID yet');
  assert.equal(countsAsLanded(read('PAID', 'FAILED')), false, 'a returned payout is never covered');
  assert.equal(countsAsLanded(readPayoutState({ status: 'PAID' })), false, 'an answer not understood is never paid');
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

test('a payment Everee marks PAID with an empty payout list proves nothing by itself: its payouts must be read; any other empty list is not understood', () => {
  const paid = readPayoutState({ status: 'PAID', netPayouts: [], payDate: '2026-11-12', workerId: 7, totalNetPay: { amount: '0.00', currency: 'USD' }, totalTaxableWages: { amount: '274.46' } });
  assert.equal(paid.needsPayoutCheck, true);
  assert.equal(paid.netCents, null, 'neither the net pay nor the wages is taken as the amount delivered');
  assert.equal(paid.payDate, '2026-11-12');
  assert.equal(paid.workerId, '7');
  assert.equal(readPayoutState({ status: 'paid', netPayouts: [] }).needsPayoutCheck, true, 'case does not matter');
  for (const body of [{ status: 'PENDING', netPayouts: [] }, { status: 'FAILED', netPayouts: [] }, { netPayouts: [] }, { status: 'PAID' }, { status: 'PAID', netPayouts: 'PAID' }, { status: 'PAID', netPayouts: null }]) {
    assert.equal(countsAsLanded(readPayoutState(body)), false, JSON.stringify(body));
    assert.equal(readPayoutState(body).state, 'unknown', JSON.stringify(body));
  }
});

test('a card payment is verified from Everee\'s net payouts list: payment, card type, worker, status and amount', () => {
  const payout = (extra = {}) => ({ id: '1', paymentId: '555', workerId: 'W-1', type: 'PAY_CARD', status: 'PAID', netAmount: { amount: '274.46', currency: 'USD' }, supersededByIds: [], ...extra });
  const read = (items, workerId = null, extra = {}) => readCardPayouts({ items, hasNextPage: false, ...extra }, { paymentId: '555', workerId });
  const ok = read([payout()], 'W-1');
  assert.deepEqual([ok.state, ok.netCents, ok.workerId, ok.paymentPaid], ['landed', 27446, 'W-1', false]);
  assert.equal(countsAsLanded(ok), true);
  assert.equal(read([payout({ netAmount: { amount: '100.00' } }), payout({ id: '2', netAmount: { amount: '174.46' } })]).netCents, 27446, 'a split across payouts is summed');
  assert.equal(read([payout(), payout({ id: '2', status: 'SUPERSEDED', type: 'DIRECT_DEPOSIT', paymentId: '9' })]).state, 'landed', 'a replaced payout is ignored');
  // Not verified: nothing is claimed.
  for (const [what, items, worker] of [
    ['no payouts', [], null], ['only a replaced payout', [payout({ status: 'SUPERSEDED' })], null],
    ['a bank payout', [payout({ type: 'DIRECT_DEPOSIT' })], null], ['no type', [payout({ type: undefined })], null], ['a push to card', [payout({ type: 'PUSH_TO_CARD' })], null],
    ['another payment', [payout({ paymentId: '556' })], null], ['no worker', [payout({ workerId: undefined })], null],
    ['two workers', [payout(), payout({ id: '2', workerId: 'W-2' })], null], ['another worker than the payment', [payout()], 'W-2'],
    ['no amount', [payout({ netAmount: undefined })], null], ['a zero amount', [payout({ netAmount: { amount: '0.00' } })], null],
    ['a status not understood', [payout({ status: 'DONE' })], null], ['a payout that is not an object', [null], null],
  ]) {
    const got = read(items, worker);
    assert.equal(got.state, 'unknown', what);
    assert.equal(countsAsLanded(got), false, what);
  }
  assert.equal(read([payout()], null, { hasNextPage: true }).state, 'unknown', 'a longer list is not read half');
  for (const bad of [null, {}, { items: 'x' }]) assert.equal(readCardPayouts(bad, { paymentId: '555' }).state, 'unknown');
  // Pending and returned never count as landed, even though the payment itself says PAID.
  assert.deepEqual([read([payout({ status: 'PENDING' })]).state, countsAsLanded(read([payout({ status: 'PENDING' })]))], ['pending', false]);
  assert.equal(read([payout(), payout({ id: '2', status: 'RETURNED' })]).state, 'returned');
});
