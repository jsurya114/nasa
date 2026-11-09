import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importClaims, rematchAllOpenClaims, rematchOpenClaims } from '../services/payroll/claims/claimsStore.js';
import { parseClaimsRows } from '../services/payroll/claims/claimsParser.js';

// Needs a PostgreSQL copy that has the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the usual
// DB_* variables. Everything happens inside one transaction that is always rolled back: the migration, the claims
// and the checks. Nothing is left behind. All values are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const MIGRATION = fileURLToPath(new URL('../migrations/2026-11-03-issue-141-courier-claims.sql', import.meta.url));

const HEADER = ['date', 'Waybill No.', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes'];
const parse = (rows) => parseClaimsRows([HEADER, ...rows], { courier: 'gofo' }).claims;

test('claims are stored once, amended as versions, and matched only from history', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(MIGRATION, 'utf8'));
    const { rows: cities } = await db.query('SELECT id FROM city ORDER BY id LIMIT 2');
    const { rows: drivers } = await db.query('SELECT id FROM drivers ORDER BY id LIMIT 2');
    assert.equal(cities.length, 2, 'needs two cities in the test database');
    assert.equal(drivers.length, 2, 'needs two drivers in the test database');
    const [cityA, cityB] = cities.map((r) => r.id);
    const [driverA, driverB] = drivers.map((r) => r.id);
    const source = { importCityId: cityA, sourceFile: 'synthetic-week-1.xlsx', sourceSheet: 'Claims Detail', importedBy: null };
    const count = async (sql) => Number((await db.query(sql)).rows[0].n);

    const week1 = parse([
      ['09/28/2026 10:00:00', 'TESTW001', 'Damaged Item', 500, '10/02/2026 09:00:00', -40],
      ['09/29/2026 11:00:00', 'TESTW002', 'Tracking interruption', 80, null, 25],
      ['08/30/2026 08:00:00', 'TESTW003', 'fake pod', 10, null, -15.5], // a claim about an earlier period
    ]);

    await t.test('a new file stores every claim, unresolved and without a deduction', async () => {
      const result = await importClaims(db, week1, source);
      assert.equal(result.inserted.length, 3);
      assert.equal(await count("SELECT count(*) n FROM courier_claim_matches WHERE status = 'unresolved' AND eligible_deduction IS NULL"), 3);
      const { rows } = await db.query("SELECT deduction_amount, original_charge, to_char(claim_at, 'YYYY-MM-DD') d FROM courier_claims WHERE waybill = 'TESTW003'");
      assert.deepEqual(rows[0], { deduction_amount: '15.50', original_charge: '-15.50', d: '2026-08-30' });
    });

    await t.test('uploading the same claims again, even in another file, adds nothing', async () => {
      const again = await importClaims(db, week1, { ...source, sourceFile: 'synthetic-week-1-copy.xlsx' });
      assert.deepEqual([again.inserted.length, again.duplicates.length, again.amended.length], [0, 3, 0]);
      assert.equal(await count("SELECT count(*) n FROM courier_claims WHERE waybill LIKE 'TESTW%'"), 3);
    });

    await t.test('a changed amount is a new version; the old one is kept and marked superseded', async () => {
      const amended = await importClaims(db, parse([['09/28/2026 10:00:00', 'TESTW001', 'Damaged Item', 500, '10/02/2026 09:00:00', -45]]), source);
      assert.equal(amended.amended.length, 1);
      const { rows } = await db.query("SELECT version, deduction_amount, superseded_at IS NOT NULL AS old FROM courier_claims WHERE waybill = 'TESTW001' ORDER BY version");
      assert.deepEqual(rows, [{ version: 1, deduction_amount: '40.00', old: true }, { version: 2, deduction_amount: '45.00', old: false }]);
    });

    await t.test('rematching uses history only and leaves anything unproven open', async () => {
      const history = {
        TESTW001: [{ driverId: driverA, cityId: cityA, cityName: 'DFW GOFO', carrierDeliveryId: '900001', routeId: null, journeyDate: '2026-09-28' }],
        TESTW002: [{ driverId: driverA, cityId: cityA, cityName: 'DFW GOFO', carrierDeliveryId: '900001', routeId: null, journeyDate: '2026-09-29' }],
        TESTW003: [
          { driverId: driverA, cityId: cityA, cityName: 'DFW GOFO', carrierDeliveryId: '900001' },
          { driverId: driverB, cityId: cityA, cityName: 'DFW GOFO', carrierDeliveryId: '900002' },
        ],
      };
      const { counts } = await rematchOpenClaims(db, async ({ waybill }) => history[waybill] ?? []);
      assert.deepEqual(counts, { chargeable: 1, exempt: 1, unresolved: 0, ambiguous: 1 });
      const { rows } = await db.query(
        `SELECT c.waybill, m.status, m.eligible_deduction, m.driver_id FROM courier_claim_matches m
           JOIN courier_claims c ON c.id = m.claim_id WHERE c.superseded_at IS NULL AND c.waybill LIKE 'TESTW%' ORDER BY c.waybill`
      );
      assert.deepEqual(rows.map((r) => [r.waybill, r.status, r.eligible_deduction, r.driver_id]), [
        ['TESTW001', 'chargeable', '45.00', driverA],
        ['TESTW002', 'exempt', '0.00', driverA],
        ['TESTW003', 'ambiguous', null, null],
      ]);
    });

    await t.test('a decided claim is never changed by a later rematch, even if history changes', async () => {
      const moved = async () => [{ driverId: driverB, cityId: cityB, cityName: 'Tyler GOFO', carrierDeliveryId: '900003' }];
      const { counts } = await rematchOpenClaims(db, moved);
      assert.deepEqual(counts, { chargeable: 0, exempt: 0, unresolved: 0, ambiguous: 1 }); // only TESTW003 was open
      const { rows } = await db.query("SELECT m.status, m.driver_id FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id WHERE c.waybill = 'TESTW002' AND c.superseded_at IS NULL");
      assert.deepEqual(rows[0], { status: 'exempt', driver_id: driverA });
    });

    await t.test('claims that stay unresolved at the front never stop later claims from being matched', async () => {
      // Two new claims: the first has no delivery history (it stays unresolved), the second can be matched.
      await importClaims(db, parse([
        ['10/01/2026 10:00:00', 'TESTX001', 'Damaged Item', 10, null, -5],
        ['10/01/2026 11:00:00', 'TESTX002', 'Damaged Item', 10, null, -7],
      ]), source);
      const history = async ({ waybill }) => (waybill === 'TESTX002'
        ? [{ driverId: driverB, cityId: cityA, cityName: 'Tyler GOFO', carrierDeliveryId: '900009' }] : []);
      const state = async (waybill) => (await db.query(
        "SELECT m.status FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id WHERE c.waybill = $1 AND c.superseded_at IS NULL", [waybill])).rows[0].status;

      // One batch of one, three times without a cursor: always the same first open claim, as before the fix.
      for (let i = 0; i < 3; i += 1) await rematchOpenClaims(db, history, { limit: 1 });
      assert.equal(await state('TESTX002'), 'unresolved');
      // With the cursor, the sweep moves on.
      const first = await rematchOpenClaims(db, history, { limit: 1 });
      assert.notEqual(first.nextAfterId, null);
      const total = await rematchAllOpenClaims(db, history, { batch: 1 });
      assert.equal(total.chargeable, 1);
      assert.deepEqual([await state('TESTX001'), await state('TESTX002')], ['unresolved', 'chargeable']);
    });

    await t.test('a sweep can be limited to the waybills an assignment import touched', async () => {
      await importClaims(db, parse([['10/02/2026 10:00:00', 'TESTX003', 'Damaged Item', 10, null, -9]]), source);
      const seen = [];
      await rematchAllOpenClaims(db, async ({ waybill }) => { seen.push(waybill); return []; }, { waybills: ['TESTX003'] });
      assert.deepEqual(seen, ['TESTX003']);
    });

    await t.test('an import for another city never duplicates, amends or supersedes a claim (#162)', async () => {
      const versions = () => db.query("SELECT id, version, deduction_amount, superseded_at IS NOT NULL AS old FROM courier_claims WHERE waybill = 'TESTW001' ORDER BY version");
      const before = (await versions()).rows;
      const cityBSource = { ...source, importCityId: cityB, sourceFile: 'synthetic-city-b.xlsx' };
      const counts = (r) => [r.inserted.length, r.duplicates.length, r.amended.length, r.held.length, r.otherCity.length];
      // Same facts as city A's current version: not a duplicate for city B.
      const same = await importClaims(db, parse([['09/28/2026 10:00:00', 'TESTW001', 'Damaged Item', 500, '10/02/2026 09:00:00', -45]]), cityBSource);
      assert.deepEqual(counts(same), [0, 0, 0, 0, 1]);
      assert.deepEqual(same.otherCity, [{ sourceRow: 2 }]); // the row only, never the other city's claim ID
      // A changed amount: no new version.
      const changed = await importClaims(db, parse([
        ['09/28/2026 10:00:00', 'TESTW001', 'Damaged Item', 500, '10/02/2026 09:00:00', -99],
        ['10/03/2026 10:00:00', 'TESTB001', 'Damaged Item', 10, null, -6], // a claim only city B has
      ]), cityBSource);
      assert.deepEqual(counts(changed), [1, 0, 0, 0, 1]);
      assert.deepEqual((await versions()).rows, before);
      const { rows } = await db.query("SELECT import_city_id FROM courier_claims WHERE waybill = 'TESTB001'");
      assert.deepEqual(rows, [{ import_city_id: cityB }]);
      // City A can still amend its own claim.
      const own = await importClaims(db, parse([['09/28/2026 10:00:00', 'TESTW001', 'Damaged Item', 500, '10/02/2026 09:00:00', -50]]), source);
      assert.deepEqual([own.amended.length, own.otherCity.length], [1, 0]);
    });

    await t.test('the database itself refuses an exempt claim with money or a chargeable claim without a driver', async () => {
      const { rows } = await db.query("SELECT claim_id FROM courier_claim_matches m JOIN courier_claims c ON c.id = m.claim_id WHERE c.waybill = 'TESTW002' AND c.superseded_at IS NULL");
      const id = rows[0].claim_id;
      for (const sql of [
        `UPDATE courier_claim_matches SET eligible_deduction = 25 WHERE claim_id = ${id}`,
        `UPDATE courier_claim_matches SET status = 'chargeable', driver_id = NULL WHERE claim_id = ${id}`,
        `UPDATE courier_claim_matches SET status = 'unresolved' WHERE claim_id = ${id}`,
      ]) {
        await db.query('SAVEPOINT s');
        await assert.rejects(db.query(sql), /check constraint/);
        await db.query('ROLLBACK TO SAVEPOINT s');
      }
      await db.query('SAVEPOINT s');
      await assert.rejects(
        db.query("INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row) VALUES ('gofo', repeat('a', 64), 1, 'X', 'T', 't', now(), -40, 30, $1, 'f', 's', 2)", [cityA]),
        /check constraint/
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
