import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateStatement, fromCents, recoveryCap, toCents } from '../services/payroll/payRuns/payCalculator.js';

// Made-up amounts only. Earnings rows look like today's pay rows: gross driver payment and insurance per day.
const day = (n, gross = '100.00', insurance = '1.92') => ({ paymentId: n, journeyDate: `2026-11-0${n}`, routeId: 1, gross, insurance });
const WEEK = [day(1), day(2), day(3)];
const base = (o = {}) => ({ periodEnd: '2026-11-07', recoveryLimit: null, earnings: WEEK, reimbursements: [], claims: [], debits: [], repayments: [], ...o });
const FULL = { type: 'percent_of_available', value: 100 };

test('money is exact to the cent', () => {
  assert.equal(toCents('1.92'), 192);
  assert.equal(toCents('-0.07'), -7);
  assert.equal(toCents(5.5), 550);
  assert.equal(fromCents(-1205), '-12.05');
  assert.throws(() => toCents('1.999'));
  assert.throws(() => toCents('abc'));
  // 3 x 1.92 in floating point is 5.76 only by luck; in cents it is always 576
  assert.equal(calculateStatement(base()).totals.insurance, '5.76');
});

test('with nothing owed, the statement equals today\'s net: gross minus insurance', () => {
  const { totals, lines, flags } = calculateStatement(base());
  assert.deepEqual(totals, { gross: '300.00', insurance: '5.76', reimbursements: '0.00', claimDeductions: '0.00', recoveries: '0.00', net: '294.24', carriedForward: '0.00' });
  assert.equal(lines.filter((l) => l.type === 'earning').length, 3);
  assert.deepEqual(flags, []);
});

test('no recovery limit set: nothing is recovered automatically, everything carries forward, and it says so', () => {
  const { totals, flags } = calculateStatement(base({
    claims: [{ claimId: 9, claimAt: '2026-10-30', outstanding: '40.00' }],
    debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'full_next_payday', outstanding: '100.00' }],
  }));
  assert.deepEqual([totals.claimDeductions, totals.recoveries, totals.net, totals.carriedForward], ['0.00', '0.00', '294.24', '140.00']);
  assert.ok(flags.some((f) => f.code === 'recovery_limit_not_set'));
  assert.deepEqual(flags.find((f) => f.code === 'recovery_limit_not_set').entryIds, [1], 'the flag names the debit that was waiting, not the claim');
});

test('$200 advance as $50 over four paydays', () => {
  let outstanding = 20000;
  const taken = [];
  for (let payday = 1; payday <= 5; payday += 1) {
    const { totals } = calculateStatement(base({
      recoveryLimit: FULL,
      debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'installments', installmentAmount: '50.00', outstanding: fromCents(outstanding) }],
    }));
    taken.push(totals.recoveries);
    outstanding -= toCents(totals.recoveries);
  }
  assert.deepEqual(taken, ['50.00', '50.00', '50.00', '50.00', '0.00']);
  assert.equal(outstanding, 0);
});

test('the last instalment takes only what is left', () => {
  const { totals } = calculateStatement(base({ recoveryLimit: FULL, debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'installments', installmentAmount: '50.00', outstanding: '30.00' }] }));
  assert.deepEqual([totals.recoveries, totals.carriedForward], ['30.00', '0.00']);
});

test('deductions bigger than the limit: recover up to the limit, carry the rest, never a negative payout', () => {
  const { totals, flags, lines } = calculateStatement(base({
    recoveryLimit: { type: 'percent_of_available', value: 50 },
    claims: [{ claimId: 9, claimAt: '2026-10-30', outstanding: '100.00' }],
    debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'full_next_payday', outstanding: '500.00' }],
  }));
  // available 294.24; 50% = 147.12. The older claim first (100), then 47.12 of the advance.
  assert.deepEqual([totals.claimDeductions, totals.recoveries, totals.net, totals.carriedForward], ['100.00', '47.12', '147.12', '452.88']);
  assert.ok(Number(totals.net) >= 0);
  assert.deepEqual(lines.filter((l) => l.amount.startsWith('-') && l.type !== 'insurance').map((l) => [l.type, l.amount]), [['claim', '-100.00'], ['recovery', '-47.12']]);
  assert.ok(flags.some((f) => f.code === 'carried_forward' && f.entryId === 1));
});

test('a fixed limit never takes more than the pay', () => {
  assert.equal(recoveryCap({ type: 'fixed_amount', value: '75' }, 29424), 7500);
  assert.equal(recoveryCap({ type: 'fixed_amount', value: '1000' }, 29424), 29424);
  assert.equal(recoveryCap({ type: 'percent_of_available', value: 100 }, -500), 0);
  assert.equal(recoveryCap(null, 29424), null);
  assert.throws(() => recoveryCap({ type: 'percent_of_available', value: 150 }, 100));
  assert.throws(() => recoveryCap({ type: 'everything', value: 1 }, 100));
  const { totals } = calculateStatement(base({ earnings: [], recoveryLimit: { type: 'fixed_amount', value: '75' }, debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'full_next_payday', outstanding: '75.00' }] }));
  assert.deepEqual([totals.recoveries, totals.net, totals.carriedForward], ['0.00', '0.00', '75.00'], 'no pay this week: nothing taken');
});

test('no repayment arrangement: flagged for review and not recovered, even with a limit', () => {
  const { totals, flags } = calculateStatement(base({ recoveryLimit: FULL, debits: [{ entryId: 4, effectiveDate: '2026-11-01', plan: null, outstanding: '80.00' }] }));
  assert.deepEqual([totals.recoveries, totals.carriedForward], ['0.00', '80.00']);
  assert.ok(flags.some((f) => f.code === 'needs_review' && f.entryId === 4));
});

test('not due yet: an entry dated after the run, or meant for a later payday, waits', () => {
  const { totals } = calculateStatement(base({ recoveryLimit: FULL, debits: [
    { entryId: 1, effectiveDate: '2026-11-08', plan: 'full_next_payday', outstanding: '10.00' },
    { entryId: 2, effectiveDate: '2026-11-01', intendedPayday: '2026-11-14', plan: 'full_next_payday', outstanding: '20.00' },
    { entryId: 3, effectiveDate: '2026-11-01', intendedPayday: '2026-11-07', plan: 'full_next_payday', outstanding: '30.00' },
  ] }));
  assert.deepEqual([totals.recoveries, totals.carriedForward], ['30.00', '30.00']);
});

test('reimbursements are paid and count towards what recovery may take', () => {
  const { totals } = calculateStatement(base({ earnings: [], recoveryLimit: FULL,
    reimbursements: [{ entryId: 7, amount: '25.00' }],
    debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'full_next_payday', outstanding: '10.00' }] }));
  assert.deepEqual([totals.reimbursements, totals.recoveries, totals.net], ['25.00', '10.00', '15.00']);
});

test('repayments made outside payroll lower the oldest debts first', () => {
  const { totals, lines } = calculateStatement(base({ recoveryLimit: FULL,
    repayments: [{ entryId: 20, amount: '120.00' }],
    debits: [
      { entryId: 1, effectiveDate: '2026-10-01', plan: 'full_next_payday', outstanding: '100.00' },
      { entryId: 2, effectiveDate: '2026-10-15', plan: 'full_next_payday', outstanding: '50.00' },
    ] }));
  // 120 repaid: entry 1 fully, 20 of entry 2. Only 30 is left to recover.
  assert.deepEqual([totals.recoveries, totals.carriedForward], ['30.00', '0.00']);
  assert.deepEqual(lines.filter((l) => l.type === 'recovery').map((l) => [l.entryId, l.amount]), [[2, '-30.00']]);
});

test('insurance larger than the pay is flagged and nothing is recovered', () => {
  const { totals, flags } = calculateStatement(base({ earnings: [day(1, '1.00', '1.92')], recoveryLimit: FULL, debits: [{ entryId: 1, effectiveDate: '2026-11-01', plan: 'full_next_payday', outstanding: '10.00' }] }));
  assert.deepEqual([totals.net, totals.recoveries], ['-0.92', '0.00']);
  assert.ok(flags.some((f) => f.code === 'negative_before_recovery'));
});

test('the same input always gives the same statement (a retry recalculates identically)', () => {
  const input = base({ recoveryLimit: { type: 'percent_of_available', value: 33.3 }, claims: [{ claimId: 2, claimAt: '2026-10-02', outstanding: '9.99' }, { claimId: 1, claimAt: '2026-10-01', outstanding: '50.01' }] });
  assert.deepEqual(calculateStatement(input), calculateStatement(structuredClone(input)));
  assert.deepEqual(calculateStatement(input).lines.filter((l) => l.type === 'claim').map((l) => l.claimId), [1, 2], 'oldest claim first');
});

const advance = (o = {}) => ({ entryId: 1, effectiveDate: '2026-11-01', intendedPayday: null, plan: 'installments', installmentAmount: '50.00', outstanding: '200.00', ...o });

test('a held debit is not recovered, stays owed, and says why', () => {
  for (const hold of ['advance_not_disbursed', 'already_recovered_this_period']) {
    const { totals, flags } = calculateStatement(base({ recoveryLimit: FULL, debits: [advance({ hold })] }));
    assert.deepEqual([totals.recoveries, totals.carriedForward, totals.net], ['0.00', '200.00', '294.24'], hold);
    assert.ok(flags.some((f) => f.code === hold && f.entryId === 1));
  }
});

test('each repayment used is recorded as an audit line with the amount used, oldest first', () => {
  const { lines, totals } = calculateStatement(base({
    recoveryLimit: FULL,
    debits: [advance({ outstanding: '100.00', plan: 'full_next_payday' })],
    repayments: [{ entryId: 7, amount: '30.00' }, { entryId: 5, amount: '90.00' }],
  }));
  // entry 5 is older: it covers the whole 100 and entry 7 is not needed
  assert.deepEqual(lines.filter((l) => l.type === 'repayment'), [{ type: 'repayment', entryId: 5, amount: '90.00' }, { type: 'repayment', entryId: 7, amount: '10.00' }]);
  assert.deepEqual([totals.recoveries, totals.net], ['0.00', '294.24']);
});

test('a claim the carrier lowered after deduction is flagged for an approved correction, never refunded silently', () => {
  const { totals, flags } = calculateStatement(base({ overRecovered: [{ claimId: 9, amount: '10.00' }] }));
  assert.equal(totals.net, '294.24', 'nothing is paid back automatically');
  assert.deepEqual(flags.map((f) => [f.code, f.claimId, f.amount]), [['claim_over_recovered', 9, '10.00']]);
});

test('with no limit set, items are not also flagged as "limit reached"', () => {
  const { flags } = calculateStatement(base({ debits: [advance()] }));
  assert.deepEqual(flags.map((f) => f.code), ['recovery_limit_not_set']);
});
