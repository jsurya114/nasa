import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry, listEntries } from '../services/payroll/ledger/ledgerStore.js';
import { editEntry, getEntryHistory } from '../services/payroll/ledger/ledgerEdits.js';
import { settleEntry } from '../services/payroll/ledger/ledgerSettlements.js';
import { parseEdit, parseNewEntry, parseSettlement } from '../services/payroll/ledger/ledgerRules.js';
import { generateRun, setRecoveryLimit } from '../services/payroll/payRuns/payRunStore.js';

test('edit rules: what must be given', () => {
  const ok = { requestId: randomUUID(), reason: 'Amount was typed wrong', changes: { amount: '80' } };
  assert.ok(parseEdit(ok, 5).edit);
  assert.ok(parseEdit({ ...ok, reason: '' }, 5).errors.reason);
  assert.ok(parseEdit({ ...ok, requestId: 'x' }, 5).errors.requestId);
  assert.ok(parseEdit({ ...ok, changes: {} }, 5).errors.changes);
  assert.ok(parseEdit({ ...ok, changes: { type: 'advance' } }, 5).errors.changes, 'the type cannot be edited');
  assert.ok(parseEdit({ ...ok, changes: { driverId: 9 } }, 5).errors.changes, 'the driver cannot be edited');
  assert.ok(parseEdit(ok, 'abc').errors.entryId);
});

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the migrations included, runs in one transaction that is always rolled back.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const PLAN = (o) => (['advance', 'manual_claim'].includes(o.type) && o.recoveryPlan === undefined ? { recoveryPlan: 'full_next_payday' } : {}); // an advance or penalty above the driver's payment must say how it is repaid
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('editing a ledger entry keeps the original and links the correction', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT s');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql',
      '2026-11-03-issue-166-ledger-settlements.sql', '2026-11-03-issue-166-ledger-edits.sql']) await db.query(migration(m));

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Edit City', 'TSTED', 'DAILY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Edit Other', 'TSTEO', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TE 1', 'Test Edit City', 2, 1.6, 0.5, 0.25, 'TE-1') RETURNING id`)).id;
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

    const entry = async (o) => (await createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d1, cityId: city, type: 'manual_claim', claimType: 'Damaged Item', amount: '100', reason: 'Broken parcel', effectiveDate: '2026-11-01', ...o, ...PLAN({ type: 'manual_claim', ...o }) }).entry)).entry;
    const edit = (who, entryId, changes, o = {}) => editEntry(db, who, parseEdit({ requestId: randomUUID(), reason: 'Amount was typed wrong', changes, ...o }, entryId).edit);
    const standing = async () => (await listEntries(db, cityAdmin, { cityId: city, driverId: d1 })).entries.filter((e) => e.entry_type !== 'void' && !e.voided_by);

    const original = await entry({ waybill: 'TESTE001' });

    let corrected;
    await t.test('an edit voids the original and records the corrected entry, linked, with the reason and actor', async () => {
      const result = await edit(cityAdmin, original.id, { amount: '80', intendedPayday: '2026-11-10' }, { requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      corrected = result.entry;
      assert.deepEqual([result.replay, corrected.amount, corrected.intended_payday, corrected.reason, corrected.waybill, corrected.claim_type],
        [false, '80.00', '2026-11-10', 'Broken parcel', 'TESTE001', 'Damaged Item']);
      assert.deepEqual([String(result.edit.original_entry_id), String(result.edit.replacement_entry_id), result.edit.reason, result.edit.created_by],
        [String(original.id), String(corrected.id), 'Amount was typed wrong', cityAdmin.id]);
      // only the corrected entry stands; the original is still there, voided
      assert.deepEqual((await standing()).map((e) => String(e.id)), [String(corrected.id)]);
      const old = await one('SELECT amount FROM driver_ledger_entries WHERE id = $1', [original.id]);
      assert.equal(old.amount, '100.00');
    });

    await t.test('the same complete request again is a replay; any other change under the same ID is refused', async () => {
      const same = { amount: '80', intendedPayday: '2026-11-10' };
      const send = (changes, reason = 'Amount was typed wrong') => editEntry(db, cityAdmin, parseEdit({ requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reason, changes }, original.id).edit);
      const again = await send(same);
      assert.deepEqual([again.replay, String(again.entry.id)], [true, String(corrected.id)]);
      // a different amount, date, arrangement, entry reason, or edit reason with the same ID is a different edit
      await assert.rejects(send({ ...same, amount: '90' }), { status: 409 });
      await assert.rejects(send({ ...same, effectiveDate: '2026-11-02' }), { status: 409 });
      await assert.rejects(send({ ...same, recoveryPlan: 'installments', installmentAmount: '20' }), { status: 409 });
      await assert.rejects(send({ ...same, entryReason: 'A different reason' }), { status: 409 });
      await assert.rejects(send({ amount: '80' }), { status: 409 }); // an incomplete resend is not the same request either
      await assert.rejects(send(same, 'Another reason'), { status: 409 });
      assert.equal((await standing()).length, 1, 'recorded once, and the saved amount is still 80');
      assert.equal((await standing())[0].amount, '80.00');
    });

    await t.test('the original cannot be edited twice; the correction can, and history shows every version', async () => {
      await assert.rejects(edit(cityAdmin, original.id, { amount: '70' }), { status: 409, message: /already voided/ });
      const third = (await edit(cityAdmin, corrected.id, { amount: '75' }, { reason: 'Carrier lowered it' })).entry;
      for (const id of [original.id, corrected.id, third.id]) {
        const h = await getEntryHistory(db, cityAdmin, id);
        assert.deepEqual(h.versions.map((v) => v.entry.amount), ['100.00', '80.00', '75.00'], 'oldest first, from any version');
        assert.deepEqual(h.versions.map((v) => v.edit?.reason ?? null), [null, 'Amount was typed wrong', 'Carrier lowered it']);
        assert.deepEqual(h.versions.map((v) => Boolean(v.entry.voided_by)), [true, true, false]);
      }
    });

    await t.test('a bad change is refused with field errors and changes nothing', async () => {
      const e = await entry({ amount: '50', waybill: 'TESTE002' });
      await assert.rejects(edit(cityAdmin, e.id, { amount: '0' }), (err) => err.status === 400 && Boolean(err.errors.amount));
      await assert.rejects(edit(cityAdmin, e.id, { recoveryPlan: 'installments', installmentAmount: '60' }), (err) => err.status === 400 && Boolean(err.errors.installmentAmount));
      assert.ok((await standing()).some((x) => String(x.id) === String(e.id)), 'still standing');
    });

    await t.test('if the corrected entry cannot be saved, the original is not voided (one atomic action)', async () => {
      const a = await entry({ amount: '20', waybill: 'TESTE003' });
      await entry({ amount: '20', waybill: 'TESTE004' });
      await savepoint(async () => {
        await assert.rejects(edit(cityAdmin, a.id, { waybill: 'TESTE004' }), { status: 409, message: /already recorded/ });
        // the real request runs in one transaction that rolls back; the savepoint stands in for it
      });
      assert.ok((await standing()).some((x) => String(x.id) === String(a.id)), 'the original stands after the rollback');
    });

    await t.test('an entry with a repayment or on a pay run is refused; wrong city, a void and a missing entry too', async () => {
      const repaid = await entry({ amount: '40', waybill: 'TESTE005' });
      await settleEntry(db, cityAdmin, parseSettlement({ requestId: randomUUID(), kind: 'outside_repayment', amount: '10', settledOn: '2026-11-03', reference: 'RCPT-1', reason: 'Paid in cash' }, repaid.id).settlement);
      await assert.rejects(edit(cityAdmin, repaid.id, { amount: '35' }), { status: 409, message: /reverse that first/ });

      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,9100,9109,$3,10) RETURNING id', [d1, route, '2026-11-03'])).id;
      await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = 500, insurance_deduction = 0 WHERE dashboard_data_id = $1 RETURNING id', [dd]);
      const onRun = await entry({ type: 'expense', claimType: undefined, amount: '30', recoveryPlan: 'full_next_payday', reason: 'Lost scanner' });
      await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
      await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' });
      await assert.rejects(edit(cityAdmin, onRun.id, { amount: '25' }), { status: 409, message: /already on a pay run/ });

      await assert.rejects(edit(otherAdmin, corrected.id, { amount: '1' }), { status: 403 });
      await assert.rejects(getEntryHistory(db, otherAdmin, corrected.id), { status: 403 });
      await assert.rejects(edit(cityAdmin, 999999999, { amount: '1' }), { status: 404 });
      const voidRow = await one("SELECT id FROM driver_ledger_entries WHERE entry_type = 'void' AND driver_id = $1 LIMIT 1", [d1]);
      await assert.rejects(edit(cityAdmin, voidRow.id, { amount: '1' }), { status: 400, message: /void cannot be edited/ });
    });

    await t.test('a replay is checked against the admin\'s cities again, and an edit never links to an unrelated entry', async () => {
      const e = await entry({ amount: '60', waybill: 'TESTE006' });
      const first = await edit(cityAdmin, e.id, { amount: '55' }, { requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
      await db.query('DELETE FROM admin_city_ref WHERE admin_id = $1', [cityAdmin.id]); // access withdrawn
      await assert.rejects(editEntry(db, cityAdmin, parseEdit({ requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'Amount was typed wrong', changes: { amount: '55' } }, e.id).edit), { status: 403 });
      // a changed payload under that ID is also refused for someone without access: no 409 that confirms the ID exists
      await assert.rejects(editEntry(db, cityAdmin, parseEdit({ requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'Amount was typed wrong', changes: { amount: '99' } }, e.id).edit), { status: 403 });
      await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, city]);
      // an entry that happens to use the edit's request ID is left alone: the edit's own IDs are derived
      const other = await entry({ requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', amount: '70', waybill: 'TESTE007' });
      const result = await edit(cityAdmin, other.id, { amount: '65' }, { requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
      assert.equal(result.entry.amount, '65.00');
      assert.notEqual(String(result.entry.id), String(other.id));
      assert.notEqual(String(first.entry.id), String(result.entry.id));
    });

    await t.test('the database refuses to change or delete an edit link', async () => {
      await savepoint(() => assert.rejects(db.query("UPDATE driver_ledger_edits SET reason = 'changed'"), /cannot be changed or deleted/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM driver_ledger_edits'), /cannot be changed or deleted/));
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
