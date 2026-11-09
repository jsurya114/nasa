import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRange } from '../services/reporting/inputs.js';
import { businessSummary } from '../services/reporting/deliveryReports.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// One GOFO upload (issue #252): the weekly workbook is the only file the admin chooses. It stages the weekly pay data as before, and the same file's statement
// is checked at upload and published when the weekly add succeeds. Runs the real controllers against a PostgreSQL copy that has the app's tables (never production):
// PAYROLL_TEST_DB=1 and the DB_* variables. One outer transaction, always rolled back (the handlers' own BEGIN/COMMIT/ROLLBACK become savepoints). All values are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const dir = (name) => fileURLToPath(new URL(`../migrations/${name}`, import.meta.url));
const ID_A = '90000601';
const ID_B = '90000602';

// The fixture statement, with the Stop Point Details column the weekly upload needs (every line a first stop).
const weeklyFile = (sheets) => {
  const copy = structuredClone(sheets);
  const rows = copy['Details of Delivery Fees'];
  rows[0].push('STOP Point Details');
  for (let i = 1; i < rows.length; i += 1) rows[i].push('1');
  return statementWorkbook(copy);
};
const callHandler = async (handler, req) => {
  let out;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(body) { out = { status: this.statusCode, body }; return this; } };
  await handler({ query: {}, params: {}, body: {}, ...req }, res);
  return out;
};

test('one upload: the weekly file stages pay data, and its statement reaches Insights when the weekly add succeeds', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const { weeklyExcelUpload } = await import('../controllers/admin/weeklyUploadsController.js');
  const { updateWeeklyTempDataToDashboard } = await import('../controllers/admin/dashboardController.js');
  const { createStatementService } = await import('../services/finance/gofoStatement/statementService.js');
  const client = await pool.connect();
  let depth = 0;
  const shared = {
    query: (sql, params) => {
      if (sql === 'BEGIN') return client.query(`SAVEPOINT handler_${++depth}`);
      if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT handler_${depth--}`);
      if (sql === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT handler_${depth}`).then(() => client.query(`RELEASE SAVEPOINT handler_${depth--}`));
      return client.query(sql, params);
    },
    release: () => {},
  };
  const realConnect = pool.connect.bind(pool);
  pool.connect = async () => shared;
  pool.query = (sql, params) => client.query(sql, params);
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  const db = { query: (sql, params) => client.query(sql, params), connect: async () => shared }; // a pool that reuses the test's transaction
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(dir('2026-11-08-issue-252-carrier-statements.sql'), 'utf8'));
    await client.query(readFileSync(dir('2026-11-08-issue-252-reporting-statement-revenue.sql'), 'utf8'));
    await client.query(readFileSync(dir('2026-11-09-issue-252-weekly-upload-revenue.sql'), 'utf8'));
    await client.query(readFileSync(dir('2026-11-09-issue-252-weekly-upload-revenue.sql'), 'utf8')); // safe to run twice

    const weeklyCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test One Upload GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test One Upload Other', 'OTH GOFO', 'WEEKLY') RETURNING id")).id;
    const dailyCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test One Upload SpeedX', 'TSD SPX', 'DAILY') RETURNING id")).id;
    const route = async (job, code) => (await one(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 0, 3, 0, 1.5, $3) RETURNING id',
      [`Test ${code}`, job, code])).id;
    await route('Test One Upload GOFO', 'TS01-001');
    await route('Test One Upload GOFO', 'TS01-002');
    const routeD = await route('Test One Upload SpeedX', 'TSD-001');
    const driver = async (name, code, cityId) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, cityId])).id;
    const driverA = await driver('Upload Test One', Number(ID_A), weeklyCity);
    const driverB = await driver('Upload Test Two', Number(ID_B), weeklyCity);
    const driverD = await driver('Upload Test Three', 90000603, dailyCity);
    const admin = async (name, role, cityId) => {
      const row = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, role]);
      if (cityId) await client.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [row.id, cityId]);
      return { id: row.id, role };
    };
    const OWNER = await admin('Upload Owner', 'superadmin');
    const CITY_ADMIN = await admin('Upload City Admin', 'admin', weeklyCity);
    const OTHER_ADMIN = await admin('Upload Other Admin', 'admin', otherCity);
    // A daily SpeedX record: it must come through every step below unchanged.
    const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages, delivered, closed, paid) VALUES ($1,$2,$3,100,109,10,10,true,false) RETURNING id', [driverD, routeD, '2026-10-21'])).id;
    await client.query('UPDATE payment_dashboard SET delivered = 10, driver_payment = 16, company_earnings = 4 WHERE dashboard_data_id = $1', [dd]);

    const period = parseRange({ start_date: '2026-10-19', end_date: '2026-10-25' });
    const summary = async (cityIds = [weeklyCity]) => (await businessSummary(client, { period, cityIds })).data;
    const upload = (buffer, user = OWNER, originalname = 'weekly.xlsx') => callHandler(weeklyExcelUpload, { file: { buffer, originalname }, user });
    const apply = (user = OWNER) => callHandler(updateWeeklyTempDataToDashboard, { user });
    const statements = async () => (await client.query("SELECT id, version, status, source_import_id, detail_fee_cents FROM carrier_statements ORDER BY id")).rows;
    const imports = async () => (await client.query('SELECT id, status, reason_kind, (file IS NOT NULL) AS has_file, is_current, applied_at FROM carrier_statement_imports ORDER BY id')).rows;
    const pay = async () => (await client.query("SELECT d.driver_code, sum(pd.driver_payment)::text AS pay, count(*)::int AS n FROM payment_dashboard pd JOIN drivers d ON d.id = pd.driver_id WHERE d.id = ANY($1) GROUP BY 1 ORDER BY 1", [[driverA, driverB]])).rows;
    const speedx = async () => JSON.stringify((await summary([dailyCity])).deliveryRevenue) + JSON.stringify((await one('SELECT driver_payment::text, company_earnings::text FROM payment_dashboard WHERE dashboard_data_id = $1', [dd])));
    const speedxBefore = await speedx();
    const sheets = () => statementSheets({ idA: ID_A, idB: ID_B });
    const file1 = await weeklyFile(sheets());
    const corrected = sheets();
    corrected['Details of Delivery Fees'][4][15] = 0.6;
    corrected['DSP Summary'][2][6] = 2.31; corrected['DSP Summary'][2][9] = 2.31; corrected['DSP Summary'][2][13] = 5.01;
    corrected['Driver Summary'][3][2] = 2.4; corrected['Driver Summary'][3][6] = 2.4;
    corrected['Driver Daily Summary'][3][3] = 2.4; corrected['Driver Daily Summary'][3][7] = 2.4;
    const file2 = await weeklyFile(corrected);
    const broken = sheets();
    broken['DSP Summary'][2][6] = 99; // the settlement no longer follows from the figures
    const fileBroken = await weeklyFile(broken);

    await t.test('a city admin of another city is refused before anything is saved', async () => {
      const refused = await upload(file1, OTHER_ADMIN);
      assert.equal(refused.status, 403);
      assert.deepEqual(await imports(), [], 'no import was saved for a refused file');
    });

    await t.test('a failed revenue stage cannot attach the preceding workbook to the newly staged pay data', async () => {
      await client.query('SAVEPOINT failed_revenue_stage');
      try {
        const earlier = await upload(file1);
        await client.query(`
          CREATE FUNCTION test_revenue_stage_failure() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic import insert failure'; END $$;
          CREATE TRIGGER test_revenue_stage_failure BEFORE INSERT ON carrier_statement_imports
          FOR EACH ROW EXECUTE FUNCTION test_revenue_stage_failure();
        `);
        const newer = await upload(file2);
        assert.equal(newer.body.data.revenue.state, 'unavailable');
        assert.match(newer.body.data.revenue.reasons.join(' '), /could not be saved/);
        const added = await apply();
        assert.equal(added.body.rowsInserted.inserted, 2);
        assert.equal(added.body.revenue, null);
        assert.deepEqual(await statements(), [], 'the preceding workbook was never published');
        assert.equal((await imports()).find((i) => i.id === earlier.body.data.revenue.importId).applied_at, null);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT failed_revenue_stage');
      }
    });

    await t.test('a failed settlement rolls back publication, and the applied import can be recovered without uploading again', async () => {
      await client.query('SAVEPOINT failed_revenue_settlement');
      try {
        await upload(file1);
        await client.query(`
          CREATE FUNCTION test_revenue_settlement_failure() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic import settlement failure'; END $$;
          CREATE TRIGGER test_revenue_settlement_failure BEFORE UPDATE ON carrier_statement_imports
          FOR EACH ROW WHEN (NEW.status = 'published') EXECUTE FUNCTION test_revenue_settlement_failure();
        `);
        const added = await apply();
        assert.equal(added.body.rowsInserted.inserted, 2);
        assert.equal(added.body.revenue.state, 'unavailable');
        assert.deepEqual(await statements(), [], 'the statement and the import roll back together');
        const service = createStatementService(db);
        const [waiting] = await service.listImports();
        assert.equal(waiting.canPublish, true);
        await client.query('DROP TRIGGER test_revenue_settlement_failure ON carrier_statement_imports');
        assert.equal((await service.publishImport(waiting.id, { user: OWNER })).status, 'published');
        assert.equal((await summary()).deliveryRevenue, '4.91');
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT failed_revenue_settlement');
      }
    });

    await t.test('a city admin uploads and adds the weekly data: pay works, the revenue waits for the owner, and no company figure is shown to them', async () => {
      const out = await upload(file1, CITY_ADMIN);
      assert.equal(out.status, 200);
      assert.equal(out.body.data.recordsInserted, 2, 'the weekly pay data is staged exactly as before');
      const revenue = out.body.data.revenue;
      assert.equal(revenue.state, 'ready');
      assert.match(revenue.message, /owner publishes it/);
      assert.equal(revenue.importId, null);
      for (const key of Object.keys(revenue)) assert.equal(/deliveryRevenue|settlement|matched|unallocated|city|billNumber/.test(key), false, `a city admin does not get ${key}`);
      const added = await apply(CITY_ADMIN);
      assert.equal(added.status, 200);
      assert.equal(added.body.rowsInserted.inserted, 2);
      assert.equal(added.body.revenue.state, 'needs_review');
      assert.equal(added.body.revenue.message, 'Revenue needs review');
      assert.match(added.body.revenue.reasons.join(' '), /Only an owner publishes company revenue/);
      assert.deepEqual(await statements(), [], 'a city admin never publishes company revenue');
      assert.deepEqual(await pay(), [{ driver_code: 90000601, pay: '6.00', n: 1 }, { driver_code: 90000602, pay: '6.00', n: 1 }], 'driver pay comes from the driver route prices');
      const waiting = await createStatementService(db).listImports();
      assert.equal(waiting.length, 1);
      assert.deepEqual([waiting[0].reasonKind, waiting[0].canPublish, waiting[0].deliveryRevenue], ['owner_required', true, '4.91']);
    });

    await t.test('an owner adding a city admin\'s staged data does not publish the city admin\'s file', async () => {
      await upload(file1, CITY_ADMIN);
      const added = await apply(OWNER);
      assert.equal(added.body.revenue.state, 'needs_review');
      assert.equal(added.body.revenue.reasonKind, 'owner_required');
      assert.match(added.body.revenue.reasons.join(' '), /uploaded by a city admin/);
      assert.deepEqual(await statements(), [], 'nothing was published as a side effect of the owner\'s add');
      assert.equal((await createStatementService(db).listImports()).length, 2, 'both saved imports wait for the owner');
    });

    await t.test('the owner publishes the saved import without choosing the file again, and Insights shows the reconciled totals', async () => {
      const open = await createStatementService(db).listImports();
      const [saved, duplicate] = open; // the newest first; the older one is the same file from the earlier city admin upload
      const done = await createStatementService(db).publishImport(Number(saved.id), { user: OWNER });
      assert.equal(done.status, 'published');
      const [statement] = await statements();
      assert.deepEqual([statement.version, statement.status, String(statement.source_import_id), statement.detail_fee_cents], [1, 'published', saved.id, '671']);
      const data = await summary();
      assert.deepEqual([data.deliveryRevenue, data.driverEarnings, data.revenueBasis, data.revenueIsEstimated, data.unallocatedRevenue], ['4.91', '12.00', 'statement', false, null]);
      assert.equal((await imports()).find((i) => String(i.id) === saved.id).has_file, false, 'the saved file is dropped once it is published');
      assert.equal((await createStatementService(db).listImports()).length, 1, 'the earlier saved copy of the same file is still open');
      const same = await createStatementService(db).publishImport(Number(duplicate.id), { user: OWNER });
      assert.equal(same.status, 'already_imported', 'the same statement is never published twice');
      assert.equal((await createStatementService(db).listImports()).length, 0);
      const again = await createStatementService(db).publishImport(Number(saved.id), { user: OWNER });
      assert.equal(again.status, 'not_open', 'publishing twice is refused, not repeated');
    });

    await t.test('the owner uploads the same file again: it is already imported, nothing is duplicated, and pay is not counted twice', async () => {
      const out = await upload(file1);
      assert.equal(out.body.data.revenue.state, 'already_imported');
      assert.equal(out.body.data.revenue.message, 'Already imported');
      const added = await apply();
      assert.equal(added.body.rowsInserted.inserted, 0, 'the weekly rows are already on the dashboard');
      assert.equal(added.body.revenue.state, 'already_imported');
      assert.equal((await statements()).length, 1);
      assert.deepEqual((await pay()).map((r) => r.n), [1, 1]);
      assert.equal((await summary()).deliveryRevenue, '4.91');
    });

    await t.test('a corrected week is not swapped in silently: the owner reviews the saved import, confirms it, and the old version stays in the history', async () => {
      const out = await upload(file2);
      assert.equal(out.body.data.revenue.state, 'needs_review');
      assert.equal(out.body.data.revenue.reasonKind, 'correction');
      const service = createStatementService(db);
      assert.deepEqual(await service.listImports(), [], 'a correction cannot be published until the weekly work is applied');
      assert.equal((await service.publishImport(out.body.data.revenue.importId, { user: OWNER })).status, 'not_open');
      const added = await apply();
      assert.equal(added.body.revenue.state, 'needs_review');
      assert.equal((await summary()).deliveryRevenue, '4.91', 'the verified revenue stays until the owner confirms');
      const [waiting] = await service.listImports();
      assert.deepEqual([waiting.reasonKind, waiting.outcome.kind], ['correction', 'correction']);
      const first = await service.publishImport(Number(waiting.id), { user: OWNER });
      assert.equal(first.status, 'needs_confirmation');
      const stale = await service.publishImport(Number(waiting.id), { user: OWNER, replacesStatementId: '999999' });
      assert.equal(stale.status, 'needs_confirmation', 'approval for a different statement cannot replace the current one');
      assert.equal(stale.outcome.replaces, first.outcome.replaces);
      assert.equal((await statements()).length, 1, 'nothing changed without the confirmation');
      const confirmed = await service.publishImport(Number(waiting.id), { user: OWNER, replacesStatementId: first.outcome.replaces });
      assert.deepEqual([confirmed.status, confirmed.version], ['published', 2]);
      assert.deepEqual((await statements()).map((s) => [s.version, s.status]), [[1, 'superseded'], [2, 'published']]);
      assert.equal((await summary()).deliveryRevenue, '5.01');
      const events = (await client.query("SELECT event FROM carrier_statement_events ORDER BY id")).rows.map((r) => r.event);
      assert.deepEqual(events.filter((e) => e !== 'matched'), ['published', 'superseded', 'published'], 'the audit history keeps every step');
    });

    await t.test('a failed revenue check leaves the weekly workflow working and the verified revenue in place', async () => {
      const before = await statements();
      const out = await upload(fileBroken);
      assert.equal(out.status, 200, 'the weekly upload itself still succeeds');
      assert.equal(out.body.data.recordsInserted, 2);
      assert.equal(out.body.data.revenue.state, 'needs_review');
      assert.equal(out.body.data.revenue.reasonKind, 'check_failed');
      assert.ok(out.body.data.revenue.reasons.length > 0);
      const added = await apply();
      assert.equal(added.status, 200);
      assert.equal(added.body.revenue.state, 'needs_review');
      assert.deepEqual(await statements(), before, 'no statement was added or changed');
      assert.equal((await summary()).deliveryRevenue, '5.01', 'the prior verified revenue is still what Insights shows');
      const service = createStatementService(db);
      const [waiting] = await service.listImports();
      const retry = await service.publishImport(Number(waiting.id), { user: OWNER });
      assert.equal(retry.status, 'rejected', 'publishing re-checks the saved file and it still fails');
      assert.equal(await service.dismissImport(Number(waiting.id), { user: OWNER, reason: 'the carrier sent a wrong file' }), true);
      assert.equal((await service.listImports()).length, 0);
      assert.equal(await service.dismissImport(Number(waiting.id), { user: OWNER, reason: 'again' }), false, 'a dismissed import cannot be dismissed twice');
    });

    await t.test('carrier money that matches no NASA work stays visible in the city total', async () => {
      await client.query('UPDATE carrier_statements SET status = \'voided\', voided_at = now(), void_reason = \'test\' WHERE status = \'published\'');
      // The carrier's second courier is not a NASA driver, so the carrier's 2.30 for that courier matches no pay row.
      await upload(await weeklyFile(statementSheets({ idA: ID_A, idB: '90000699' })));
      const added = await apply();
      assert.equal(added.body.revenue.state, 'updated');
      const data = await summary();
      assert.deepEqual([data.deliveryRevenue, data.unallocatedRevenue], ['4.91', '2.30'], 'unallocated revenue is part of the city total and shown apart');
    });

    await t.test('the daily SpeedX figures and the daily upload code are untouched, and the weekly flow replaced no staged import it should not have', async () => {
      assert.equal(await speedx(), speedxBefore);
      const source = readFileSync(fileURLToPath(new URL('../controllers/admin/fileUploadsController.js', import.meta.url)), 'utf8');
      assert.equal(/weeklyImport|carrier_statement/.test(source), false, 'the daily upload does not know about carrier statements');
      assert.equal((await imports()).filter((i) => i.is_current).length <= 1, true, 'at most one import is tied to the staged data');
    });
  } finally {
    pool.connect = realConnect;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
