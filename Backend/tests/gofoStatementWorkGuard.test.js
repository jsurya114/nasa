import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publishStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { StatementWorkChanged, holdMatchedWork, rematchOpenGroups, voidStatement } from '../services/finance/gofoStatement/statementStore.js';
import AdminJourneyQuery from '../services/admin/AjourneyQuery.js';
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
    // The journey screen's own update path: changing the sequence numbers changes whether the work counts as weekly, which would take its revenue out of the city's reports.
    const viaScreen = async (id, start_seq, end_seq, route_id = routeA, driver_id = driverA) => {
      await client.query('SAVEPOINT screen');
      try { await AdminJourneyQuery.updateJourneyById(id, { start_seq, end_seq, route_id, driver_id }, client); return null; } catch (error) { return error; } finally { await client.query('ROLLBACK TO SAVEPOINT screen'); }
    };
    assert.equal(isStatementWorkConflict(await viaScreen(matched, 1, 10)), true, 'giving a weekly journey sequence numbers is refused while a statement bills it');
    assert.equal(isStatementWorkConflict(await viaScreen(matched, 0, 5)), true, 'and so is a half-set range, which a weekly city no longer counts');
    assert.equal(await viaScreen(matched, 0, 0), null, 'saving the same classification is not affected');
    assert.equal(await viaScreen(unbilled, 1, 10), null, 'a journey the statement does not carry can still change');
    const stillCounted = (await one("SELECT counts_for_city FROM reporting.delivery_facts WHERE fact_id = (SELECT id FROM payment_dashboard WHERE dashboard_data_id = $1)", [matched])).counts_for_city;
    assert.equal(stillCounted, true, 'the matched journey still counts for its city');
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
    assert.equal(await viaScreen(matched, 1, 10), null, 'free to give it sequence numbers after the void');
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

test('every re-match, not only the manual one, undoes itself when a journey changed under it', async () => {
  // A fake connection: the match update attaches one group of statement 5; the hold-and-recheck then finds a pay row that no longer matches.
  const fake = (held) => ({ query: async (sql) => (/WITH open_groups/.test(sql) ? { rows: [{ statement_id: '5' }] } : { rows: [{ expected: 1, held }] }) });
  assert.equal(await rematchOpenGroups(fake(1), { cityId: 1 }), 1, 'nothing changed: the match stands');
  await assert.rejects(rematchOpenGroups(fake(0), { cityId: 1 }), StatementWorkChanged, 'a changed journey rolls the match back through the caller');
});
