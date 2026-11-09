import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finalizeRun, generateRun, getRun } from '../services/payroll/payRuns/payRunStore.js';
import { listPaymentRuns } from '../services/payroll/payRuns/paymentRecords.js';
import { markProcessingRows } from '../services/payroll/payRuns/processingRows.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything, the migrations
// included, runs in one transaction that is always rolled back. Synthetic drivers, routes and amounts only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('payments in progress: the card keeps them out of what is left to pay, and the table rows say they are submitted', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-04-issue-031-everee-payments.sql', '2026-11-04-issue-031-everee-payment-status.sql']) await db.query(migration(m));
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const tag = randomUUID();
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Processing City', 'TPROC', 'WEEKLY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TP 1', 'Test Processing City', 2, 1.6, 0.5, 0.25, 'TP-1') RETURNING id`)).id;
    const superAdmin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`]);
    const driver = async (n) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id",
      [`Processing Driver ${n}`, `p${n}${tag}@example.com`, 8800000 + n, city])).id;
    const [d1, d2, d3] = [await driver(1), await driver(2), await driver(3)];
    const rowOf = {};
    let seq = 0;
    for (const [d, gross] of [[d1, '100.00'], [d2, '50.00'], [d3, '25.00']]) {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,0,0,$3,10) RETURNING id', [d, route, '2026-11-02'])).id;
      seq += 1;
      rowOf[d] = (await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 0 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross])).id;
    }
    const run = (await generateRun(db, superAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'weekly' })).run;
    await finalizeRun(db, superAdmin, run.id);
    const statements = (await getRun(db, superAdmin, run.id)).statements;
    const sOf = Object.fromEntries(statements.map((s) => [s.driver_id, s]));
    const setStatus = (driver, status) => db.query('UPDATE pay_statements SET payout_status = $2 WHERE id = $1', [sOf[driver].id, status]);
    const rows = (...drivers) => drivers.map((d) => ({ id: rowOf[d], driver_id: d, paid: false }));
    const card = async () => (await listPaymentRuns(db, superAdmin, { cityId: city })).runs.find((r) => String(r.id) === String(run.id));
    const cents = (v) => Math.round(Number(v) * 100);

    await t.test('nothing sent yet: everything is left to pay and nothing is marked', async () => {
      const c = await card();
      assert.deepEqual([c.paid, c.processing, c.drivers, cents(c.remaining), cents(c.processing_total)], [0, 0, 3, 17500, 0]);
      assert.deepEqual((await markProcessingRows(db, rows(d1, d2, d3))).filter((r) => r.payout_state), []);
    });

    await t.test('a submitted and an unconfirmed payment leave "remaining" and are shown apart; their rows say processing; the third is untouched', async () => {
      await setStatus(d1, 'submitted');
      await setStatus(d2, 'unconfirmed');
      const c = await card();
      assert.deepEqual([c.paid, c.processing, c.drivers, cents(c.remaining), cents(c.processing_total), cents(c.total)], [0, 2, 3, 2500, 15000, 17500]);
      const marked = await markProcessingRows(db, rows(d1, d2, d3));
      assert.deepEqual(marked.map((r) => r.payout_state ?? null), ['processing', 'processing', null]);
    });

    await t.test('a row that is already paid is never marked, a row of no run is never marked, and nothing but a field is added', async () => {
      const input = [{ id: rowOf[d1], paid: true }, { id: rowOf[d2], paid: false, driver_name: 'X' }, { id: 987654321, paid: false }];
      const out = await markProcessingRows(db, input);
      assert.deepEqual(out.map((r) => r.payout_state ?? null), [null, 'processing', null]);
      assert.deepEqual(out[1], { id: rowOf[d2], paid: false, driver_name: 'X', payout_state: 'processing' });
      assert.deepEqual(await markProcessingRows(db, []), []);
      assert.equal(await markProcessingRows(db, null), null);
    });

    await t.test('once Everee confirms (the statement is paid) it counts as paid and is no longer processing; the others stay as they were', async () => {
      await setStatus(d1, 'paid');
      await db.query('UPDATE pay_statements SET paid_at = now() WHERE id = $1', [sOf[d1].id]);
      await db.query('UPDATE payment_dashboard SET paid = true WHERE id = $1', [rowOf[d1]]);
      const c = await card();
      assert.deepEqual([c.paid, c.processing, c.drivers, cents(c.remaining), cents(c.processing_total)], [1, 1, 3, 2500, 5000]);
      const marked = await markProcessingRows(db, [{ id: rowOf[d1], paid: true }, { id: rowOf[d2], paid: false }]);
      assert.deepEqual(marked.map((r) => r.payout_state ?? null), [null, 'processing']);
    });

    await t.test('a failed payment is payable again: it returns to "remaining" and is no longer marked', async () => {
      await setStatus(d2, 'failed');
      const c = await card();
      assert.deepEqual([c.processing, cents(c.remaining), cents(c.processing_total)], [0, 7500, 0]);
      assert.deepEqual((await markProcessingRows(db, rows(d2))).map((r) => r.payout_state ?? null), [null]);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
