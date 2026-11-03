import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRY_DIRECTIONS, entryFingerprint, parseDate, parseNewEntry, parseVoid, rowFingerprint } from '../services/payroll/ledger/ledgerRules.js';

const REQ = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const base = (o = {}) => ({ requestId: REQ, driverId: 7, cityId: 2, type: 'expense', amount: '25.50', reason: 'Lost scanner', effectiveDate: '2026-11-03', ...o });

test('each type has its own direction, so nobody chooses a sign', () => {
  assert.deepEqual(ENTRY_DIRECTIONS, { advance: 'debit', expense: 'debit', manual_claim: 'debit', advance_repayment: 'credit', reimbursement: 'credit', correction: null });
  assert.equal(parseNewEntry(base()).entry.direction, 'debit');
  assert.equal(parseNewEntry(base({ type: 'reimbursement' })).entry.direction, 'credit');
  assert.equal(parseNewEntry(base({ type: 'advance_repayment' })).entry.direction, 'credit');
  assert.ok(parseNewEntry(base({ type: 'reimbursement', direction: 'debit' })).errors.direction, 'a reimbursement cannot be turned into a charge');
  assert.equal(parseNewEntry(base({ type: 'correction', direction: 'credit' })).entry.direction, 'credit');
  assert.ok(parseNewEntry(base({ type: 'correction' })).errors.direction);
});

test('a valid entry is cleaned and keeps the amount positive, to the cent', () => {
  const { entry } = parseNewEntry(base({ reason: '  Lost   scanner  ', amount: 25.5, intendedPayday: '2026-11-07' }));
  assert.deepEqual(entry, {
    requestId: REQ, driverId: 7, cityId: 2, type: 'expense', direction: 'debit', amount: '25.50', reason: 'Lost scanner',
    effectiveDate: '2026-11-03', intendedPayday: '2026-11-07', disbursedOutsidePayroll: false, claimType: null, waybill: null,
    recoveryPlan: null, installmentAmount: null,
  });
});

test('a debit may record how it is repaid: all next payday, or fixed instalments', () => {
  const advance = (o) => parseNewEntry(base({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, ...o }));
  assert.deepEqual([advance({}).entry.recoveryPlan, advance({}).entry.installmentAmount], [null, null], 'no plan: left for review');
  assert.equal(advance({ recoveryPlan: 'full_next_payday' }).entry.recoveryPlan, 'full_next_payday');
  assert.deepEqual(
    [advance({ recoveryPlan: 'installments', installmentAmount: '50' }).entry.recoveryPlan, advance({ recoveryPlan: 'installments', installmentAmount: '50' }).entry.installmentAmount],
    ['installments', '50.00'],
    '$200 as $50 over four paydays'
  );
  for (const per of [undefined, '0', '-5', 'x', '200', '250']) assert.ok(advance({ recoveryPlan: 'installments', installmentAmount: per }).errors?.installmentAmount, String(per));
  assert.ok(advance({ installmentAmount: '50' }).errors.installmentAmount, 'an amount without the plan');
  assert.ok(advance({ recoveryPlan: 'weekly' }).errors.recoveryPlan);
  assert.ok(parseNewEntry(base({ type: 'reimbursement', recoveryPlan: 'full_next_payday' })).errors.recoveryPlan, 'credits are not recovered');
  assert.equal(parseNewEntry(base({ recoveryPlan: 'full_next_payday' })).entry.recoveryPlan, 'full_next_payday', 'expenses can have one too');
});

test('bad input is refused field by field', () => {
  const { errors } = parseNewEntry({ requestId: 'x', driverId: 'abc', cityId: -1, type: 'bonus', amount: '0', reason: 'ok', effectiveDate: '2026-02-30', intendedPayday: 'soon' });
  assert.deepEqual(Object.keys(errors).sort(), ['amount', 'cityId', 'driverId', 'effectiveDate', 'intendedPayday', 'reason', 'requestId', 'type']);
  for (const amount of ['-10', -10, '', null, 'ten', '10.001', 10001]) assert.ok(parseNewEntry(base({ amount })).errors?.amount, String(amount));
  assert.equal(parseNewEntry(base({ amount: 10000 })).entry.amount, '10000.00');
  assert.equal(parseNewEntry(undefined).errors.requestId.length > 0, true);
});

test('an advance must say whether it was already paid out; nothing else may', () => {
  assert.ok(parseNewEntry(base({ type: 'advance' })).errors.disbursedOutsidePayroll);
  assert.equal(parseNewEntry(base({ type: 'advance', disbursedOutsidePayroll: true })).entry.disbursedOutsidePayroll, true);
  assert.equal(parseNewEntry(base({ type: 'advance', disbursedOutsidePayroll: false })).entry.disbursedOutsidePayroll, false);
  assert.ok(parseNewEntry(base({ type: 'expense', disbursedOutsidePayroll: true })).errors.disbursedOutsidePayroll);
  assert.ok(parseNewEntry(base({ type: 'advance', disbursedOutsidePayroll: 'yes' })).errors.disbursedOutsidePayroll);
});

test('a manual claim needs its type; the waybill is optional and normalized', () => {
  assert.ok(parseNewEntry(base({ type: 'manual_claim' })).errors.claimType);
  const { entry } = parseNewEntry(base({ type: 'manual_claim', claimType: ' Damaged  Item ', waybill: ' test 0001 ' }));
  assert.deepEqual([entry.claimType, entry.waybill], ['Damaged Item', 'TEST0001']);
  assert.ok(parseNewEntry(base({ claimType: 'Damaged Item', waybill: 'X1' })).errors.claimType, 'refused for an expense, not silently dropped');
});

test('dates must be real; voids need an entry, a request ID and a reason', () => {
  assert.equal(parseDate('2028-02-29'), '2028-02-29');
  for (const bad of ['2026-02-29', '2026-13-01', '03/11/2026', '', null, 20261103]) assert.equal(parseDate(bad), null, String(bad));
  assert.deepEqual(parseVoid({ requestId: REQ, reason: 'Entered twice' }, '12'), { void: { entryId: 12, requestId: REQ, reason: 'Entered twice' } });
  assert.deepEqual(Object.keys(parseVoid({ requestId: 'nope', reason: '' }, '0').errors).sort(), ['entryId', 'reason', 'requestId']);
});

test('only a credit correction may name the claim it refunds, with both waybill and claim type; other types may not', () => {
  const base = { requestId: '7b0f8c1e-3c1a-4d2b-9a55-1f2e3d4c5b6a', driverId: 3, cityId: 2, amount: '10', reason: 'Carrier lowered the claim', effectiveDate: '2026-11-03' };
  const ok = parseNewEntry({ ...base, type: 'correction', direction: 'credit', waybill: ' testw001 ', claimType: 'Damaged Item' });
  assert.deepEqual([ok.entry.waybill, ok.entry.claimType], ['TESTW001', 'Damaged Item']);
  assert.ok(parseNewEntry({ ...base, type: 'correction', direction: 'credit', waybill: 'TESTW001' }).errors.waybill);
  assert.ok(parseNewEntry({ ...base, type: 'expense', waybill: 'TESTW001' }).errors.claimType);
  // A claim-linked debit would charge a claim outside the import and its exemption (for example DFW GOFO tracking
  // interruption), so only a refund may name a claim.
  for (const claimType of ['Tracking interruption', 'Damaged Item']) {
    assert.ok(parseNewEntry({ ...base, type: 'correction', direction: 'debit', waybill: 'TESTW001', claimType }).errors.direction, claimType);
  }
  assert.equal(parseNewEntry({ ...base, type: 'correction', direction: 'debit' }).errors, undefined, 'a plain debit correction is still allowed');
});

test('the replay fingerprint covers every saved field and reads a database row the same way as the form', () => {
  const entry = {
    driverId: 3, cityId: 2, type: 'advance', direction: 'debit', amount: '200.00', reason: 'Fuel', effectiveDate: '2026-11-01',
    intendedPayday: null, disbursedOutsidePayroll: true, claimType: null, waybill: null, recoveryPlan: 'installments', installmentAmount: '50.00',
  };
  const row = {
    driver_id: 3, city_id: 2, entry_type: 'advance', direction: 'debit', amount: '200.00', reason: 'Fuel', effective_date: '2026-11-01',
    intended_payday: null, disbursed_outside_payroll: true, claim_type: null, waybill: null, recovery_plan: 'installments', installment_amount: '50.00',
  };
  assert.equal(rowFingerprint(row), entryFingerprint(entry));
  for (const [key, value] of Object.entries({
    driverId: 4, cityId: 9, type: 'expense', direction: 'credit', amount: '200.01', reason: 'Other', effectiveDate: '2026-11-02',
    intendedPayday: '2026-11-14', disbursedOutsidePayroll: false, claimType: 'X', waybill: 'W', recoveryPlan: 'full_next_payday', installmentAmount: '25.00',
  })) {
    assert.notEqual(entryFingerprint({ ...entry, [key]: value }), rowFingerprint(row), key);
  }
});
