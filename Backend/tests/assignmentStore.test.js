import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evidenceFromCells } from '../services/excel/assignmentHistory/assignmentRules.js';
import {
  candidateFinderFor,
  findAssignmentCandidates,
  listWaybillConflicts,
  recordReport,
  refreshOpenAssignments,
  voidImport,
} from '../services/excel/assignmentHistory/assignmentStore.js';

// Needs a PostgreSQL copy that has the app's tables (never production). Run with ASSIGNMENT_TEST_DB=1 and the usual
// DB_* variables. Everything happens inside one transaction that is always rolled back: the migration, the cities,
// routes, drivers, reports and checks. Nothing is left behind. All values are made up.
const hasDb = process.env.ASSIGNMENT_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-03-issue-140-carrier-assignment-history.sql', import.meta.url));

const hashOf = (label) => createHash('sha256').update(label).digest('hex');
const row = (sheet, sourceRow, waybill, deliveryId, route, signing = '10/01/2026 10:00:00') => ({
  sheet, sourceRow, ...evidenceFromCells({ waybill, deliveryId, route, signing }).evidence,
});
const reportOf = (...rows) => ({
  carrier: 'gofo',
  sheets: { fee_details: { rows: rows.filter((r) => r.sheet === 'fee_details').length }, offset_details: { rows: rows.filter((r) => r.sheet === 'offset_details').length } },
  rows,
  problems: [],
  problemCount: 0,
});

test('assignment history keeps, resolves and looks up carrier evidence without guessing', { skip: !hasDb && 'set ASSIGNMENT_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    await db.query(readFileSync(MIGRATION, 'utf8')); // safe to run twice

    // Two made-up cities with a made-up route each; one driver in each. The cities' codes are unique test labels.
    const city = async (job, code) => (await db.query("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [job, code])).rows[0].id;
    const route = async (job, code) => (await db.query(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 1, 1, 1, 1, $3) RETURNING id',
      [`Test ${code}`, job, code]
    )).rows[0].id;
    const driver = async (name, code, cityId) => (await db.query(
      "INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id",
      [name, `${name.replace(/\s+/g, '.')}.${code}@example.test`, code, cityId]
    )).rows[0].id;
    const cityA = await city('Test Alpha GOFO', 'TEST ALPHA');
    const cityB = await city('Test Beta GOFO', 'TEST BETA');
    const routeA = await route('Test Alpha GOFO', 'TSTA 01-1');
    const routeB = await route('Test Beta GOFO', 'TSTB 01-1');
    const driverA = await driver('Alex Test', 90000001, cityA);
    const driverB = await driver('alex test', 90000002, cityB); // same name apart from case: the name decides nothing
    const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
    const find = (waybill) => findAssignmentCandidates(db, { courier: 'gofo', waybill });

    const week1 = reportOf(
      row('fee_details', 2, 'TW0001', 90000001, 'TSTA 01-1'),
      row('fee_details', 3, 'TW0002', 90000002, 'TSTB 01-1'),
      row('offset_details', 2, 'TW0003', 90000001, 'TSTA 01-1', '09/10/2026 08:00:00'), // an offset about an earlier period
    );

    await t.test('fee rows and offset rows are both kept, with the driver and the route city from the evidence', async () => {
      const result = await recordReport(db, week1, { reportHash: hashOf('week1'), sourceLabel: 'LFT week 1.xlsx', importedBy: null, allowedJobs: null });
      assert.deepEqual([result.alreadyRecorded, result.recorded, result.known, result.skipped], [false, 3, 0, 0]);
      assert.deepEqual(result.resolved, { drivers: 3, routes: 3 }, 'each fact is linked to its driver and route when it is recorded');

      const [offsetOnly] = await find('TW0003');
      assert.equal(offsetOnly.driverId, driverA);
      assert.equal(offsetOnly.cityId, cityA);
      assert.equal(offsetOnly.cityName, 'TEST ALPHA', 'cityName is the stored city code, the label the DFW GOFO rule is written against');
      assert.equal(offsetOnly.cityJob, 'Test Alpha GOFO');
      assert.equal(offsetOnly.carrierDeliveryId, '90000001');
      assert.equal(offsetOnly.routeId, routeA);
      assert.equal(offsetOnly.journeyDate, '2026-09-10');
      assert.deepEqual(offsetOnly.evidence.map((e) => [e.sheet, e.row]), [['offset_details', 2]]);

      const [fee] = await find('TW0002');
      assert.deepEqual([fee.driverId, fee.cityId, fee.routeId], [driverB, cityB, routeB]);
    });

    await t.test('the waybill is found however it is spaced or cased, and an unknown one has no history', async () => {
      assert.equal((await find(' tw 0001 ')).length, 1);
      assert.deepEqual(await find('TW9999'), []);
      assert.deepEqual(await find(''), []);
      assert.deepEqual(await findAssignmentCandidates(db, { courier: 'speedx', waybill: 'TW0001' }), []);
    });

    await t.test('the same file again, under any name, adds nothing', async () => {
      const again = await recordReport(db, week1, { reportHash: hashOf('week1'), sourceLabel: 'renamed copy.xlsx', importedBy: null, allowedJobs: null });
      assert.deepEqual([again.alreadyRecorded, again.recorded], [true, 0]);
      assert.equal(await count('SELECT count(*) n FROM carrier_package_assignments'), 3);
      assert.equal(await count('SELECT count(*) n FROM carrier_assignment_imports'), 1);
    });

    await t.test('a re-saved, reordered file with the same facts adds no facts, only a new sighting', async () => {
      const reordered = reportOf(
        row('offset_details', 2, 'tw0003', 90000001, 'TSTA 01-1', '09/10/2026 08:00:00'),
        row('fee_details', 2, 'TW0002', 90000002, 'TSTB 01-1'),
        row('fee_details', 3, 'TW0001', 90000001, 'TSTA 01-1'),
      );
      const result = await recordReport(db, reordered, { reportHash: hashOf('week1-resaved'), sourceLabel: 'week1 again.xlsx', importedBy: null, allowedJobs: null });
      assert.deepEqual([result.alreadyRecorded, result.recorded, result.known], [false, 0, 3]);
      assert.equal(await count('SELECT count(*) n FROM carrier_package_assignments'), 3);
      assert.equal(await count('SELECT count(*) n FROM carrier_assignment_sightings'), 6);
      const [candidate] = await find('TW0001');
      assert.equal(candidate.assignmentIds.length, 1);
      assert.equal(candidate.evidence.length, 2, 'both reports are kept as provenance');
    });

    await t.test('two Delivery IDs for one waybill are both kept and returned, never settled by taking the first', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0010', 90000001, 'TSTA 01-1'), row('offset_details', 2, 'TW0010', 90000002, 'TSTA 01-1')),
        { reportHash: hashOf('conflict'), sourceLabel: 'conflict.xlsx', importedBy: null, allowedJobs: null });
      const candidates = await find('TW0010');
      assert.deepEqual(candidates.map((c) => c.driverId).sort(), [driverA, driverB].sort());
      const conflicts = await listWaybillConflicts(db);
      const mine = conflicts.find((c) => c.waybillKey === 'TW0010');
      assert.deepEqual([mine.facts, mine.deliveryIds, mine.drivers], [2, 2, 2]);
    });

    await t.test('one waybill on routes of two cities returns both cities', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0011', 90000001, 'TSTA 01-1'), row('offset_details', 2, 'TW0011', 90000001, 'TSTB 01-1')),
        { reportHash: hashOf('two-cities'), sourceLabel: 'two cities.xlsx', importedBy: null, allowedJobs: null });
      const candidates = await find('TW0011');
      assert.deepEqual(candidates.map((c) => c.cityId).sort(), [cityA, cityB].sort());
    });

    await t.test('a fact with no route adds no conflict when the same Delivery ID has one known city', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0012', 90000001, 'TSTA 01-1'), row('offset_details', 2, 'TW0012', 90000001, null)),
        { reportHash: hashOf('no-route'), sourceLabel: 'no route.xlsx', importedBy: null, allowedJobs: null });
      const candidates = await find('TW0012');
      assert.equal(candidates.length, 1);
      assert.deepEqual([candidates[0].driverId, candidates[0].cityId], [driverA, cityA]);
      assert.equal(candidates[0].assignmentIds.length, 2);
    });

    await t.test('a route NASA does not know gives a driver but no city, so the city stays unresolved', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0013', 90000001, 'NO SUCH ROUTE')),
        { reportHash: hashOf('unknown-route'), sourceLabel: 'unknown route.xlsx', importedBy: null, allowedJobs: null });
      const [candidate] = await find('TW0013');
      assert.deepEqual([candidate.driverId, candidate.cityId, candidate.routeId], [driverA, null, null]);
      assert.equal(await count("SELECT count(*) n FROM carrier_package_assignments WHERE waybill_key = 'TW0013' AND route_state = 'unknown_route'"), 1);
    });

    await t.test('the driver comes from the Delivery ID, not from where the driver lives now', async () => {
      await db.query('UPDATE drivers SET city_id = $1 WHERE id = $2', [cityB, driverA]); // driver A moves to city B
      const [candidate] = await find('TW0001');
      assert.deepEqual([candidate.driverId, candidate.cityId, candidate.cityName, candidate.cityJob], [driverA, cityA, 'TEST ALPHA', 'Test Alpha GOFO']);
    });

    await t.test('a Delivery ID with leading zeros is its own value and is never matched to a driver', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0014', '090000001', 'TSTA 01-1'), row('offset_details', 2, 'TW0015', 90000001, 'TSTA 01-1')),
        { reportHash: hashOf('zeros'), sourceLabel: 'zeros.xlsx', importedBy: null, allowedJobs: null });
      const [padded] = await find('TW0014');
      assert.deepEqual([padded.carrierDeliveryId, padded.driverId, padded.cityId], ['090000001', null, cityA]);
      const [plain] = await find('TW0015');
      assert.equal(plain.driverId, driverA);
      assert.equal(await count("SELECT count(*) n FROM carrier_package_assignments WHERE driver_state = 'unusable_id'"), 1);
    });

    await t.test('a driver added later is linked to earlier evidence, and once linked it never moves', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0016', 90000003, 'TSTA 01-1')),
        { reportHash: hashOf('late-driver'), sourceLabel: 'late driver.xlsx', importedBy: null, allowedJobs: null });
      assert.equal((await find('TW0016'))[0].driverId, null);
      const driverC = await driver('Late Driver', 90000003, cityA);
      assert.deepEqual(await refreshOpenAssignments(db), { drivers: 1, routes: 0 });
      assert.equal((await find('TW0016'))[0].driverId, driverC);

      // The code is later given to someone else: the history keeps the person it named at the time.
      await db.query('UPDATE drivers SET driver_code = 90000099 WHERE id = $1', [driverC]);
      const driverD = await driver('Next Holder', 90000003, cityA);
      await refreshOpenAssignments(db);
      const [candidate] = await find('TW0016');
      assert.equal(candidate.driverId, driverC);
      assert.notEqual(candidate.driverId, driverD);
    });

    await t.test('the database refuses to edit or delete the evidence, or to move a resolved driver', async () => {
      const guarded = async (sql, pattern) => {
        await db.query('SAVEPOINT guard');
        await assert.rejects(db.query(sql), pattern);
        await db.query('ROLLBACK TO SAVEPOINT guard');
      };
      await guarded("UPDATE carrier_package_assignments SET external_delivery_id = '1' WHERE waybill_key = 'TW0001'", /evidence cannot be changed/);
      await guarded("UPDATE carrier_package_assignments SET waybill = 'OTHER' WHERE waybill_key = 'TW0001'", /evidence cannot be changed/);
      await guarded(`UPDATE carrier_package_assignments SET driver_id = ${driverB} WHERE waybill_key = 'TW0001'`, /resolved driver/);
      await guarded("UPDATE carrier_package_assignments SET city_id = NULL, route_id = NULL, route_state = 'unknown_route' WHERE waybill_key = 'TW0001'", /resolved route/);
      await guarded('DELETE FROM carrier_package_assignments', /cannot be deleted/);
      await guarded('DELETE FROM carrier_assignment_sightings', /cannot be changed or deleted/);
      await guarded('UPDATE carrier_assignment_sightings SET source_row = 99', /cannot be changed or deleted/);
      await guarded('DELETE FROM carrier_assignment_imports', /cannot be deleted/);
      await guarded("UPDATE carrier_assignment_imports SET report_hash = repeat('a', 64)", /cannot be changed/);
    });

    await t.test('a city admin records only the routes of their own cities; the rest is left out and counted', async () => {
      const result = await recordReport(db, reportOf(
        row('fee_details', 2, 'TW0020', 90000001, 'TSTA 01-1'),
        row('fee_details', 3, 'TW0021', 90000002, 'TSTB 01-1'),
        row('fee_details', 4, 'TW0022', 90000001, null),
        row('fee_details', 5, 'TW0023', 90000001, 'NO SUCH ROUTE'),
      ), { reportHash: hashOf('limited'), sourceLabel: 'limited.xlsx', importedBy: 7, allowedJobs: ['Test Alpha GOFO'] });
      assert.deepEqual([result.recorded, result.skipped], [1, 3]);
      assert.equal((await find('TW0020')).length, 1);
      for (const other of ['TW0021', 'TW0022', 'TW0023']) assert.deepEqual(await find(other), []);
      assert.equal(await count("SELECT skipped_rows n FROM carrier_assignment_imports WHERE report_hash = $1", [hashOf('limited')]), 3);
    });

    await t.test('an unreadable signing time keeps the fact without a date', async () => {
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0030', 90000001, 'TSTA 01-1', 'not a date')),
        { reportHash: hashOf('undated'), sourceLabel: 'undated.xlsx', importedBy: null, allowedJobs: null });
      const [candidate] = await find('TW0030');
      assert.deepEqual([candidate.driverId, candidate.journeyDate], [driverA, null]);
    });

    await t.test('a voided import stops standing, unless another report also holds the fact', async () => {
      const first = await recordReport(db, reportOf(row('fee_details', 2, 'TW0040', 90000001, 'TSTA 01-1'), row('fee_details', 3, 'TW0041', 90000001, 'TSTA 01-1')),
        { reportHash: hashOf('void-me'), sourceLabel: 'wrong file.xlsx', importedBy: null, allowedJobs: null });
      await recordReport(db, reportOf(row('fee_details', 2, 'TW0041', 90000001, 'TSTA 01-1')),
        { reportHash: hashOf('keep-me'), sourceLabel: 'right file.xlsx', importedBy: null, allowedJobs: null });
      await assert.rejects(voidImport(db, first.importId, { reason: ' ' }), /reason/);
      assert.equal(await voidImport(db, first.importId, { reason: 'Uploaded the wrong region', adminId: 7 }), true);
      assert.equal(await voidImport(db, first.importId, { reason: 'again' }), false);
      assert.deepEqual(await find('TW0040'), []);
      const [kept] = await find('TW0041');
      assert.equal(kept.driverId, driverA);
      assert.equal(kept.evidence.length, 1, 'only the report that still stands is listed');
      assert.equal(await count('SELECT count(*) n FROM carrier_package_assignments WHERE waybill_key = $1', ['TW0040']), 1, 'nothing is deleted');

      const again = await recordReport(db, reportOf(row('fee_details', 2, 'TW0040', 90000001, 'TSTA 01-1')),
        { reportHash: hashOf('void-me'), sourceLabel: 'wrong file.xlsx', importedBy: null, allowedJobs: null });
      assert.deepEqual([again.alreadyRecorded, again.voided], [true, true]);
      assert.deepEqual(await find('TW0040'), [], 'a voided file is not brought back by uploading it again');
    });

    await t.test('the rematch function has the shape the claims side calls', async () => {
      const finder = candidateFinderFor(db);
      const [candidate] = await finder({ courier: 'gofo', waybill: 'TW0001' });
      for (const key of ['driverId', 'cityId', 'cityName', 'carrierDeliveryId', 'routeId', 'journeyDate']) assert.ok(key in candidate, key);
    });

    await t.test('a bad report hash is refused', async () => {
      await assert.rejects(recordReport(db, week1, { reportHash: 'nope', sourceLabel: 'x' }), /sha256/);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
