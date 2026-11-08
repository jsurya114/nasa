import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publishStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { holdMatchedWork, voidStatement } from '../services/finance/gofoStatement/statementStore.js';
import { isStatementWorkConflict } from '../services/finance/gofoStatement/workGuard.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// A journey that carries revenue verified by a standing carrier statement cannot be moved or deleted; after a void it can. Needs a PostgreSQL copy that has the
// app's tables (never production). PAYROLL_TEST_DB=1 and the DB_* variables. One rolled-back transaction, made-up data.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-08-issue-252-carrier-statements.sql', import.meta.url));
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

test('a journey with verified carrier revenue cannot be moved or deleted until the statement is voided', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  const attempt = async (sql, params) => {
    await client.query('SAVEPOINT attempt');
    try { await client.query(sql, params); return null; } catch (error) { return error; } finally { await client.query('ROLLBACK TO SAVEPOINT attempt'); }
  };
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(MIGRATION, 'utf8'));
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Guard Evidence GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).id;
    const other = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Guard Evidence Other', 'OTH GOFO', 'WEEKLY') RETURNING id")).id;
    const route = async (job, code) => (await one('INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 0, 3, 0, 1.5, $3) RETURNING id', [`Test ${code}`, job, code])).id;
    const routeA = await route('Test Guard Evidence GOFO', 'TS01-001');
    await route('Test Guard Evidence GOFO', 'TS01-002');
    const routeOther = await route('Test Guard Evidence Other', 'OT01-001');
    const driver = async (name, code) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, city])).id;
    const driverA = await driver('Evidence Test One', 90000701);
    const driverB = await driver('Evidence Test Two', 90000702);
    const journey = async (driverId, routeId, day) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages, delivered, closed, paid) VALUES ($1,$2,$3,0,0,2,2,true,false) RETURNING id', [driverId, routeId, day])).id;
      await client.query('UPDATE payment_dashboard SET driver_payment = 3, delivered = 2 WHERE dashboard_data_id = $1', [dd]);
      return dd;
    };
    const matched = await journey(driverA, routeA, '2026-10-19');   // carries the carrier's 2.61
    const unbilled = await journey(driverB, routeA, '2026-10-23');  // no carrier fee for it
    const published = await publishStatement(nestedPool(client), await statementWorkbook(statementSheets({ idA: '90000701', idB: '90000702' })), { user: { id: 1 }, sourceLabel: 'guard.xlsx' });
    assert.equal(published.status, 'published');
    const revenue = async () => (await one("SELECT COALESCE(sum(delivery_revenue), 0)::text AS v FROM reporting.delivery_facts WHERE city_id = $1", [city])).v;
    const before = await revenue();

    const moved = await attempt('UPDATE dashboard_data SET route_id = $2 WHERE id = $1', [matched, routeOther]);
    assert.equal(isStatementWorkConflict(moved), true, 'moving it to a route of another city is refused');
    assert.match(moved.message, /verified by carrier statement .* Void that statement first/);
    assert.equal(isStatementWorkConflict(await attempt('UPDATE dashboard_data SET driver_id = $2 WHERE id = $1', [matched, driverB])), true, 'so is giving it to another driver');
    assert.equal(isStatementWorkConflict(await attempt("UPDATE dashboard_data SET journey_date = '2026-10-21' WHERE id = $1", [matched])), true, 'or another day');
    assert.equal(isStatementWorkConflict(await attempt('DELETE FROM dashboard_data WHERE id = $1', [matched])), true, 'and deleting it');
    assert.equal(await attempt('UPDATE dashboard_data SET packages = 5, route_id = $2 WHERE id = $1', [matched, routeA]), null, 'edits that do not move it are not affected');
    assert.equal(await attempt('UPDATE dashboard_data SET driver_id = $2 WHERE id = $1', [unbilled, driverA]), null, 'a journey the statement does not carry is free');
    assert.equal(await attempt('DELETE FROM dashboard_data WHERE id = $1', [unbilled]), null);
    assert.equal(await revenue(), before, 'the refused edits changed no revenue');

    // Publishing also locks the matched rows and re-checks them, so a journey changed between matching and commit cannot leave a statement pointing at other work.
    assert.equal(await holdMatchedWork(client, published.statementId), true, 'every matched journey is still there and unchanged');
    await client.query('SAVEPOINT bypass');
    await client.query('SET LOCAL session_replication_role = replica'); // simulates an edit that slipped past the trigger (the race), for this test only
    await client.query('UPDATE payment_dashboard SET route_id = $2 WHERE dashboard_data_id = $1', [matched, routeOther]);
    assert.equal(await holdMatchedWork(client, published.statementId), false, 'a journey that changed under the statement is detected');
    await client.query('ROLLBACK TO SAVEPOINT bypass');
    assert.equal(await holdMatchedWork(client, published.statementId), true);

    // Voiding is the supported correction path: the history stays, and the journey is free to change or delete (no foreign key blocks it any more).
    assert.equal(await voidStatement(client, published.statementId, { actorId: 1, reason: 'fixing the journey, then publishing again' }), true);
    assert.equal(await attempt('UPDATE dashboard_data SET route_id = $2 WHERE id = $1', [matched, routeOther]), null, 'free to move after the void');
    assert.equal(await attempt('DELETE FROM dashboard_data WHERE id = $1', [matched]), null, 'free to delete after the void');
    await client.query('DELETE FROM dashboard_data WHERE id = $1', [matched]);
    assert.equal(await one('SELECT count(*)::int AS n FROM carrier_statement_groups WHERE statement_id = $1', [published.statementId]).then((r) => r.n), 2, 'the voided statement keeps all its evidence');
    assert.equal(await one("SELECT count(*)::int AS n FROM carrier_statement_events WHERE event = 'voided'").then((r) => r.n), 1);
    const again = await publishStatement(nestedPool(client), await statementWorkbook(statementSheets({ idA: '90000701', idB: '90000702' })), { user: { id: 1 }, sourceLabel: 'guard again.xlsx' });
    assert.equal(again.status, 'published', 'the same statement can be published again once the journey is fixed');
    assert.equal(other > 0, true);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
