import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry, listEntries, voidEntry } from '../services/payroll/ledger/ledgerStore.js';
import { parseNewEntry } from '../services/payroll/ledger/ledgerRules.js';
import { importClaims, lockClaimSubject } from '../services/payroll/claims/claimsStore.js';
import { parseClaimsRows } from '../services/payroll/claims/claimsParser.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the migrations included, runs in one transaction that is always rolled back.
// The admins, the city and the moved drivers are made up inside that transaction.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const PLAN = (o) => (['advance', 'manual_claim'].includes(o.type) && o.recoveryPlan === undefined ? { recoveryPlan: 'full_next_payday' } : {}); // an advance or penalty above the driver's payment must say how it is repaid
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('the driver ledger: city access, exemption, no double entries, immutable history', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT s');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await db.query('BEGIN');
    await db.query(migration('2026-11-03-issue-141-courier-claims.sql'));
    await db.query(migration('2026-11-03-issue-142-driver-ledger.sql'));
    await db.query(migration('2026-11-03-issue-143-pay-runs.sql')); // listEntries reads what pay runs did with each entry
    await db.query(migration('2026-11-03-issue-166-ledger-settlements.sql')); // ... and what was settled outside payroll

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const dfw = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('DFW GOFO', 'TSTDFW', 'WEEKLY') RETURNING id")).id;
    const other = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Other', 'TSTOTH', 'WEEKLY') RETURNING id")).id;
    const [d1, d2, d3] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 3')).rows.map((r) => r.id);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = ANY($2::int[])', [dfw, [d1, d2]]);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = $2', [other, d3]);
    const admin = async (role) => {
      const tag = randomUUID();
      return one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`, role]);
    };
    const superAdmin = await admin('superadmin');
    const dfwAdmin = await admin('admin');
    const noCityAdmin = await admin('admin');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [dfwAdmin.id, dfw]);

    const entry = (o) => {
      const parsed = parseNewEntry({ requestId: randomUUID(), driverId: d1, cityId: dfw, type: 'expense', amount: '30', reason: 'Test entry', effectiveDate: '2026-11-03', ...o, ...PLAN(o) });
      assert.ok(parsed.entry, JSON.stringify(parsed.errors));
      return parsed.entry;
    };

    await t.test('a city admin records an entry for a driver in their city', async () => {
      const result = await createEntry(db, dfwAdmin, entry({}));
      assert.equal(result.replay, false);
      assert.equal(result.entry.amount, '30.00');
      assert.equal(result.entry.created_by, dfwAdmin.id);
    });

    await t.test('a debit without a repayment arrangement is flagged for review; one with a plan is not', async () => {
      const noPlan = await createEntry(db, dfwAdmin, entry({ type: 'expense', amount: '200', reason: 'No plan yet' }));
      const plan = await createEntry(db, dfwAdmin, entry({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50' }));
      const credit = await createEntry(db, dfwAdmin, entry({ type: 'reimbursement', amount: '1' }));
      assert.deepEqual([noPlan.entry.needs_review, plan.entry.needs_review, credit.entry.needs_review], [true, false, false]);
      assert.deepEqual([plan.entry.recovery_plan, plan.entry.installment_amount], ['installments', '50.00']);
      // the database refuses an instalment as large as the whole amount, and a plan on a credit
      await savepoint(() => assert.rejects(db.query(
        `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, recovery_plan, installment_amount, created_by)
         VALUES ($1, $2, $3, 'advance', 'debit', 50, 'bad plan', '2026-11-03', 'installments', 50, $4)`, [randomUUID(), d1, dfw, dfwAdmin.id]), /check constraint/));
      await savepoint(() => assert.rejects(db.query(
        `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, recovery_plan, created_by)
         VALUES ($1, $2, $3, 'reimbursement', 'credit', 50, 'bad plan', '2026-11-03', 'full_next_payday', $4)`, [randomUUID(), d1, dfw, dfwAdmin.id]), /check constraint/));
      // keep the balances below independent of this step
      for (const id of [noPlan.entry.id, plan.entry.id, credit.entry.id]) await voidEntry(db, dfwAdmin, { entryId: id, requestId: randomUUID(), reason: 'Test cleanup' });
    });

    await t.test('wrong city, no city, or a driver from another city is refused', async () => {
      await assert.rejects(createEntry(db, dfwAdmin, entry({ cityId: other, driverId: d3 })), { status: 403 });
      await assert.rejects(createEntry(db, noCityAdmin, entry({})), { status: 403 });
      await assert.rejects(createEntry(db, superAdmin, entry({ driverId: d3 })), { status: 400, message: /does not belong/ });
      await assert.rejects(listEntries(db, noCityAdmin, { cityId: dfw }), { status: 403 });
      await assert.rejects(listEntries(db, dfwAdmin, {}), { status: 400 });
    });

    await t.test('the same form sent twice creates one entry; a reused request ID for something else is refused', async () => {
      const e = entry({ type: 'advance', amount: '100', disbursedOutsidePayroll: true });
      const first = await createEntry(db, dfwAdmin, e);
      const again = await createEntry(db, dfwAdmin, e);
      assert.equal(again.replay, true);
      assert.equal(again.entry.id, first.entry.id);
      await assert.rejects(createEntry(db, dfwAdmin, { ...e, amount: '999.00' }), { status: 409 });
      await assert.rejects(createEntry(db, superAdmin, e), { status: 409 }, 'another admin cannot replay it');
    });

    await t.test('the exemption applies to manual claims too, and a claim already imported cannot be entered again', async () => {
      const exempt = await createEntry(db, dfwAdmin, entry({ type: 'manual_claim', claimType: 'tracking  interruption', amount: '25' }));
      assert.equal(exempt.entry.exempt, true);
      const charged = await createEntry(db, dfwAdmin, entry({ type: 'manual_claim', claimType: 'Damaged Item', amount: '40', waybill: 'TESTL001' }));
      assert.equal(charged.entry.exempt, false);
      await assert.rejects(createEntry(db, dfwAdmin, entry({ type: 'manual_claim', claimType: 'damaged item', amount: '40', waybill: 'testl001' })), { status: 409, message: /already recorded/ });

      await db.query(
        `INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
         VALUES ('gofo', repeat('b', 64), 1, 'TESTL002', 'fake pod', 'fake pod', now(), -15, 15, $1, 'synthetic.xlsx', 'Claims Detail', 2)`, [dfw]);
      await assert.rejects(createEntry(db, dfwAdmin, entry({ type: 'manual_claim', claimType: 'Fake POD', amount: '15', waybill: 'TESTL002' })), { status: 409, message: /imported from the carrier/ });
    });

    await t.test('balances: debits add, credits subtract, exempt claims count zero', async () => {
      await createEntry(db, dfwAdmin, entry({ type: 'reimbursement', amount: '12.25' }));
      await createEntry(db, dfwAdmin, entry({ driverId: d2, type: 'reimbursement', amount: '5' }));
      const { balances } = await listEntries(db, dfwAdmin, { cityId: dfw });
      // d1: 30 + 100 + 0 (exempt) + 40 - 12.25 = 157.75 ; d2: -5 (NASA owes the driver)
      assert.deepEqual(balances, { [d1]: '157.75', [d2]: '-5.00' });
    });

    await t.test('a void reverses an entry once, and only within the admin\'s cities', async () => {
      const target = await createEntry(db, dfwAdmin, entry({ amount: '7.75' }));
      await assert.rejects(voidEntry(db, noCityAdmin, { entryId: target.entry.id, requestId: randomUUID(), reason: 'Mistake' }), { status: 403 });
      const voided = await voidEntry(db, dfwAdmin, { entryId: target.entry.id, requestId: randomUUID(), reason: 'Mistake' });
      assert.deepEqual([voided.entry.entry_type, voided.entry.direction, voided.entry.amount], ['void', 'credit', '7.75']);
      await assert.rejects(voidEntry(db, dfwAdmin, { entryId: target.entry.id, requestId: randomUUID(), reason: 'Again' }), { status: 409 });
      await assert.rejects(voidEntry(db, dfwAdmin, { entryId: voided.entry.id, requestId: randomUUID(), reason: 'Undo' }), { status: 400 });
      const { balances, entries } = await listEntries(db, superAdmin, { cityId: dfw, driverId: d1 });
      assert.equal(balances[d1], '157.75', 'the voided entry no longer counts');
      assert.equal(entries.find((e) => e.id === target.entry.id).voided_by, voided.entry.id);
    });

    await t.test('a reused request ID is a replay only when every saved field matches; any other change is refused', async () => {
      // The case from the review: a 40 debit correction, then the same request ID as a 40 credit correction.
      const debit = entry({ type: 'correction', direction: 'debit', amount: '40' });
      await createEntry(db, dfwAdmin, debit);
      await assert.rejects(createEntry(db, dfwAdmin, { ...debit, direction: 'credit' }), { status: 409 });
      const advance = entry({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50.00' });
      await createEntry(db, dfwAdmin, advance);
      for (const change of [
        { installmentAmount: '25.00' }, { recoveryPlan: 'full_next_payday', installmentAmount: null }, { effectiveDate: '2026-11-04' },
        { intendedPayday: '2026-11-14' }, { disbursedOutsidePayroll: false }, { reason: 'Other reason' }, { driverId: d2 },
      ]) {
        await assert.rejects(createEntry(db, dfwAdmin, { ...advance, ...change }), { status: 409 }, JSON.stringify(change));
      }
      const claim = entry({ type: 'manual_claim', claimType: 'Lost Item', amount: '20', waybill: 'TESTL050' });
      await createEntry(db, dfwAdmin, claim);
      await assert.rejects(createEntry(db, dfwAdmin, { ...claim, waybill: 'TESTL051' }), { status: 409 });
      await assert.rejects(createEntry(db, dfwAdmin, { ...claim, claimType: 'Damaged Item' }), { status: 409 });
      assert.equal((await createEntry(db, dfwAdmin, { ...advance })).replay, true, 'the identical form is still a replay');
    });

    await t.test('a carrier claim arriving after a hand-entered one is held; voiding the hand-entered one releases it', async () => {
      const handEntered = await createEntry(db, dfwAdmin, entry({ type: 'manual_claim', claimType: 'Damaged Item', amount: '40', waybill: 'TESTL060' }));
      const HEADER = ['date', 'Waybill No.', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes'];
      const carrier = (charge) => parseClaimsRows([HEADER, ['10/01/2026 10:00:00', 'TESTL060', 'damaged  item', 0, null, charge]], { courier: 'gofo' }).claims;
      const source = { importCityId: dfw, sourceFile: 'synthetic.xlsx', sourceSheet: 'Claims Detail' };
      const status = async () => (await one(
        "SELECT m.status FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id WHERE c.waybill = 'TESTL060' AND c.superseded_at IS NULL")).status;

      const first = await importClaims(db, carrier(-40), source);
      assert.deepEqual([first.inserted.length, first.held.length, String(first.held[0].ledgerEntryId)], [1, 1, String(handEntered.entry.id)]);
      assert.equal(await status(), 'review', 'kept as evidence, never deducted while the hand-entered claim stands');
      const amended = await importClaims(db, carrier(-45), source);
      assert.equal(amended.held.length, 1, 'an amended version is held too');
      assert.equal(await status(), 'review');

      await voidEntry(db, dfwAdmin, { entryId: handEntered.entry.id, requestId: randomUUID(), reason: 'Carrier sent it' });
      assert.equal(await status(), 'unresolved', 'released into matching once the hand-entered claim is voided');
    });

    await t.test('a credit correction can name the claim it refunds; the database refuses a claim on debits and other types', async () => {
      // With the pay run tables (#143), a refund must also fit what is still refundable: here there is no such claim.
      // Refunds that fit are tested in payRunReview.test.js.
      await assert.rejects(createEntry(db, dfwAdmin, entry({ type: 'correction', direction: 'credit', amount: '10', waybill: 'TESTL070', claimType: 'Damaged Item', claimCourier: 'gofo' })),
        { status: 409, message: /no carrier claim/ });
      for (const sql of [
        `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, waybill, created_by)
         VALUES ('${randomUUID()}', ${d1}, ${dfw}, 'expense', 'debit', 5, 'Test entry', '2026-11-03', 'TESTL071', ${dfwAdmin.id})`,
        `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, waybill, created_by)
         VALUES ('${randomUUID()}', ${d1}, ${dfw}, 'correction', 'credit', 5, 'Test entry', '2026-11-03', 'TESTL072', ${dfwAdmin.id})`,
        // A charge naming an exempt DFW GOFO tracking interruption claim, bypassing the form: refused by the database too.
        `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, waybill, claim_type, created_by)
         VALUES ('${randomUUID()}', ${d1}, ${dfw}, 'correction', 'debit', 40, 'Test entry', '2026-11-03', 'TESTL073', 'Tracking interruption', ${dfwAdmin.id})`,
        // A refund naming a claim without its courier could match two claims: refused.
        `INSERT INTO driver_ledger_entries (request_id, driver_id, city_id, entry_type, direction, amount, reason, effective_date, waybill, claim_type, created_by)
         VALUES ('${randomUUID()}', ${d1}, ${dfw}, 'correction', 'credit', 40, 'Test entry', '2026-11-03', 'TESTL074', 'Damaged Item', ${dfwAdmin.id})`,
      ]) {
        await savepoint(() => assert.rejects(db.query(sql), /check constraint/));
      }
    });

    await t.test('while one transaction checks a waybill and claim type, no other connection can check the same one', async () => {
      // The manual ledger and the carrier import share this lock, so their duplicate checks cannot run side by side.
      await lockClaimSubject(db, 'TESTL009', 'damaged item');
      const other = await pool.connect();
      try {
        await other.query('BEGIN');
        const tryLock = async (subject) => (await other.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 138)) AS got', [subject])).rows[0].got;
        assert.equal(await tryLock('TESTL009|damaged item'), false, 'held by the first transaction');
        assert.equal(await tryLock('TESTL009|fake pod'), true, 'another claim type is not blocked');
      } finally {
        await other.query('ROLLBACK');
        other.release();
      }
    });

    await t.test('history cannot be edited or deleted, even directly in the database', async () => {
      await savepoint(() => assert.rejects(db.query('UPDATE driver_ledger_entries SET amount = 1'), /cannot be changed/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM driver_ledger_entries'), /cannot be changed/));
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
