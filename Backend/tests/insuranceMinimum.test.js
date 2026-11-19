import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finalizeRun, generateRun, getRun } from '../services/payroll/payRuns/payRunStore.js';
import { invalidWork, recordRunPayment } from '../services/payroll/payRuns/paymentRecords.js';
import { driverPayable } from '../services/payroll/ledger/driverPayable.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything, the migrations included, runs in one
// transaction that is always rolled back. Synthetic drivers, routes and amounts only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

// What the changed-earnings check compares (pure): a statement that waived insurance has a source row that still carries it.
const row = (over = {}) => ({ statement_id: 1, same_work: true, closed: true, paid: false, gross: '0.25', frozen_gross: '0.25', insurance: '1.92', frozen_insurance: '0.00', insurance_waived: true, ...over });
test('changed earnings: a statement drafted with no insurance is not "changed" because its row still carries insurance; an ordinary statement still is', () => {
  const statement = [{ id: 1, earning_lines: 1 }];
  assert.equal(invalidWork(statement, [row()]).size, 0, 'waived, nothing frozen, row still has 1.92');
  assert.equal(invalidWork(statement, [row({ frozen_insurance: '1.92' })]).size, 1, 'waived, but insurance was frozen: something is wrong');
  assert.equal(invalidWork(statement, [row({ insurance_waived: false, frozen_insurance: '1.92' })]).size, 0, 'an ordinary statement: row and frozen insurance agree');
  assert.equal(invalidWork(statement, [row({ insurance_waived: false, frozen_insurance: '0.00' })]).size, 1, 'an ordinary statement whose row insurance changed is still caught');
  assert.equal(invalidWork(statement, [row({ insurance_waived: false, insurance: '3.00', frozen_insurance: '1.92' })]).size, 1);
});

test('pay under $5: the draft takes no insurance, it can be approved and paid; pay of $5 or more still pays insurance', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-06-issue-236-payment-driver-type.sql', '2026-11-13-payment-method-check.sql']) await db.query(migration(m));
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const tag = randomUUID();
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Insurance City', 'TINS', 'WEEKLY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TI 1', 'Test Insurance City', 2, 1.6, 0.5, 0.25, 'TI-1') RETURNING id`)).id;
    const boss = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `${tag}@example.test`]);
    const driver = async (n) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled, driver_type) VALUES ('x', $1, $2, $3, $4, true, 'LOCAL') RETURNING id",
      [`Insurance Driver ${n}`, `i${n}${tag}@example.com`, 8820000 + n, city])).id;
    const [small, big] = [await driver(1), await driver(2)];
    // One day each, 1.92 insurance on each row, exactly as the weekly upload leaves it: $0.25 of pay and $50.00 of pay.
    const rowOf = {};
    for (const [d, gross] of [[small, '0.25'], [big, '50.00']]) {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,0,0,$3,10) RETURNING id', [d, route, '2026-11-12'])).id;
      rowOf[d] = (await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 1.92 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross])).id;
    }

    await t.test('the Payroll page amount owed is the pay itself when it is under $5, and pay minus insurance otherwise', async () => {
      assert.equal(await driverPayable(db, small, city), '0.25');
      assert.equal(await driverPayable(db, big, city), '48.08');
    });

    const run = (await generateRun(db, boss, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-09', periodEnd: '2026-11-15', dataType: 'weekly' })).run;
    const statements = (await getRun(db, boss, run.id)).statements;
    const of = Object.fromEntries(statements.map((s) => [s.driver_id, s]));

    await t.test('the draft: the small driver nets their pay with a flag and no insurance line; the other driver is unchanged', async () => {
      assert.deepEqual([of[small].gross, of[small].insurance, of[small].net], ['0.25', '0.00', '0.25']);
      assert.ok((of[small].flags ?? []).some((f) => f.code === 'insurance_waived'));
      assert.deepEqual([of[big].gross, of[big].insurance, of[big].net], ['50.00', '1.92', '48.08']);
      const lines = async (d) => (await db.query("SELECT line_type FROM pay_statement_lines WHERE statement_id = $1 AND active ORDER BY line_type", [of[d].id])).rows.map((r) => r.line_type);
      assert.deepEqual(await lines(small), ['earning']);
      assert.deepEqual(await lines(big), ['earning', 'insurance']);
    });

    await t.test('the run can be approved (no statement is below zero), and both drivers can be paid: the source row still carrying insurance is not "changed work"', async () => {
      await finalizeRun(db, boss, run.id);
      const pay = (d) => recordRunPayment(db, boss, run.id, { requestId: randomUUID(), paidOn: '2026-11-17', method: 'cash', reference: 'Synthetic cash', statementIds: [of[d].id] });
      await pay(small);
      await pay(big);
      const paid = (await db.query('SELECT driver_id, payout_status FROM pay_statements WHERE pay_run_id = $1', [run.id])).rows;
      assert.deepEqual(paid.map((r) => r.payout_status), ['paid', 'paid']);
      // The source rows are marked paid; the small driver's row still shows the insurance that was not taken (nothing about the source data was rewritten).
      const small1 = await one('SELECT paid, insurance_deduction::text AS insurance FROM payment_dashboard WHERE id = $1', [rowOf[small]]);
      assert.deepEqual([small1.paid, small1.insurance], [true, '1.92']);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
