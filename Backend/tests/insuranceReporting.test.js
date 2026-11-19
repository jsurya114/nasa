import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { discardRun, finalizeRun, generateRun, getRun } from '../services/payroll/payRuns/payRunStore.js';
import { recordRunPayment } from '../services/payroll/payRuns/paymentRecords.js';
import { AdminDashboardQueries } from '../services/admin/dashboardQueries.js';
import driverDeliveryQuery from '../services/driver/deliveryQuery.js';

// What every screen and report shows as the insurance withheld must be what the pay statement charged (a driver paid under $5 in a run pays none), while the
// upload's pay row still carries $1.92 a day. Needs a PostgreSQL copy with the app's tables and the reporting views (never production). Run with PAYROLL_TEST_DB=1
// and the DB_* variables. One transaction, always rolled back. Synthetic drivers, routes and amounts only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const MIGRATION = '2026-11-19-reporting-insurance-from-statement.sql';
const ROLLBACK = '2026-11-19-reporting-insurance-from-statement.rollback.sql';

test('insurance shown on the Dashboard, the driver screens and the reporting view follows the pay statement', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-06-issue-236-payment-driver-type.sql', '2026-11-13-payment-method-check.sql', '2026-11-08-issue-252-carrier-statements.sql',
      '2026-11-08-issue-252-reporting-statement-revenue.sql', MIGRATION]) await db.query(migration(m));
    await db.query(migration(MIGRATION)); // safe to run twice
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const tag = randomUUID();
    const job = `Test Insurance Report ${tag.slice(0, 8)}`;
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, 'TIR', 'WEEKLY') RETURNING id", [job])).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TIR 1', $1, 2, 1.6, 0.5, 0.25, $2) RETURNING id`, [job, `TIR-${tag.slice(0, 8)}`])).id;
    const boss = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `${tag}@example.test`]);
    const driver = async (n) => one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled, driver_type) VALUES ('x', $1, $2, $3, $4, true, 'LOCAL') RETURNING id, name",
      [`Report Driver ${n} ${tag.slice(0, 6)}`, `r${n}${tag}@example.com`, 8830000 + n, city]);
    const small = await driver(1);
    const big = await driver(2);
    const rows = {};
    const payRow = async (d, key, date, gross, insurance) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,0,0,$3,10) RETURNING id', [d.id, route, date])).id;
      rows[key] = (await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross, insurance])).id;
    };
    // The week 9 to 15 Nov: the small driver worked one day ($0.25), the big driver three days ($100.00 each). Insurance $1.92 on each day, as the upload leaves it.
    await payRow(small, 'small', '2026-11-12', '0.25', '1.92');
    await payRow(big, 'big1', '2026-11-10', '100.00', '1.92');
    await payRow(big, 'big2', '2026-11-11', '100.00', '1.92');
    await payRow(big, 'big3', '2026-11-12', '100.00', '1.92');
    // Work of the NEXT week, not on any pay run yet: it keeps the stored amount.
    await payRow(small, 'later', '2026-11-19', '3.00', '1.92');
    await payRow(big, 'unset', '2026-11-20', '10.00', null); // insurance not set on the row at all

    const cents = (v) => Math.round(Number(v) * 100);
    const week = { job, startDate: '2026-11-09', endDate: '2026-11-15' };
    const total = async (filters = week) => cents((await AdminDashboardQueries.getSummaryData(filters, boss.id, 'superadmin', db)).total_insurance_deduction);
    const listed = async (filters = week) => Object.fromEntries((await AdminDashboardQueries.getPaymentDashboardPaginated(filters, boss.id, 'superadmin', 100, 0, db)).map((r) => [r.id, cents(r.insurance_deduction)]));
    const tabled = async (filters = week) => Object.fromEntries((await AdminDashboardQueries.PaymentDashboardTable(filters, boss.id, 'superadmin', db)).map((r) => [r.id, cents(r.insurance_deduction)]));
    const driverScreen = async (d) => Object.fromEntries((await driverDeliveryQuery.fetchDeliverySummary(d.id, null, null, db)).map((r) => [r.id, cents(r.insurance_deduction)]));
    const facts = async () => Object.fromEntries((await db.query('SELECT fact_id, insurance_withheld FROM reporting.delivery_facts WHERE fact_id = ANY($1::int[])', [Object.values(rows)])).rows.map((r) => [r.fact_id, cents(r.insurance_withheld)]));
    // Every place that shows insurance agrees with `expected` (cents by pay row).
    const everywhere = async (label, expected) => {
      assert.deepEqual(await listed({ job }), expected.list, `${label}: Dashboard list`);
      assert.deepEqual(await tabled({ job }), expected.list, `${label}: Dashboard table`);
      assert.deepEqual(await facts(), expected.list, `${label}: reporting view`);
      assert.equal(await total(), expected.week, `${label}: Dashboard total for the week`);
      assert.deepEqual(await driverScreen(small), { [rows.small]: expected.list[rows.small], [rows.later]: expected.list[rows.later] }, `${label}: driver screen (small)`);
      assert.deepEqual(await driverScreen(big), { [rows.big1]: expected.list[rows.big1], [rows.big2]: expected.list[rows.big2], [rows.big3]: expected.list[rows.big3], [rows.unset]: expected.list[rows.unset] }, `${label}: driver screen (big)`);
    };
    const stored = { [rows.small]: 192, [rows.big1]: 192, [rows.big2]: 192, [rows.big3]: 192, [rows.later]: 192, [rows.unset]: 0 };

    await t.test('before any pay run, everything shows the stored insurance, exactly as before (a row with none stored stays empty on screen and counts as 0 in the view)', async () => {
      await everywhere('no run', { list: stored, week: 4 * 192 });
      const [unset] = await AdminDashboardQueries.getPaymentDashboardPaginated({ job, startDate: '2026-11-20', endDate: '2026-11-20' }, boss.id, 'superadmin', 10, 0, db);
      assert.equal(unset.insurance_deduction, null);
      const [shown] = await AdminDashboardQueries.getPaymentDashboardPaginated({ job, startDate: '2026-11-10', endDate: '2026-11-10' }, boss.id, 'superadmin', 10, 0, db);
      assert.equal(shown.insurance_deduction, '1.92', 'same two-decimal format as the column');
    });

    let run;
    await t.test('in a draft, the small driver (pay under $5) shows no insurance and the big driver keeps $1.92 on each day; work outside the run keeps the stored amount', async () => {
      run = (await generateRun(db, boss, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-09', periodEnd: '2026-11-15', dataType: 'weekly' })).run;
      const expected = { list: { ...stored, [rows.small]: 0 }, week: 3 * 192 };
      await everywhere('draft', expected);
      // Part of a multi-day run: one day alone shows that day's insurance, nothing doubled and nothing moved to another day.
      assert.equal(await total({ job, startDate: '2026-11-11', endDate: '2026-11-11' }), 192);
      assert.equal(await total({ job, startDate: '2026-11-12', endDate: '2026-11-12' }), 192, 'the 12th: the big driver 1.92, the small driver 0');
      assert.deepEqual(await listed({ job, driver: big.name, startDate: '2026-11-10', endDate: '2026-11-10' }), { [rows.big1]: 192 });
      assert.deepEqual(await listed({ job, driver: small.name, startDate: '2026-11-12', endDate: '2026-11-12' }), { [rows.small]: 0 });
    });

    await t.test('a discarded draft releases the rows: the stored insurance shows again', async () => {
      await discardRun(db, boss, run.id, 'Synthetic discard');
      await everywhere('discarded', { list: stored, week: 4 * 192 });
      run = (await generateRun(db, boss, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-09', periodEnd: '2026-11-15', dataType: 'weekly' })).run;
      await everywhere('drafted again', { list: { ...stored, [rows.small]: 0 }, week: 3 * 192 });
    });

    await t.test('once approved and paid, the paid history keeps the amounts the statement charged, even if the stored row changes later', async () => {
      await finalizeRun(db, boss, run.id);
      const statements = (await getRun(db, boss, run.id)).statements;
      for (const s of statements) {
        await recordRunPayment(db, boss, run.id, { requestId: randomUUID(), paidOn: '2026-11-17', method: 'cash', reference: 'Synthetic cash', statementIds: [s.id] });
      }
      const expected = { list: { ...stored, [rows.small]: 0 }, week: 3 * 192 };
      await everywhere('paid', expected);
      // A later upload changes the stored amounts of paid rows: the statements, and so every screen, still show what was charged.
      await db.query('UPDATE payment_dashboard SET insurance_deduction = 9.99 WHERE id = ANY($1::int[])', [[rows.small, rows.big1, rows.big2, rows.big3]]);
      await everywhere('paid, source changed', expected);
    });

    await t.test('the rollback puts the view back to the stored amount, and the migration is safe to run again', async () => {
      await db.query(migration(ROLLBACK));
      assert.equal((await facts())[rows.small], 999, 'after the rollback the view reads the stored row again');
      await db.query(migration(MIGRATION));
      assert.equal((await facts())[rows.small], 0);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
