import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publishStatement, previewStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { listStatements, rematchOpenGroups, voidStatement } from '../services/finance/gofoStatement/statementStore.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// Needs a PostgreSQL copy that has the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the usual DB_* variables. Everything happens inside
// one transaction that is always rolled back, so nothing is left behind. All values are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-08-issue-252-carrier-statements.sql', import.meta.url));
const ID_A = '90000101';
const ID_B = '90000102';

// Lets the service open and finish "its own" transaction inside the test's single rolled-back one.
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

const sheets = () => statementSheets({ idA: ID_A, idB: ID_B });
// A corrected statement: one fee goes from 0.50 to 0.60, and every control the carrier writes is corrected with it.
const corrected = () => {
  const s = sheets();
  s['Details of Delivery Fees'][4][15] = 0.6;
  s['DSP Summary'][2][6] = 2.31; s['DSP Summary'][2][9] = 2.31; s['DSP Summary'][2][13] = 5.01;
  s['Driver Summary'][3][2] = 2.4; s['Driver Summary'][3][6] = 2.4;
  s['Driver Daily Summary'][3][3] = 2.4; s['Driver Daily Summary'][3][7] = 2.4;
  return s;
};

test('a carrier statement is previewed, published once, corrected, matched later and voided without losing history', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(MIGRATION, 'utf8'));
    await client.query(readFileSync(MIGRATION, 'utf8')); // safe to run twice

    const city = (await client.query("INSERT INTO city (job, city_code, city_type) VALUES ('Test Statement GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).rows[0].id;
    const route = async (code) => (await client.query(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 1, 1, 1, 1, $3) RETURNING id',
      [`Test ${code}`, 'Test Statement GOFO', code])).rows[0].id;
    const routeA = await route('TS01-001');
    const routeB = await route('TS01-002');
    const driver = async (name, code) => (await client.query(
      "INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, city])).rows[0].id;
    const driverA = await driver('Statement Test One', Number(ID_A));
    const driverB = await driver('Statement Test Two', Number(ID_B));
    const work = async (driverId, routeId, day, pay) => {
      const dd = (await client.query(
        "INSERT INTO dashboard_data (driver_id, journey_date, route_id, packages, first_stop, ds, delivered, closed, paid) VALUES ($1, $2, $3, 2, 2, 0, 2, true, false) RETURNING id", [driverId, day, routeId])).rows[0].id;
      return (await client.query('UPDATE payment_dashboard SET driver_payment = $2, closed = true WHERE dashboard_data_id = $1 RETURNING id', [dd, pay])).rows[0].id;
    };
    const rowA = await work(driverA, routeA, '2026-10-19', '3.00'); // only driver one has work recorded so far
    const db = nestedPool(client);
    const file = await statementWorkbook(sheets());
    const one = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);
    const stored = (table) => one(`SELECT count(*) AS n FROM ${table}`);

    await t.test('the preview checks everything and stores nothing', async () => {
      const preview = await previewStatement(client, file);
      assert.equal(preview.status, 'ready');
      assert.deepEqual(preview.outcome, { kind: 'new' });
      assert.deepEqual([preview.period.start, preview.period.end, preview.city.name], ['2026-10-19', '2026-10-25', 'Test Statement GOFO']);
      assert.deepEqual([preview.matching.matchedRevenue, preview.matching.unallocatedRevenue], ['2.61', '2.30']);
      assert.equal(preview.matching.states.no_pay_group.groups, 1);
      assert.equal(await stored('carrier_statements'), 0);
    });

    let first;
    await t.test('publishing stores the statement, its lines and the matching; publishing it again changes nothing', async () => {
      first = await publishStatement(db, file, { user: { id: 7 }, sourceLabel: 'week 43.xlsx' });
      assert.equal(first.status, 'published');
      assert.equal(first.version, 1);
      assert.deepEqual([await stored('carrier_statement_lines'), await stored('carrier_statement_groups'), await stored('carrier_statement_events')], [5, 2, 1]);
      assert.equal(await one("SELECT count(*) AS n FROM carrier_statement_items WHERE kind = 'claim'"), 1);
      const [listed] = await listStatements(client);
      assert.deepEqual([listed.deliveryRevenue, listed.claims, listed.adjustments, listed.settlementPayable, listed.matchedRevenue, listed.unallocatedRevenue], ['4.91', '-0.70', '-2.00', '2.21', '2.61', '2.30']);
      const again = await publishStatement(db, file, { user: { id: 7 }, sourceLabel: 'renamed copy.xlsx' });
      assert.equal(again.status, 'already_published');
      assert.deepEqual([await stored('carrier_statements'), await stored('carrier_statement_lines')], [1, 5]);
    });

    await t.test('payroll is never touched', async () => {
      const { rows } = await client.query('SELECT driver_payment FROM payment_dashboard WHERE id = $1', [rowA]);
      assert.equal(rows[0].driver_payment, '3.00');
    });

    await t.test('work that reaches NASA later is matched; matching only ever moves from unmatched to matched', async () => {
      assert.equal(await rematchOpenGroups(client, { cityId: city }), 0, 'nothing new to match yet');
      const rowB = await work(driverB, routeB, '2026-10-20', '1.50');
      assert.equal(await rematchOpenGroups(client, { cityId: city }), 1);
      assert.equal(await rematchOpenGroups(client, { cityId: city }), 0, 'running it again changes nothing');
      const [listed] = await listStatements(client);
      assert.deepEqual([listed.matchedRevenue, listed.unallocatedRevenue, listed.unallocatedGroups], ['4.91', '0.00', 0]);
      const group = (await client.query("SELECT payment_dashboard_id, nasa_driver_cents FROM carrier_statement_groups WHERE delivery_id = $1", [ID_B])).rows[0];
      assert.deepEqual([group.payment_dashboard_id, Number(group.nasa_driver_cents)], [rowB, 150]);
    });

    await t.test('a corrected statement for the same week becomes version 2; the old one stays as history', async () => {
      const fixed = await statementWorkbook(corrected());
      const preview = await previewStatement(client, fixed);
      assert.deepEqual(preview.outcome, { kind: 'correction', replaces: first.statementId, replacesVersion: 1 });
      const result = await publishStatement(db, fixed, { user: { id: 7 }, sourceLabel: 'week 43 corrected.xlsx' });
      assert.deepEqual([result.status, result.version], ['published', 2]);
      const rows = (await client.query('SELECT version, status, supersedes_id FROM carrier_statements ORDER BY version')).rows;
      assert.deepEqual(rows.map((r) => [r.version, r.status]), [[1, 'superseded'], [2, 'published']]);
      assert.equal(String(rows[1].supersedes_id), String(first.statementId));
      assert.equal(await one("SELECT count(*) AS n FROM carrier_statement_events WHERE event = 'superseded'"), 1);
      const old = await publishStatement(db, file, { user: { id: 7 }, sourceLabel: 'old copy.xlsx' });
      assert.equal(old.status, 'older_version', 'an earlier version is never published again by accident');
    });

    await t.test('a statement that does not reconcile, or belongs to another city, is refused and nothing is stored', async () => {
      const before = await stored('carrier_statements');
      const broken = sheets();
      broken['DSP Summary'][2][9] = 9.99;
      const bad = await publishStatement(db, await statementWorkbook(broken), { user: { id: 7 }, sourceLabel: 'broken.xlsx' });
      assert.equal(bad.status, 'rejected');
      assert.match(bad.reasons.join(' '), /total billing/i);
      const wrong = await publishStatement(db, await statementWorkbook(statementSheets({ idA: ID_A, idB: ID_B, fleet: 'XYZ-NLC' })), { user: { id: 7 }, sourceLabel: 'wrong.xlsx' });
      assert.equal(wrong.status, 'rejected');
      assert.match(wrong.reasons.join(' '), /XYZ-NLC/);
      const unknown = await publishStatement(db, await statementWorkbook(statementSheets({ idA: ID_A, idB: ID_B, routeA: 'NOPE-1', routeB: 'NOPE-2' })), { user: { id: 7 }, sourceLabel: 'unknown.xlsx' });
      assert.equal(unknown.status, 'rejected');
      assert.equal(await stored('carrier_statements'), before);
    });

    await t.test('the evidence cannot be edited or deleted; only a void with a reason retires a statement', async () => {
      const attempt = async (sql) => {
        await client.query('SAVEPOINT attempt');
        try { await client.query(sql); return 'allowed'; } catch (error) { return error.message; } finally { await client.query('ROLLBACK TO SAVEPOINT attempt'); }
      };
      assert.match(await attempt('UPDATE carrier_statement_lines SET fee_cents = 1'), /cannot be changed or deleted/);
      assert.match(await attempt('DELETE FROM carrier_statement_groups'), /cannot be deleted/);
      assert.match(await attempt('DELETE FROM carrier_statements'), /cannot be deleted/);
      assert.match(await attempt('UPDATE carrier_statements SET settlement_payable_cents = 1'), /figures cannot be changed/);
      assert.match(await attempt("UPDATE carrier_statements SET status = 'published' WHERE status = 'superseded'"), /cannot be brought back/);
      assert.match(await attempt("UPDATE carrier_statement_groups SET match_state = 'no_route' WHERE match_state = 'matched'"), /matched carrier statement group cannot be changed/);
      const current = (await client.query("SELECT id FROM carrier_statements WHERE status = 'published'")).rows[0].id;
      assert.equal(await voidStatement(client, current, { actorId: 7, reason: 'uploaded for the wrong week' }), true);
      assert.equal(await voidStatement(client, current, { actorId: 7, reason: 'again' }), false, 'a void happens once');
      const fixed = await publishStatement(db, await statementWorkbook(corrected()), { user: { id: 7 }, sourceLabel: 'again.xlsx' });
      assert.deepEqual([fixed.status, fixed.version], ['published', 3], 'a voided statement may be uploaded again, as a new version');
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
