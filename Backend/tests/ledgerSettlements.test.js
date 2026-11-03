import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry, listEntries, voidEntry } from '../services/payroll/ledger/ledgerStore.js';
import { reverseSettlement, settleEntry } from '../services/payroll/ledger/ledgerSettlements.js';
import { parseNewEntry, parseReversal, parseSettlement } from '../services/payroll/ledger/ledgerRules.js';
import { generateRun, getRun, setRecoveryLimit } from '../services/payroll/payRuns/payRunStore.js';
import { getDriverBalances } from '../services/payroll/statements/statementStore.js';

const body = (o = {}) => ({ requestId: randomUUID(), kind: 'outside_repayment', amount: '30', settledOn: '2026-11-03', reason: 'Driver repaid in cash', reference: 'RCPT-1', ...o });

test('settlement rules: what must be given', () => {
  assert.ok(parseSettlement(body(), 5).settlement);
  const bad = (o, field) => assert.ok(parseSettlement(body(o), 5).errors[field], field);
  bad({ reference: '' }, 'reference');              // a repayment needs evidence
  bad({ kind: 'gift' }, 'kind');
  bad({ amount: '0' }, 'amount');
  bad({ amount: '-5' }, 'amount');
  bad({ amount: '10001' }, 'amount');
  bad({ settledOn: '2026-02-30' }, 'settledOn');
  bad({ reason: 'x' }, 'reason');
  bad({ requestId: 'nope' }, 'requestId');
  bad({ kind: 'waiver' }, 'reference');             // a waiver has no payment reference
  assert.ok(parseSettlement(body({ kind: 'waiver', reference: undefined }), 5).settlement);
  assert.ok(parseSettlement(body(), 'abc').errors.entryId);
  assert.ok(parseReversal({ requestId: randomUUID(), reason: 'Entered twice' }, 9).reversal);
  assert.ok(parseReversal({ requestId: randomUUID(), reason: '' }, 9).errors.reason);
});

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the migrations included, runs in one transaction that is always rolled back.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('settling a debit outside payroll: exact entry, partial, waiver, reversal, no double recovery', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT s');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql',
      '2026-11-03-issue-166-ledger-settlements.sql']) await db.query(migration(m));

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Settle City', 'TSTSET', 'DAILY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Settle Other', 'TSTSO', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TS 1', 'Test Settle City', 2, 1.6, 0.5, 0.25, 'TS-1') RETURNING id`)).id;
    const [d1] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 1')).rows.map((r) => r.id);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = $2', [city, d1]);
    const admin = async (role) => {
      const tag = randomUUID();
      return one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`, role]);
    };
    const superAdmin = await admin('superadmin');
    const cityAdmin = await admin('admin');
    const otherAdmin = await admin('admin');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2), ($3, $4)', [cityAdmin.id, city, otherAdmin.id, otherCity]);

    const entry = async (o) => (await createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d1, cityId: city, type: 'expense', amount: '100', reason: 'Test entry', effectiveDate: '2026-11-01', ...o }).entry)).entry;
    const settle = (admin, entryId, o) => settleEntry(db, admin, parseSettlement(body(o), entryId).settlement);
    const outstandingOf = async (id) => (await listEntries(db, cityAdmin, { cityId: city, driverId: d1 })).entries.find((e) => String(e.id) === String(id)).outstanding;

    const expense = await entry({});

    await t.test('a partial repayment lowers only that entry, with a reference, actor and date', async () => {
      const { settlement, replay } = await settle(cityAdmin, expense.id, { amount: '30', reference: 'RCPT-1' });
      assert.equal(replay, false);
      assert.deepEqual([settlement.kind, settlement.amount, settlement.reference, settlement.created_by, settlement.settled_on, settlement.driver_id, settlement.city_id],
        ['outside_repayment', '30.00', 'RCPT-1', cityAdmin.id, '2026-11-03', d1, city]);
      assert.equal(await outstandingOf(expense.id), '70.00');
      const balances = await getDriverBalances(db, cityAdmin, d1, city);
      assert.equal(balances.entries.find((e) => String(e.id) === String(expense.id)).outstanding, '70.00');
      assert.equal(balances.totals.owedByDriver, '70.00');
    });

    await t.test('the same request again is a replay; the same ID for something else is refused', async () => {
      const first = await settle(cityAdmin, expense.id, { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: '5', reference: 'RCPT-2' });
      const again = await settle(cityAdmin, expense.id, { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: '5', reference: 'RCPT-2' });
      assert.deepEqual([again.replay, again.settlement.id], [true, first.settlement.id]);
      await assert.rejects(settle(cityAdmin, expense.id, { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: '6', reference: 'RCPT-2' }), { status: 409 });
      assert.equal(await outstandingOf(expense.id), '65.00', 'recorded once');
    });

    await t.test('more than what is outstanding is refused; the rest can still be settled', async () => {
      await assert.rejects(settle(cityAdmin, expense.id, { amount: '65.01' }), { status: 409, message: /only 65\.00 is still outstanding/ });
      await settle(cityAdmin, expense.id, { amount: '65.00', reference: 'RCPT-3' });
      assert.equal(await outstandingOf(expense.id), '0.00');
      await assert.rejects(settle(cityAdmin, expense.id, { amount: '1' }), { status: 409, message: /nothing is outstanding/ });
    });

    await t.test('only a super admin may waive; a waiver clears its part; other cities and credits are refused', async () => {
      const e2 = await entry({ amount: '50' });
      await assert.rejects(settle(cityAdmin, e2.id, { kind: 'waiver', reference: undefined, reason: 'Goodwill' }), { status: 403 });
      await settle(superAdmin, e2.id, { kind: 'waiver', amount: '20', reference: undefined, reason: 'Approved by owner' });
      assert.equal(await outstandingOf(e2.id), '30.00');
      await assert.rejects(settle(otherAdmin, e2.id, { amount: '1' }), { status: 403 });
      const credit = await entry({ type: 'reimbursement', amount: '10' });
      await assert.rejects(settle(cityAdmin, credit.id, { amount: '1' }), { status: 400, message: /driver owes/ });
      await assert.rejects(settle(cityAdmin, 999999999, { amount: '1' }), { status: 404 });
    });

    await t.test('a mistaken settlement is reversed once, by a row of its own; a reversal cannot be reversed', async () => {
      const e3 = await entry({ amount: '40' });
      const { settlement } = await settle(cityAdmin, e3.id, { amount: '40', reference: 'RCPT-9' });
      assert.equal(await outstandingOf(e3.id), '0.00');
      const rev = await reverseSettlement(db, cityAdmin, { settlementId: settlement.id, requestId: randomUUID(), reason: 'Entered on the wrong driver' });
      assert.deepEqual([rev.settlement.kind, rev.settlement.amount, String(rev.settlement.reverses_settlement_id)], ['reversal', '40.00', String(settlement.id)]);
      assert.equal(await outstandingOf(e3.id), '40.00');
      await assert.rejects(reverseSettlement(db, cityAdmin, { settlementId: settlement.id, requestId: randomUUID(), reason: 'Again' }), { status: 409 });
      await assert.rejects(reverseSettlement(db, cityAdmin, { settlementId: rev.settlement.id, requestId: randomUUID(), reason: 'Again' }), { status: 400 });
      await assert.rejects(reverseSettlement(db, otherAdmin, { settlementId: settlement.id, requestId: randomUUID(), reason: 'Not mine' }), { status: 403 });
    });

    await t.test('an entry with a settlement cannot be voided until it is reversed', async () => {
      const e4 = await entry({ amount: '25' });
      const { settlement } = await settle(cityAdmin, e4.id, { amount: '10', reference: 'RCPT-4' });
      await assert.rejects(voidEntry(db, cityAdmin, { entryId: e4.id, requestId: randomUUID(), reason: 'Wrong entry' }), { status: 409, message: /reverse that first/ });
      await reverseSettlement(db, cityAdmin, { settlementId: settlement.id, requestId: randomUUID(), reason: 'Undo before void' });
      await voidEntry(db, cityAdmin, { entryId: e4.id, requestId: randomUUID(), reason: 'Wrong entry' });
    });

    await t.test('the database refuses edits, deletes, a repayment without a reference and a reference on a waiver', async () => {
      await savepoint(() => assert.rejects(db.query("UPDATE driver_ledger_settlements SET reason = 'changed'"), /cannot be changed or deleted/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM driver_ledger_settlements'), /cannot be changed or deleted/));
      const insert = (kind, reference) => db.query(
        `INSERT INTO driver_ledger_settlements (request_id, entry_id, driver_id, city_id, kind, amount, settled_on, reference, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, 1, '2026-11-03', $6, 'Test reason', $7)`, [randomUUID(), expense.id, d1, city, kind, reference, cityAdmin.id]);
      await savepoint(() => assert.rejects(insert('outside_repayment', null), /check constraint/));
      await savepoint(() => assert.rejects(insert('waiver', 'REF-1'), /check constraint/));
    });

    await t.test('payroll recovers only what is left: a settled amount is never taken from pay as well', async () => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,9000,9009,$3,10) RETURNING id', [d1, route, '2026-11-03'])).id;
      await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = 500, insurance_deduction = 0 WHERE dashboard_data_id = $1 RETURNING id', [dd]);
      const owed = await entry({ amount: '100', recoveryPlan: 'full_next_payday', reason: 'Recover on payday' });
      await settle(cityAdmin, owed.id, { amount: '60', reference: 'RCPT-7' });
      await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
      // Earlier entries of this driver also have no plan, so only this entry's line is checked.
      const { run } = await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' });
      const detail = await getRun(db, cityAdmin, run.id);
      const line = detail.statements[0].lines.find((l) => l.line_type === 'recovery' && String(l.ledger_entry_id) === String(owed.id));
      assert.equal(line.amount, '-40.00', 'the 100 entry, 60 already repaid outside payroll, recovers 40');
      assert.equal(await outstandingOf(owed.id), '40.00', '100 less the 60 repaid; the draft only reserves the 40 until it is finalized');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
