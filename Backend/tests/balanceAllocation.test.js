import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateOwed } from '../services/payroll/statements/statementStore.js';

// Made-up balances. The split by kind must always add up to the total the server reports: debts less repayments made
// outside payroll, never below zero (issue #167 review).
const entry = (id, type, outstanding, effective_date = '2026-11-01') => ({ id, entry_type: type, direction: 'debit', outstanding, effective_date });
const claim = (id, outstanding, claim_at = '2026-10-30 10:00') => ({ id, outstanding, claim_at });
const split = (entries, claims, repaid) => {
  const r = allocateOwed(entries, claims, repaid);
  const debt = [...entries.filter((e) => e.direction === 'debit'), ...claims].reduce((sum, i) => sum + Math.round(Number(i.outstanding) * 100), 0);
  assert.equal(r.penalties + r.other, r.total);
  assert.equal(r.total, Math.max(0, debt - repaid), 'adds up to the total owed');
  return [r.penalties, r.other];
};

test('a $40 penalty with a $20 repayment outside payroll owes $20, all of it a penalty', () => {
  assert.deepEqual(split([entry(1, 'manual_claim', '40.00')], [], 2000), [2000, 0]);
});

test('a fully repaid balance shows nothing owed, and a repayment larger than the debt never goes negative', () => {
  assert.deepEqual(split([entry(1, 'manual_claim', '40.00')], [], 4000), [0, 0]);
  assert.deepEqual(split([entry(1, 'manual_claim', '40.00')], [], 9000), [0, 0]);
});

test('repayments clear the oldest debt first, so the split follows the age of what is owed', () => {
  // the older expense is cleared first, then part of the penalty
  assert.deepEqual(split([entry(1, 'expense', '30.00', '2026-10-01'), entry(2, 'manual_claim', '40.00', '2026-11-01')], [], 5000), [2000, 0]);
  // the older penalty is cleared first, so the newer expense stays whole
  assert.deepEqual(split([entry(1, 'manual_claim', '40.00', '2026-10-01'), entry(2, 'expense', '30.00', '2026-11-01')], [], 2000), [2000, 3000]);
});

test('carrier claims from the Excel are penalties too, and come after the driver\'s ledger debts when repaid', () => {
  assert.deepEqual(split([], [claim(9, '25.00')], 0), [2500, 0]);
  assert.deepEqual(split([entry(1, 'manual_claim', '40.00')], [claim(9, '25.00')], 1000), [5500, 0]);
  assert.deepEqual(split([entry(1, 'manual_claim', '40.00')], [claim(9, '25.00')], 5000), [1500, 0]);
  // an advance stays under "other"; the repayment clears the older advance first, then the claim
  assert.deepEqual(split([entry(1, 'advance', '30.00', '2026-10-01')], [claim(9, '25.00')], 3500), [2000, 0]);
  assert.deepEqual(split([entry(1, 'advance', '30.00', '2026-10-01')], [claim(9, '25.00')], 0), [2500, 3000]);
});

test('credits and settled entries do not change the split', () => {
  const credit = { id: 3, entry_type: 'reimbursement', direction: 'credit', outstanding: '9.00', effective_date: '2026-11-01' };
  assert.deepEqual(split([entry(1, 'manual_claim', '0.00'), credit, entry(2, 'advance', '100.00')], [], 0), [0, 10000]);
});
