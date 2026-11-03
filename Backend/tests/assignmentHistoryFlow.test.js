import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runs the real weekly upload, history-only import, conflicts and void handlers against a PostgreSQL copy that has
// the app's tables (never production). Run with ASSIGNMENT_TEST_DB=1 and the usual DB_* variables. Everything
// happens inside one outer transaction that is always rolled back (the handlers' own BEGIN, COMMIT and ROLLBACK
// become savepoints), so nothing is left behind. All values are made up.
const hasDb = process.env.ASSIGNMENT_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

const HEADER = ['Waybill No', 'Courier', 'Region/route', 'Delivery ID', 'Signing time', 'The total expenses-exclusive of taxes', 'STOP Point Details'];

const fileOf = async (fee, offset = [], { header = HEADER, sheets = ['Details of Delivery Fees', 'Offset Details'] } = {}) => {
  const workbook = new ExcelJS.Workbook();
  [[sheets[0], fee], [sheets[1], offset]].forEach(([name, rows]) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(header);
    rows.forEach((r) => sheet.addRow(r));
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const callHandler = async (handler, req) => {
  let out;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(body) { out = { status: this.statusCode, body }; return this; } };
  await handler({ query: {}, params: {}, body: {}, ...req }, res);
  return out;
};

test('the weekly upload keeps assignment history without changing what it stages, and the history-only import never touches staging', { skip: !hasDb && 'set ASSIGNMENT_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const { weeklyExcelUpload } = await import('../controllers/admin/weeklyUploadsController.js');
  const { importAssignmentHistory, getAssignmentConflicts, voidAssignmentImport } = await import('../controllers/admin/assignmentHistoryController.js');

  const client = await pool.connect();
  const realConnect = pool.connect.bind(pool);
  // Every handler gets this one client; its transaction control becomes a savepoint inside the outer transaction.
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
  pool.connect = async () => shared;
  pool.query = (sql, params) => client.query(sql, params);

  try {
    await client.query('BEGIN');
    await client.query(migration('2026-11-03-issue-140-carrier-assignment-history.sql'));
    await client.query(migration('2026-11-03-issue-141-courier-claims.sql'));

    const city = async (job, code) => (await client.query("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [job, code])).rows[0].id;
    const route = (job, code) => client.query(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 1, 1, 1, 1, $3)',
      [`Test ${code}`, job, code]
    );
    const cityA = await city('Flow Alpha GOFO', 'FLOW ALPHA');
    const cityB = await city('Flow Beta GOFO', 'FLOW BETA');
    await route('Flow Alpha GOFO', 'FLWA 01-1');
    await route('Flow Beta GOFO', 'FLWB 01-1');
    const driverA = (await client.query("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', 'Flow Driver A', 'flow.a@example.test', 90000011, $1) RETURNING id", [cityA])).rows[0].id;
    const cityAdmin = (await client.query("INSERT INTO admin (password, name, email, role) VALUES ('x', 'Flow Admin', 'flow.admin@example.test', 'admin') RETURNING id")).rows[0].id;
    await client.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin, cityA]);

    const SUPER = { id: 1, role: 'superadmin' };
    const staged = async () => (await client.query('SELECT driver_id, del_route, del_date::text AS d, total_deliveries, fs, ds FROM weeklycount ORDER BY driver_id, del_date, del_route')).rows;
    const facts = async () => Number((await client.query('SELECT count(*) n FROM carrier_package_assignments')).rows[0].n);
    const upload = (buffer, user = SUPER, originalname = 'weekly.xlsx') => callHandler(weeklyExcelUpload, { file: { buffer, originalname }, user });

    const weekly = await fileOf(
      [
        ['FW0001', 'Sam', 'FLWA 01-1', 90000011, '10/01/2026 10:00:00', 4.5, '1'],
        ['FW0002', 'Sam', 'FLWA 01-1', 90000011, '10/01/2026 11:00:00', 4.5, '1'], // same stop: a double stop
        ['FW0003', 'Sam', 'FLWA 01-1', 90000011, '10/01/2026 12:00:00', 4.5, '2'],
        ['FW0004', 'Pat', 'FLWB 01-1', 90000012, '10/02/2026 10:00:00', 4.5, null], // no stop details: no pay row, identity kept
      ],
      [['FW0005', 'Sam', 'FLWA 01-1', 90000011, '09/20/2026 10:00:00', -2, '1']]
    );

    await t.test('a weekly upload stages exactly what it always did, and reports the history it kept', async () => {
      const result = await upload(weekly);
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.recordsProcessed, result.body.data.recordsSkipped, result.body.data.recordsInserted], [3, 1, 1]);
      assert.deepEqual(await staged(), [{ driver_id: 90000011, del_route: 'FLWA 01-1', d: '2026-10-01', total_deliveries: 3, fs: 2, ds: 1 }]);
      const history = result.body.data.assignmentHistory;
      assert.deepEqual([history.saved, history.recorded, history.alreadyKnown, history.problems], [true, 5, 0, 0]);
      assert.deepEqual([history.sheets.fee_details.rows, history.sheets.offset_details.rows], [4, 1]);
      assert.equal(await facts(), 5, 'the row with no stop details and the offset row keep their identity');
    });

    await t.test('the same file again under another name stages the same and records nothing new', async () => {
      const before = await staged();
      const result = await upload(weekly, SUPER, 'renamed copy (1).xlsx');
      assert.equal(result.status, 200);
      assert.deepEqual(await staged(), before);
      assert.deepEqual([result.body.data.assignmentHistory.alreadyRecorded, result.body.data.assignmentHistory.recorded], [true, 0]);
      assert.equal(await facts(), 5);
    });

    await t.test('a different file with the same facts adds no facts', async () => {
      const resaved = await fileOf(
        [['fw0001', 'Sam', 'FLWA 01-1', 90000011, '10/01/2026 10:00:00', 4.5, '1'], ['FW0003', 'Sam', 'FLWA 01-1', 90000011, '10/01/2026 12:00:00', 4.5, '2']],
        []
      );
      const result = await upload(resaved);
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.assignmentHistory.recorded, result.body.data.assignmentHistory.alreadyKnown], [0, 2]);
      assert.equal(await facts(), 5);
    });

    await t.test('an older report goes in through the history-only import and never touches the weekly staging data', async () => {
      const before = await staged();
      const pay = async () => (await client.query("SELECT (SELECT count(*) FROM dashboard_data) AS dashboard, (SELECT count(*) FROM payment_dashboard) AS payments, (SELECT coalesce(sum(driver_payment), 0) FROM payment_dashboard) AS driver_pay")).rows[0];
      const payBefore = await pay();
      const older = await fileOf([['FW0100', 'Sam', 'FLWA 01-1', 90000011, '08/03/2026 09:00:00', 4.5, '1']], [['FW0101', 'Sam', 'FLWB 01-1', 90000012, '08/04/2026 09:00:00', -1, null]]);
      const result = await callHandler(importAssignmentHistory, { file: { buffer: older, originalname: 'august.xlsx' }, user: SUPER });
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.saved, result.body.data.recorded], [true, 2]);
      assert.deepEqual(await staged(), before, 'weekly staging is untouched');
      assert.deepEqual(await pay(), payBefore, 'no dashboard or payment row changes');
    });

    await t.test('a city admin keeps only the routes of their own cities, in both entry points, and is not refused', async () => {
      const mixed = await fileOf(
        [['FW0200', 'Sam', 'FLWA 01-1', 90000011, '10/05/2026 10:00:00', 4.5, '1']],
        [['FW0201', 'Sam', 'FLWB 01-1', 90000012, '10/05/2026 10:00:00', -1, null]]
      );
      const imported = await callHandler(importAssignmentHistory, { file: { buffer: mixed, originalname: 'mixed.xlsx' }, user: { id: cityAdmin, role: 'admin' } });
      assert.equal(imported.status, 200);
      assert.deepEqual([imported.body.data.recorded, imported.body.data.leftOut], [1, 1]);
      const own = (await client.query("SELECT count(*) n FROM carrier_package_assignments WHERE waybill_key IN ('FW0200','FW0201')")).rows[0].n;
      assert.equal(Number(own), 1);
    });

    await t.test('a file that cannot be read, or has neither sheet, is refused and nothing is saved', async () => {
      const before = await facts();
      const notExcel = await callHandler(importAssignmentHistory, { file: { buffer: Buffer.from('not a spreadsheet'), originalname: 'x.xlsx' }, user: SUPER });
      assert.equal(notExcel.status, 400);
      const noSheet = await callHandler(importAssignmentHistory, { file: { buffer: await fileOf([], [], { sheets: ['Other', 'Another'] }), originalname: 'x.xlsx' }, user: SUPER });
      assert.equal(noSheet.status, 400);
      assert.match(noSheet.body.message, /Details of Delivery Fees/);
      const noFile = await callHandler(importAssignmentHistory, { user: SUPER });
      assert.equal(noFile.status, 400);
      assert.equal(await facts(), before);
    });

    await t.test('conflicts can be listed, and a wrong import can be voided once, with a reason', async () => {
      await callHandler(importAssignmentHistory, {
        file: { buffer: await fileOf([['FW0300', 'Sam', 'FLWA 01-1', 90000011, '10/06/2026 10:00:00', 4.5, '1'], ['FW0300', 'Pat', 'FLWB 01-1', 90000012, '10/06/2026 10:00:00', 4.5, '1']]), originalname: 'conflict.xlsx' },
        user: SUPER,
      });
      const listed = await callHandler(getAssignmentConflicts, { query: { limit: '500' } });
      assert.equal(listed.status, 200);
      assert.ok(listed.body.data.some((c) => c.waybillKey === 'FW0300' && c.deliveryIds === 2));

      const importId = (await client.query("SELECT id FROM carrier_assignment_imports WHERE source_label = 'conflict.xlsx'")).rows[0].id;
      assert.equal((await callHandler(voidAssignmentImport, { params: { importId: 'abc' }, body: { reason: 'x' }, user: SUPER })).status, 400);
      assert.equal((await callHandler(voidAssignmentImport, { params: { importId: String(importId) }, body: { reason: '  ' }, user: SUPER })).status, 400);
      assert.equal((await callHandler(voidAssignmentImport, { params: { importId: String(importId) }, body: { reason: 'wrong region' }, user: SUPER })).status, 200);
      assert.equal((await callHandler(voidAssignmentImport, { params: { importId: String(importId) }, body: { reason: 'wrong region' }, user: SUPER })).status, 404);
      const after = await callHandler(getAssignmentConflicts, { query: { limit: '500' } });
      assert.equal(after.body.data.some((c) => c.waybillKey === 'FW0300'), false);
    });

    await t.test('new history settles claims that were waiting for it, and leaves the unproven and the conflicting open', async () => {
      const { importClaims } = await import('../services/payroll/claims/claimsStore.js');
      const { parseClaimsRows } = await import('../services/payroll/claims/claimsParser.js');
      const claimsHeader = ['date', 'Waybill No.', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes'];
      const { claims } = parseClaimsRows([claimsHeader,
        ['10/07/2026 10:00:00', 'FWC001', 'Damaged Item', 500, null, -12.5],
        ['10/07/2026 10:00:00', 'FWC002', 'Damaged Item', 500, null, -8],
        ['10/07/2026 10:00:00', 'FWC003', 'Damaged Item', 500, null, -3],
      ], { courier: 'gofo' });
      await importClaims(client, claims, { importCityId: cityA, sourceFile: 'synthetic-claims.xlsx', sourceSheet: 'Claims Detail', importedBy: null });
      const state = async () => Object.fromEntries((await client.query(
        "SELECT c.waybill, m.status, m.eligible_deduction, m.driver_id FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id WHERE c.waybill LIKE 'FWC%' AND c.superseded_at IS NULL ORDER BY c.waybill"
      )).rows.map((r) => [r.waybill, [r.status, r.eligible_deduction, r.driver_id]]));
      assert.deepEqual(Object.values(await state()).map((v) => v[0]), ['unresolved', 'unresolved', 'unresolved']);

      const result = await callHandler(importAssignmentHistory, {
        file: { buffer: await fileOf([
          ['FWC001', 'Sam', 'FLWA 01-1', 90000011, '10/07/2026 09:00:00', 4.5, '1'],
          ['FWC002', 'Sam', 'FLWA 01-1', 90000011, '10/07/2026 09:00:00', 4.5, '1'],
          ['FWC002', 'Pat', 'FLWB 01-1', 90000012, '10/07/2026 09:00:00', 4.5, '1'], // a conflict
        ]), originalname: 'claims-history.xlsx' },
        user: SUPER,
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data.claimsRematched, { chargeable: 1, exempt: 0, unresolved: 1, ambiguous: 1 });
      assert.deepEqual(await state(), {
        FWC001: ['chargeable', '12.50', driverA],
        FWC002: ['ambiguous', null, null],
        FWC003: ['unresolved', null, null],
      });

      const again = await callHandler(importAssignmentHistory, { file: { buffer: await fileOf([['FWC001', 'Sam', 'FLWA 01-1', 90000011, '10/07/2026 09:00:00', 4.5, '1']]), originalname: 'claims-history-2.xlsx' }, user: SUPER });
      assert.equal(again.body.data.claimsRematched, null, 'nothing new, so no claim is looked at');
    });

    await t.test('if the claims tables are missing, the history is still kept and the answer says the claims were not rematched', async () => {
      await client.query(migration('2026-11-03-issue-141-courier-claims.rollback.sql'));
      const before = await facts();
      const result = await callHandler(importAssignmentHistory, { file: { buffer: await fileOf([['FWD001', 'Sam', 'FLWA 01-1', 90000011, '10/08/2026 09:00:00', 4.5, '1']]), originalname: 'no-claims.xlsx' }, user: SUPER });
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.saved, result.body.data.recorded, result.body.data.claimsRematched], [true, 1, { failed: true }]);
      assert.equal(await facts(), before + 1);
    });

    await t.test('if the history tables are missing, the weekly upload still stages exactly the same and says so', async () => {
      await client.query(migration('2026-11-03-issue-140-carrier-assignment-history.rollback.sql'));
      const result = await upload(weekly, SUPER, 'weekly again.xlsx');
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.recordsProcessed, result.body.data.recordsInserted], [3, 1]);
      assert.deepEqual(await staged(), [{ driver_id: 90000011, del_route: 'FLWA 01-1', d: '2026-10-01', total_deliveries: 3, fs: 2, ds: 1 }]);
      assert.equal(result.body.data.assignmentHistory.saved, false);
      assert.match(result.body.data.assignmentHistory.reason, /not set up/);

      const history = await callHandler(importAssignmentHistory, { file: { buffer: weekly, originalname: 'x.xlsx' }, user: SUPER });
      assert.equal(history.status, 503, 'the history-only import has nothing else to do, so it says it cannot');
    });

    assert.ok(driverA);
  } finally {
    pool.connect = realConnect;
    delete pool.query; // back to the prototype method
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
