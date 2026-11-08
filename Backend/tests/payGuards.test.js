import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AdminDashboardQueries } from '../services/admin/dashboardQueries.js';
import { loadEarnings } from '../services/payroll/payRuns/payRunStore.js';
import { publishStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// Calculate Payment must not touch rows that are part of an approved pay run or a verified carrier statement. Needs a PostgreSQL copy that has the app's
// tables (never production). Run with PAYROLL_TEST_DB=1 and the usual DB_* variables. Everything happens inside one transaction that is always rolled back.
// All values are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-08-issue-252-carrier-statements.sql', import.meta.url));
const ID_A = '90000201';
const ID_B = '90000202';
const STALE = '99.00';

const nestedPool = (client) => {
  let depth = 0;
  return {
    connect: async () => ({
      query: (sql, params) => {
        if (sql === 'BEGIN') { depth += 1; return client.query(`SAVEPOINT s${depth}`); }
        if (sql === 'COMMIT') { const name = `s${depth}`; depth -= 1; return client.query(`RELEASE SAVEPOINT ${name}`); }
        if (sql === 'ROLLBACK') { const name = `s${depth}`; depth -= 1; return client.query(`ROLLBACK TO SAVEPOINT ${name}`).then(() => client.query(`RELEASE SAVEPOINT ${name}`)); }
        return client.query(sql, params);
      },
      release: () => {},
    }),
  };
};

test('Calculate Payment recalculates open rows but leaves pay-run and verified-statement rows exactly as they are', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(MIGRATION, 'utf8'));
    const city = (await client.query("INSERT INTO city (job, city_code, city_type) VALUES ('Test Guard GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).rows[0].id;
    const route = async (code) => (await client.query(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 5, 3, 2.5, 1.5, $3) RETURNING id',
      [`Test ${code}`, 'Test Guard GOFO', code])).rows[0].id;
    const routeA = await route('TS01-001');
    const routeB = await route('TS01-002');
    const driver = async (name, code) => (await client.query(
      "INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, city])).rows[0].id;
    const driverA = await driver('Guard Test One', Number(ID_A));
    const driverB = await driver('Guard Test Two', Number(ID_B));
    // One Dashboard row: 2 first stops and 1 double stop, with a stale stored amount so a recalculation is visible.
    // `fresh` is work that has never been calculated: no driver payment, not closed.
    const work = async (driverId, routeId, day, { start = 0, end = 0, fresh = false, closed = !fresh } = {}) => {
      const dd = (await client.query(
        "INSERT INTO dashboard_data (driver_id, journey_date, route_id, packages, first_stop, ds, delivered, closed, paid, start_seq, end_seq) VALUES ($1, $2, $3, 3, 2, 1, 3, true, false, $4, $5) RETURNING id",
        [driverId, day, routeId, start, end])).rows[0].id;
      return (await client.query('UPDATE payment_dashboard SET driver_payment = $2, company_earnings = $2, closed = $3 WHERE dashboard_data_id = $1 RETURNING id',
        [dd, fresh ? null : STALE, closed])).rows[0].id;
    };
    const open = await work(driverA, routeA, '2026-09-01');                       // no statement, no pay run: recalculated
    const frozen = await work(driverA, routeA, '2026-09-02');                     // an earning on a pay statement
    const matched = await work(driverA, routeA, '2026-10-19');                    // matched in the verified statement
    const sameWeek = await work(driverB, routeB, '2026-10-22');                   // weekly row in the statement's week that the carrier did not bill
    const daily = await work(driverB, routeB, '2026-10-21', { start: 1, end: 5 }); // a daily-type row in that week: not a weekly row, recalculated
    const priced = await work(driverB, routeB, '2026-10-24', { closed: false });    // weekly row in the statement's week with a driver payment but not closed: still protected
    const fresh = await work(driverB, routeB, '2026-10-23', { fresh: true });       // weekly row in the statement's week with no pay yet, and no carrier match
    const admin = (await client.query("INSERT INTO admin (password, name, email, role) VALUES ('x', 'Guard Test Admin', 'guard.test@example.test', 'superadmin') RETURNING id")).rows[0].id;
    const payRun = (await client.query("INSERT INTO pay_runs (request_id, city_id, period_start, period_end, data_type, status, created_by, finalized_by, finalized_at) VALUES (gen_random_uuid(), $1, '2026-09-01', '2026-09-07', 'weekly', 'finalized', $2, $2, now()) RETURNING id", [city, admin])).rows[0].id;
    const statement = (await client.query("INSERT INTO pay_statements (pay_run_id, driver_id, gross, insurance, reimbursements, claim_deductions, recoveries, net, carried_forward) VALUES ($1, $2, 99, 0, 0, 0, 0, 99, 0) RETURNING id", [payRun, driverA])).rows[0].id;
    await client.query("INSERT INTO pay_statement_lines (statement_id, line_type, amount, payment_dashboard_id, journey_date) VALUES ($1, 'earning', 99, $2, '2026-09-02')", [statement, frozen]);

    const published = await publishStatement(nestedPool(client), await statementWorkbook(statementSheets({ idA: ID_A, idB: ID_B })), { user: { id: admin }, sourceLabel: 'guard test.xlsx' });
    assert.equal(published.status, 'published');

    const amounts = async () => Object.fromEntries((await client.query('SELECT id, driver_payment, company_earnings FROM payment_dashboard WHERE id = ANY($1)', [[open, frozen, matched, sameWeek, daily, fresh, priced]])).rows.map((r) => [r.id, [r.driver_payment, r.company_earnings]]));
    const result = await AdminDashboardQueries.updatePaymentTable(null, client);
    const after = await amounts();
    assert.deepEqual(after[open], ['7.50', '5.00'], 'an open row is recalculated from the route rates, as before');
    assert.deepEqual(after[daily], ['7.50', '5.00'], 'a daily-type row is recalculated, as before');
    assert.deepEqual(after[fresh], ['7.50', '5.00'], 'an open row in a verified statement week still gets its first calculation, and is closed');
    assert.deepEqual(after[priced], [STALE, STALE], 'a priced open row keeps its amounts');
    assert.equal(result.closedOnly, 1, 'and is reported as closed only');
    assert.equal((await client.query('SELECT closed FROM payment_dashboard WHERE id = $1', [priced])).rows[0].closed, true, 'but it is closed now');
    // Both open rows can now enter a pay run: the real pay-run loader returns them, with the priced one at its kept amount.
    const eligible = await loadEarnings(client, { city_id: city, period_start: '2026-10-19', period_end: '2026-10-25', data_type: 'weekly' });
    const gross = Object.fromEntries(eligible.map((e) => [e.id, e.gross]));
    assert.equal(gross[fresh], '7.50', 'the fresh row is eligible at its first calculation');
    assert.equal(gross[priced], STALE, 'the priced open row is eligible at the amount it already had');
    const september = await loadEarnings(client, { city_id: city, period_start: '2026-09-01', period_end: '2026-09-07', data_type: 'weekly' });
    assert.equal(september.some((e) => e.id === frozen), false, 'the pay-run earning is still excluded');
    assert.equal((await client.query('SELECT closed FROM payment_dashboard WHERE id = $1', [fresh])).rows[0].closed, true);
    for (const [name, id] of [['a pay-run earning', frozen], ['a row matched in a verified statement', matched], ['a weekly row in a verified statement week', sameWeek]]) {
      assert.deepEqual(after[id], [STALE, STALE], `${name} is left exactly as it was`);
    }
    assert.equal(result.protectedRows >= 3, true, 'the rows left alone are counted');

    // One date at a time follows the same rule, and a city admin's job list still limits it.
    const later = await AdminDashboardQueries.updatePaymentTableForDate('2026-10-19', ['Some Other City'], client);
    assert.deepEqual([later.updated, later.protectedRows], [0, 0], 'a job outside the list is never touched or counted');
    const same = await AdminDashboardQueries.updatePaymentTableForDate('2026-10-19', ['Test Guard GOFO'], client);
    assert.deepEqual([same.updated, same.protectedRows], [0, 1]);
    assert.deepEqual((await amounts())[matched], [STALE, STALE]);

    // Once the statement is voided its rows are ordinary again.
    await client.query("UPDATE carrier_statements SET status = 'voided', voided_at = now(), void_reason = 'test' WHERE status = 'published'");
    await AdminDashboardQueries.updatePaymentTable(null, client);
    assert.deepEqual((await amounts())[matched], ['7.50', '5.00']);
    assert.deepEqual((await amounts())[frozen], [STALE, STALE], 'a pay-run earning stays protected');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
