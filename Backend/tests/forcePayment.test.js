import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finalizeRun, generateRun, getRun } from '../services/payroll/payRuns/payRunStore.js';
import { FORCE_REASON_MAX, parseForcePayment, recordRunPayment, reviewRunPayments } from '../services/payroll/payRuns/paymentRecords.js';
import { getBatchView } from '../services/payments/everee/batchSubmit.js';
import { checkBatch } from '../services/payments/everee/paymentStatus.js';

// "Force mark as paid": a super admin records a driver as paid although the system cannot confirm it. The parser needs no database; the rest needs a PostgreSQL copy
// (never production): run with PAYROLL_TEST_DB=1 and the DB_* variables. It runs in one transaction that is always rolled back. Synthetic drivers and amounts only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const ARMED = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_PAYMENTS_ENABLED: 'true' };

test('the force request: a reason, a date, a confirmation and named drivers; the method is always "other" and the reason is kept as the reference', () => {
  const body = { requestId: randomUUID(), paidOn: '2026-11-10', reason: '  Paid   in cash at the depot  ', confirmed: true, statementIds: [5, 3, 5] };
  const { request, errors } = parseForcePayment(body);
  assert.equal(errors, undefined);
  assert.deepEqual(request, { requestId: body.requestId, paidOn: '2026-11-10', method: 'other', reference: 'Forced: Paid in cash at the depot', statementIds: [3, 5] });
  assert.equal(parseForcePayment({ ...body, method: 'cash', reference: 'x' }).request.method, 'other', 'a method sent by the caller is ignored');
  for (const [what, change, field] of [
    ['no request ID', { requestId: 'x' }, 'requestId'], ['no date', { paidOn: '' }, 'paidOn'], ['a nonsense date', { paidOn: '2026-13-40' }, 'paidOn'],
    ['no reason', { reason: '' }, 'reason'], ['a short reason', { reason: 'paid' }, 'reason'], ['a long reason', { reason: 'x'.repeat(FORCE_REASON_MAX + 1) }, 'reason'],
    ['no confirmation', { confirmed: false }, 'confirmed'], ['a confirmation that is not true', { confirmed: 'true' }, 'confirmed'],
    ['no drivers', { statementIds: [] }, 'statementIds'], ['no drivers at all', { statementIds: undefined }, 'statementIds'], ['a bad ID', { statementIds: [1, 'x'] }, 'statementIds'],
    ['too many drivers', { statementIds: Array.from({ length: 51 }, (_, i) => i + 1) }, 'statementIds'],
  ]) {
    const got = parseForcePayment({ ...body, ...change });
    assert.ok(got.errors?.[field], what);
    assert.equal(got.request, undefined, what);
  }
  assert.ok(parseForcePayment().errors, 'an empty body');
});

test('force mark as paid: a super admin only, for any payment status, with a reason; nothing else is bypassed', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-06-issue-236-payment-driver-type.sql', '2026-11-13-payment-method-check.sql', '2026-11-04-issue-031-everee-workers.sql',
      '2026-11-04-issue-031-everee-payments.sql', '2026-11-04-issue-031-everee-payment-status.sql']) await db.query(migration(m));
    const tag = randomUUID();
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Force City', 'TFORCE', 'WEEKLY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TF 1', 'Test Force City', 2, 1.6, 0.5, 0.25, 'TF-1') RETURNING id`)).id;
    const admin = (role, active = true) => one('INSERT INTO admin (password, name, email, role, is_active) VALUES (\'x\', $1, $2, $3, $4) RETURNING id, role', [`Test ${role} ${randomUUID()}`, `${randomUUID()}@example.test`, role, active]);
    const boss = await admin('superadmin');
    const plain = await admin('admin');
    const off = await admin('superadmin', false);
    // No driver has a type, so a normal payment is refused for every one of them (the type rule), which a forced mark does not depend on.
    const driver = async (n) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id",
      [`Force Driver ${n}`, `f${n}${tag}@example.com`, 8810000 + n, city])).id;
    const [d1, d2, d3, d4] = [await driver(1), await driver(2), await driver(3), await driver(4)];
    const rowOf = {};
    for (const [d, gross] of [[d1, '100.00'], [d2, '50.00'], [d3, '25.00'], [d4, '10.00']]) {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,0,0,$3,10) RETURNING id', [d, route, '2026-11-02'])).id;
      rowOf[d] = (await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 0 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross])).id;
    }
    const run = (await generateRun(db, boss, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'weekly' })).run;
    await finalizeRun(db, boss, run.id);
    const sOf = Object.fromEntries((await getRun(db, boss, run.id)).statements.map((s) => [s.driver_id, s]));
    const setStatus = (d, status) => db.query('UPDATE pay_statements SET payout_status = $2 WHERE id = $1', [sOf[d].id, status]);
    const stmt = (d) => one('SELECT payout_status, payout_reference, paid_at IS NOT NULL AS has_paid_at FROM pay_statements WHERE id = $1', [sOf[d].id]);
    const rowPaid = async (d) => (await one('SELECT paid, payment_date FROM payment_dashboard WHERE id = $1', [rowOf[d]]));
    const force = (d, over = {}, who = boss, options = {}) => recordRunPayment(db, who, run.id,
      { requestId: randomUUID(), paidOn: '2026-11-10', method: 'other', reference: 'Forced: Paid outside the system', statementIds: [sOf[d].id], ...over }, { force: true, ...options });
    let sp = 0;
    const rejects = async (fn, status, pattern) => {
      const name = `r${sp += 1}`;
      await db.query(`SAVEPOINT ${name}`);
      try { await assert.rejects(fn, (e) => e.status === status && (!pattern || pattern.test(e.message)), `expected ${status}`); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); }
    };
    const records = async () => Number((await one('SELECT count(*) AS n FROM pay_run_payment_records WHERE pay_run_id = $1', [run.id])).n);

    await t.test('only an active super admin in the database may force a payment: an admin, a disabled super admin and a stale token are refused and change nothing', async () => {
      await rejects(() => force(d1, {}, plain), 403, /super admin/);
      await rejects(() => force(d1, {}, off), 403);
      await rejects(() => force(d1, {}, { id: plain.id, role: 'superadmin' }), 403, /super admin/); // the token says super admin, the database says admin
      await rejects(() => force(d1, {}, { id: 987654321, role: 'superadmin' }), 403);
      assert.equal(await records(), 0);
      assert.equal((await stmt(d1)).payout_status, 'not_submitted');
    });

    await t.test('the normal way still refuses a payment in progress, a failed one and a driver with no type; the forced mark does not', async () => {
      await setStatus(d1, 'submitted');
      await setStatus(d2, 'unconfirmed');
      await setStatus(d3, 'failed');
      const normal = (d) => recordRunPayment(db, boss, run.id, { requestId: randomUUID(), paidOn: '2026-11-10', method: 'cash', reference: 'Synthetic cash', statementIds: [sOf[d].id] });
      await rejects(() => normal(d1), 409);
      await rejects(() => normal(d2), 409);
      await rejects(() => normal(d3), 409, /driver type/);
      assert.equal(await records(), 0, 'nothing was recorded the normal way');
    });

    await t.test('a submitted payment is marked paid by force: a receipt with the reason, the statement and its source rows paid, and the driver notified by the caller', async () => {
      const result = await force(d1);
      assert.equal(result.replay, false);
      assert.deepEqual([result.receipt.method, result.receipt.reference, result.receipt.drivers, result.receipt.total], ['other', 'Forced: Paid outside the system', 1, sOf[d1].net]);
      assert.deepEqual(result.driverNames, ['Force Driver 1']);
      const s = await stmt(d1);
      assert.deepEqual([s.payout_status, s.payout_reference, s.has_paid_at], ['paid', 'Forced: Paid outside the system', true]);
      assert.equal((await rowPaid(d1)).paid, true);
      const item = await one('SELECT i.amount::text AS amount, i.driver_type FROM pay_run_payment_items i WHERE i.statement_id = $1', [sOf[d1].id]);
      assert.deepEqual([item.amount, item.driver_type], [sOf[d1].net, null], 'a driver with no type is recorded with no type');
      assert.equal(await records(), 1);
    });

    await t.test('sending the same request again records nothing twice; the same ID with other details is refused; a statement already paid is left alone', async () => {
      const requestId = randomUUID();
      const first = await force(d2, { requestId });
      assert.equal(first.replay, false);
      const again = await force(d2, { requestId });
      assert.equal(again.replay, true);
      assert.equal(await records(), 2);
      await rejects(() => force(d2, { requestId, reference: 'Forced: A different reason' }), 409, /already used/);
      const paidAgain = await force(d1);
      assert.deepEqual([paidAgain.alreadyPaid, paidAgain.receipt], [true, null]);
      assert.equal(await records(), 2, 'a paid statement is never recorded twice');
    });

    await t.test('source earnings that changed or were already marked paid are not touched, but the statement is still marked paid', async () => {
      await db.query("UPDATE payment_dashboard SET paid = true, payment_date = '2026-01-01' WHERE id = $1", [rowOf[d3]]); // marked paid somewhere else
      const result = await force(d3);
      assert.equal(result.replay, false);
      assert.equal((await stmt(d3)).payout_status, 'paid');
      const row = await rowPaid(d3);
      assert.equal(String(row.payment_date.toISOString?.().slice(0, 10) ?? row.payment_date).slice(0, 10), '2026-01-01', 'the other mark is left exactly as it was');
    });

    await t.test('what makes a statement unpayable stays refused: a statement of another run, and a run that is not approved', async () => {
      await rejects(() => force(d4, { statementIds: [sOf[d4].id, 987654321] }), 400, /do not belong/);
      assert.equal((await stmt(d4)).payout_status, 'not_submitted');
      await db.query("UPDATE pay_runs SET status = 'voided', closed_at = now() WHERE id = $1", [run.id]);
      await rejects(() => force(d4), 409, /Approve this pay run/);
      await db.query("UPDATE pay_runs SET status = 'finalized', closed_at = NULL WHERE id = $1", [run.id]);
    });

    await t.test('an Everee item that was waiting is closed by the forced mark: it is shown as marked by an admin, is not counted as waiting or retried, and Everee is not asked about it again', async () => {
      const batch = await one(`INSERT INTO everee_payment_batches (request_id, pay_run_id, city_id, environment, preview_hash, driver_count, total, created_by)
        VALUES ($1, $2, $3, 'sandbox', $4, 1, 10.00, $5) RETURNING id`, [randomUUID(), run.id, city, 'a'.repeat(64), boss.id]);
      await setStatus(d4, 'unconfirmed');
      const item = await one(`INSERT INTO everee_payment_items (batch_id, pay_statement_id, driver_id, everee_worker_id, external_id, amount, status, everee_payment_id, payment_link)
        VALUES ($1, $2, $3, 'EW-4', $4, 10.00, 'unconfirmed', 'pay-4', 'event') RETURNING id`, [batch.id, sOf[d4].id, d4, `nasa-stmt-${sOf[d4].id}`]);
      const before = await getBatchView(db, boss, batch.id);
      assert.deepEqual([before.counts.unconfirmed, before.items[0].markedPaidByAdmin], [1, undefined], 'nothing is added to an item that was not closed');
      const review = await reviewRunPayments(db, boss, run.id);
      const entry = (r, d) => r.drivers.find((x) => String(x.statementId) === String(sOf[d].id));
      assert.equal(entry(review, d4).providerPayment.needsReview, true, 'unconfirmed needs a person before the forced mark');
      await force(d4);
      const after = await getBatchView(db, boss, batch.id);
      assert.deepEqual([after.counts.unconfirmed, after.counts.submitted, after.counts.failed, after.items[0].markedPaidByAdmin, after.canRetry], [0, 0, 0, true, false]);
      const reviewed = await reviewRunPayments(db, boss, run.id);
      assert.deepEqual([entry(reviewed, d4).providerPayment.markedPaidByAdmin, entry(reviewed, d4).providerPayment.needsReview, entry(reviewed, d4).payment.method], [true, false, 'other']);
      assert.equal(entry(review, d4).providerPayment.markedPaidByAdmin, undefined, 'the field is added only when it is true');
      let asked = 0;
      const client = new Proxy({}, { get: () => async () => { asked += 1; throw new Error('Everee must not be asked'); } });
      const checked = await checkBatch(db, boss, batch.id, { env: ARMED, client });
      assert.equal(checked.checked, 0, 'the closed item is not looked at again');
      assert.equal(asked, 0);
      assert.equal((await one('SELECT status FROM everee_payment_items WHERE id = $1', [item.id])).status, 'unconfirmed', 'the Everee item itself is not rewritten as paid');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
