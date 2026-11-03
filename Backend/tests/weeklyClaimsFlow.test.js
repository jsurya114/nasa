import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Runs the real weekly upload with a Claims Detail sheet against a PostgreSQL copy that has the app's tables (never
// production). Run with ASSIGNMENT_TEST_DB=1 and the usual DB_* variables. One outer transaction, always rolled back
// (the handlers' own BEGIN, COMMIT and ROLLBACK become savepoints). All values are made up.
const hasDb = process.env.ASSIGNMENT_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

const FEE_HEADER = ['Waybill No', 'Courier', 'Region/route', 'Delivery ID', 'Signing time', 'The total expenses-exclusive of taxes', 'STOP Point Details'];
const CLAIM_HEADER = ['date', 'Waybill No.', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes'];

const fileOf = async ({ fee = [], claims = null }) => {
  const workbook = new ExcelJS.Workbook();
  const feeSheet = workbook.addWorksheet('Details of Delivery Fees');
  feeSheet.addRow(FEE_HEADER);
  fee.forEach((r) => feeSheet.addRow(r));
  workbook.addWorksheet('Offset Details').addRow(FEE_HEADER);
  if (claims) {
    const sheet = workbook.addWorksheet('Claims Detail');
    sheet.addRow(CLAIM_HEADER);
    claims.forEach((r) => sheet.addRow(r));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

const callHandler = async (handler, req) => {
  let out;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(body) { out = { status: this.statusCode, body }; return this; } };
  await handler({ query: {}, params: {}, body: {}, ...req }, res);
  return out;
};

test('the weekly upload stores the Claims Detail sheet, matches it from history, and never changes what it stages', { skip: !hasDb && 'set ASSIGNMENT_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const { weeklyExcelUpload } = await import('../controllers/admin/weeklyUploadsController.js');
  const { importAssignmentHistory } = await import('../controllers/admin/assignmentHistoryController.js');
  const { createEntry } = await import('../services/payroll/ledger/ledgerStore.js');
  const { parseNewEntry } = await import('../services/payroll/ledger/ledgerRules.js');
  const { generateRun, setRecoveryLimit, getRun } = await import('../services/payroll/payRuns/payRunStore.js');

  const client = await pool.connect();
  const realConnect = pool.connect.bind(pool);
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
    for (const m of ['2026-11-03-issue-140-carrier-assignment-history.sql', '2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql']) await client.query(migration(m));

    const one = async (sql, params) => (await client.query(sql, params)).rows[0];
    // The Dallas GOFO city has the code "DFW GOFO" (the exemption keys on the code). A test copy of it keeps the data made up.
    await client.query("UPDATE city SET city_code = city_code || ' (old)' WHERE city_code = 'DFW GOFO'");
    const dfw = await one("INSERT INTO city (job, city_code, city_type) VALUES ('Claims Flow Dallas', 'DFW GOFO', 'WEEKLY') RETURNING id, job");
    const other = await one("INSERT INTO city (job, city_code, city_type) VALUES ('Claims Flow Tyler', 'CLF TYLER', 'WEEKLY') RETURNING id, job");
    const route = (job, code) => client.query(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3)',
      [`Test ${code}`, job, code]);
    await route(dfw.job, 'CLFD 01-1');
    await route(other.job, 'CLFT 01-1');
    const driverRow = async (name, code, cityId) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/ /g, '.')}@example.test`, code, cityId])).id;
    const driverD = await driverRow('Claims Driver D', 91000011, dfw.id);
    const driverT = await driverRow('Claims Driver T', 91000012, other.id);
    const superAdmin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', 'Claims Super', 'claims.super@example.test', 'superadmin') RETURNING id, role");
    const cityAdmin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', 'Claims City', 'claims.city@example.test', 'admin') RETURNING id, role");
    await client.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, other.id]);

    const SUPER = { id: superAdmin.id, role: 'superadmin' };
    const upload = (buffer, user = SUPER, originalname = 'weekly.xlsx') => callHandler(weeklyExcelUpload, { file: { buffer, originalname }, user });
    const staged = async () => (await client.query('SELECT driver_id, del_route, del_date::text AS d, total_deliveries FROM weeklycount ORDER BY driver_id, del_date, del_route')).rows;
    const claimState = async (prefix) => Object.fromEntries((await client.query(
      `SELECT c.waybill, m.status, m.eligible_deduction, m.driver_id FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id
        WHERE c.waybill LIKE $1 AND c.superseded_at IS NULL ORDER BY c.waybill`, [`${prefix}%`])).rows.map((r) => [r.waybill, [r.status, r.eligible_deduction, r.driver_id]]));

    const fee = (waybill, route, deliveryId, when = '12/07/2030 10:00:00') => [waybill, 'Sam', route, deliveryId, when, 4.5, '1'];
    const file1 = await fileOf({
      fee: [fee('WCL001', 'CLFD 01-1', 91000011), fee('WCL002', 'CLFD 01-1', 91000011)],
      claims: [
        ['12/07/2030 09:00:00', 'WCL001', 'Damaged Item', 500, null, -12.5],          // history in this file: chargeable
        ['12/07/2030 09:00:00', 'WCL002', 'Tracking interruption', 80, null, -9],      // DFW GOFO + tracking interruption: exempt
        ['12/07/2030 09:00:00', 'WCL003', 'Damaged Item', 500, null, -4],              // no history anywhere: waits
        ['12/07/2030 09:00:00', 'WCL004', 'Damaged Item', 500, null, 'abc'],           // bad amount: reported, not skipped
      ],
    });

    await t.test('the claims are stored, matched from the history of the same upload, and the bad row is reported with its row number', async () => {
      const result = await upload(file1);
      assert.equal(result.status, 200);
      const claims = result.body.data.claims;
      assert.deepEqual([claims.found, claims.stored, claims.inFile, claims.inserted, claims.duplicates, claims.amended, claims.held], [true, true, 3, 3, 0, 0, 0]);
      assert.deepEqual(claims.matched, { chargeable: 1, exempt: 1 });
      assert.deepEqual(claims.waiting, { unresolved: 1, ambiguous: 0 });
      assert.equal(claims.problems, 1);
      assert.equal(claims.problemRows[0].row, 5);
      assert.deepEqual(await claimState('WCL'), {
        WCL001: ['chargeable', '12.50', driverD],
        WCL002: ['exempt', '0.00', driverD],
        WCL003: ['unresolved', null, null],
      });
      assert.equal(result.body.data.recordsInserted, 1, 'the pay staging is what it always was');
    });

    await t.test('the same file twice stores no new claim and charges nothing twice', async () => {
      const before = await staged();
      const again = await upload(file1, SUPER, 'renamed.xlsx');
      assert.equal(again.status, 200);
      assert.deepEqual([again.body.data.claims.inserted, again.body.data.claims.duplicates], [0, 3]);
      assert.deepEqual(await staged(), before);
      assert.equal(Number((await client.query("SELECT count(*) n FROM courier_claims WHERE waybill LIKE 'WCL%'")).rows[0].n), 3);
    });

    await t.test('a changed amount becomes a new version', async () => {
      const changed = await fileOf({ fee: [fee('WCL001', 'CLFD 01-1', 91000011)], claims: [['12/07/2030 09:00:00', 'WCL001', 'Damaged Item', 500, null, -15]] });
      const result = await upload(changed, SUPER, 'changed.xlsx');
      assert.equal(result.body.data.claims.amended, 1);
      assert.equal((await claimState('WCL')).WCL001[1], '15.00');
    });

    await t.test('a claim with no history waits, then matches after the history arrives', async () => {
      assert.equal((await claimState('WCL')).WCL003[0], 'unresolved');
      const history = await fileOf({ fee: [fee('WCL003', 'CLFD 01-1', 91000011)] });
      const imported = await callHandler(importAssignmentHistory, { file: { buffer: history, originalname: 'history.xlsx' }, user: SUPER });
      assert.equal(imported.status, 200);
      assert.deepEqual((await claimState('WCL')).WCL003, ['chargeable', '4.00', driverD]);
    });

    await t.test('a claim already entered by hand is held in review, never deducted twice', async () => {
      const parsed = parseNewEntry({
        requestId: randomUUID(), type: 'manual_claim', driverId: driverT, cityId: other.id, amount: '6.00', reason: 'Test manual claim',
        effectiveDate: '2030-12-01', claimType: 'Damaged Item', waybill: 'WCL005', recoveryPlan: 'full_next_payday',
      });
      assert.ok(parsed.entry, JSON.stringify(parsed.errors));
      await createEntry(client, superAdmin, parsed.entry);
      const file = await fileOf({
        fee: [fee('WCL005', 'CLFT 01-1', 91000012)],
        claims: [['12/07/2030 09:00:00', 'WCL005', 'Damaged Item', 100, null, -6]],
      });
      const result = await upload(file, SUPER, 'tyler.xlsx');
      assert.equal(result.body.data.claims.held, 1);
      assert.equal(result.body.data.claims.onHold, 1);
      assert.equal((await claimState('WCL')).WCL005[0], 'review');
    });

    await t.test('a draft pay run deducts the matched claims once, and nothing for the exempt one', async () => {
      await setRecoveryLimit(client, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
      const routeId = (await one("SELECT id FROM routes WHERE route_code_in_string = 'CLFD 01-1'")).id;
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,9100,9109,$3,10) RETURNING id', [driverD, routeId, '2030-12-07'])).id;
      await client.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = 100, insurance_deduction = 0 WHERE dashboard_data_id = $1', [dd]);
      const { run } = await generateRun(client, superAdmin, { requestId: randomUUID(), cityId: dfw.id, periodStart: '2030-12-01', periodEnd: '2030-12-14', dataType: 'daily' });
      const statement = (await getRun(client, superAdmin, run.id)).statements.find((s) => s.driver_id === driverD);
      // WCL001 was amended to 15.00 and WCL003 is 4.00; the exempt WCL002 takes nothing.
      assert.equal(statement.claim_deductions, '19.00');
      assert.equal(statement.net, '81.00');
    });

    await t.test('a report whose routes belong to two cities stores no claim, and says why', async () => {
      const mixed = await fileOf({
        fee: [fee('WCL006', 'CLFD 01-1', 91000011, '12/08/2030 10:00:00'), fee('WCL007', 'CLFT 01-1', 91000012, '12/08/2030 10:00:00')],
        claims: [['12/08/2030 09:00:00', 'WCL006', 'Damaged Item', 500, null, -7]],
      });
      const result = await upload(mixed, SUPER, 'mixed.xlsx');
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.claims.stored, result.body.data.claims.inFile], [false, 1]);
      assert.match(result.body.data.claims.reason, /more than one city/);
      assert.equal(result.body.data.recordsInserted, 2, 'the pay upload is unaffected');
      assert.equal(Object.keys(await claimState('WCL006')).length, 0);
    });

    await t.test('a report with a known route and an unknown route stores no claim, and names the unknown route', async () => {
      const file = await fileOf({
        fee: [fee('WCL020', 'CLFD 01-1', 91000011, '12/13/2030 10:00:00'), fee('WCL021', 'NOSUCH 99-9', 91000011, '12/13/2030 10:00:00')],
        claims: [['12/13/2030 09:00:00', 'WCL020', 'Damaged Item', 500, null, -7]],
      });
      const result = await upload(file, SUPER, 'unknown-route.xlsx');
      assert.equal(result.status, 200);
      assert.equal(result.body.data.claims.stored, false);
      assert.match(result.body.data.claims.reason, /1 route .* not set up \(NOSUCH 99-9\)/);
      assert.equal(Object.keys(await claimState('WCL020')).length, 0);
      assert.ok(result.body.data.recordsInserted >= 1, 'the pay upload is unaffected');
    });

    await t.test('a row with no waybill does not narrow the city check: two cities with an incomplete row store no claim', async () => {
      const file = await fileOf({
        fee: [fee('WCL022', 'CLFD 01-1', 91000011, '12/14/2030 10:00:00'), fee('', 'CLFT 01-1', 91000012, '12/14/2030 10:00:00')],
        claims: [['12/14/2030 09:00:00', 'WCL022', 'Damaged Item', 500, null, -7]],
      });
      const result = await upload(file, SUPER, 'two-cities-incomplete.xlsx');
      assert.equal(result.status, 200);
      assert.equal(result.body.data.assignmentHistory.problems, 1, 'the row without a waybill is an identity problem');
      assert.equal(result.body.data.claims.stored, false);
      assert.match(result.body.data.claims.reason, /more than one city/);
      assert.equal(Object.keys(await claimState('WCL022')).length, 0);
    });

    await t.test('a single-city report whose fee row has no waybill still stores its claims, pending without package identity', async () => {
      const file = await fileOf({
        fee: [fee('', 'CLFD 01-1', 91000011, '12/15/2030 10:00:00')],
        claims: [['12/15/2030 09:00:00', 'WCL023', 'Damaged Item', 500, null, -7]],
      });
      const result = await upload(file, SUPER, 'single-city-incomplete.xlsx');
      assert.equal(result.status, 200);
      assert.equal(result.body.data.claims.stored, true);
      assert.equal(result.body.data.claims.cityId, dfw.id);
      assert.equal((await claimState('WCL023')).WCL023[0], 'unresolved', 'no package identity, so it waits');
    });

    await t.test('an unknown route on the Offset Details sheet also blocks the claims', async () => {
      const workbook = new ExcelJS.Workbook();
      const feeSheet = workbook.addWorksheet('Details of Delivery Fees');
      feeSheet.addRow(FEE_HEADER);
      feeSheet.addRow(fee('WCL024', 'CLFD 01-1', 91000011, '12/16/2030 10:00:00'));
      const offset = workbook.addWorksheet('Offset Details');
      offset.addRow(FEE_HEADER);
      offset.addRow(['WCL025', 'Sam', 'NOSUCH 98-8', 91000011, '12/16/2030 10:00:00', -1, null]);
      const claims = workbook.addWorksheet('Claims Detail');
      claims.addRow(CLAIM_HEADER);
      claims.addRow(['12/16/2030 09:00:00', 'WCL024', 'Damaged Item', 500, null, -7]);
      const result = await upload(Buffer.from(await workbook.xlsx.writeBuffer()), SUPER, 'offset-unknown.xlsx');
      assert.equal(result.body.data.claims.stored, false);
      assert.match(result.body.data.claims.reason, /NOSUCH 98-8/);
    });

    await t.test('a city admin cannot upload a report of a city that is not theirs, so no claim is stored either', async () => {
      const file = await fileOf({
        fee: [fee('WCL008', 'CLFD 01-1', 91000011, '12/09/2030 10:00:00')],
        claims: [['12/09/2030 09:00:00', 'WCL008', 'Damaged Item', 500, null, -3]],
      });
      const result = await upload(file, { id: cityAdmin.id, role: 'admin' }, 'dallas-by-tyler-admin.xlsx');
      assert.equal(result.status, 403, 'the existing city check refuses the whole upload');
      assert.equal(Object.keys(await claimState('WCL008')).length, 0);
    });

    await t.test('a city admin uploading their own city stores its claims', async () => {
      const file = await fileOf({
        fee: [fee('WCL011', 'CLFT 01-1', 91000012, '12/09/2030 10:00:00')],
        claims: [['12/09/2030 09:00:00', 'WCL011', 'Damaged Item', 500, null, -3]],
      });
      const result = await upload(file, { id: cityAdmin.id, role: 'admin' }, 'tyler-by-tyler-admin.xlsx');
      assert.equal(result.status, 200);
      assert.deepEqual([result.body.data.claims.stored, result.body.data.claims.cityId], [true, other.id]);
      assert.equal((await claimState('WCL011')).WCL011[0], 'chargeable');
    });

    await t.test('a claim already held for another city is neither amended nor counted by this city\'s upload', async () => {
      const before = await claimState('WCL001');
      const file = await fileOf({
        fee: [fee('WCL012', 'CLFT 01-1', 91000012, '12/12/2030 10:00:00')],
        claims: [
          ['12/12/2030 09:00:00', 'WCL001', 'Damaged Item', 500, null, -99],  // Dallas's claim, named in a Tyler report
          ['12/12/2030 09:00:00', 'WCL012', 'Damaged Item', 500, null, -2],   // Tyler's own
        ],
      });
      let round = 0;
      for (const user of [{ id: cityAdmin.id, role: 'admin' }, SUPER]) {
        const result = await upload(file, user, `tyler-${user.role}.xlsx`);
        assert.equal(result.status, 200);
        const c = result.body.data.claims;
        const limited = user.role !== 'superadmin';
        // A city admin is told only "already recorded", as for their own repeat; a super admin also gets the count.
        assert.equal(c.notStored, limited ? undefined : 1);
        assert.equal(c.inFile, 2);
        // Only Tyler's own claim can be new or a duplicate; the other city's claim shows up only in notStored.
        assert.deepEqual([c.amended, c.duplicates, c.inserted], [0, round + (limited ? 1 : 0), 1 - round]);
        round += 1;
      }
      assert.deepEqual(await claimState('WCL001'), before, 'Dallas\'s claim is untouched');
      assert.equal(Number((await client.query("SELECT count(*) n FROM courier_claims WHERE waybill = 'WCL001'")).rows[0].n), 2, 'no new version was made');
      assert.equal((await claimState('WCL012')).WCL012[0], 'chargeable');
    });

    await t.test('a report without a Claims Detail sheet says so and changes nothing', async () => {
      const result = await upload(await fileOf({ fee: [fee('WCL009', 'CLFD 01-1', 91000011, '12/10/2030 10:00:00')] }), SUPER, 'no-claims.xlsx');
      assert.deepEqual(result.body.data.claims, { found: false, stored: false });
    });

    await t.test('if the claims tables are missing, the pay upload and the history still go through and the answer says so', async () => {
      await client.query(migration('2026-11-03-issue-143-pay-runs.rollback.sql'));
      await client.query(migration('2026-11-03-issue-166-ledger-settlements.rollback.sql')); // it references the ledger table
      await client.query(migration('2026-11-03-issue-142-driver-ledger.rollback.sql'));
      await client.query(migration('2026-11-03-issue-141-courier-claims.rollback.sql'));
      const result = await upload(await fileOf({
        fee: [fee('WCL010', 'CLFD 01-1', 91000011, '12/11/2030 10:00:00')],
        claims: [['12/11/2030 09:00:00', 'WCL010', 'Damaged Item', 500, null, -3]],
      }), SUPER, 'late.xlsx');
      assert.equal(result.status, 200);
      assert.equal(result.body.data.recordsInserted, 1);
      assert.equal(result.body.data.assignmentHistory.saved, true);
      assert.equal(result.body.data.claims.stored, false);
      assert.match(result.body.data.claims.reason, /not set up/);
    });
  } finally {
    pool.connect = realConnect;
    delete pool.query;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
