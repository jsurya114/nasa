import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { findMissingDrivers, MISSING_LIST_LIMIT } from '../services/admin/weeklyMissingDrivers.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything runs in one transaction that is
// always rolled back. Synthetic cities, routes, drivers and codes only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';

test('the limit is a sane number', () => assert.ok(MISSING_LIST_LIMIT >= 50 && MISSING_LIST_LIMIT <= 1000));

test('a database that fails is reported as "not checked", never thrown', async () => {
  const broken = { query: async () => { throw new Error('boom'); } };
  assert.deepEqual(await findMissingDrivers(broken, { driverCodes: [1], routeCodes: ['X'] }), { checked: false });
});

test('missing drivers: enabled drivers of the cities in the file whose code is not in the file', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const tag = randomUUID().slice(0, 8);
    const cityA = await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, 'TMA', 'WEEKLY') RETURNING id", [`Test Missing A ${tag}`]);
    const cityB = await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, 'TMB', 'WEEKLY') RETURNING id", [`Test Missing B ${tag}`]);
    const cityC = await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, 'TMC', 'WEEKLY') RETURNING id", [`Test Missing C ${tag}`]);
    const route = async (job, code) => one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3) RETURNING id`, [`R ${code}`, job, code]);
    const rA = `TMA-${tag}`; const rB = `TMB-${tag}`; const rC = `TMC-${tag}`;
    await route(`Test Missing A ${tag}`, rA); await route(`Test Missing B ${tag}`, rB); await route(`Test Missing C ${tag}`, rC);
    let n = 0;
    const driver = (name, code, city, enabled = true) => one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, $5) RETURNING id",
      [name, `m${n += 1}${tag}@example.test`, code, city, enabled]);
    const inFile = await driver('In File A', 7700001, cityA.id);
    const missingA = await driver('Missing A', 7700002, cityA.id);
    await driver('Disabled A', 7700003, cityA.id, false);
    const missingB = await driver('Missing B', 7700004, cityB.id);
    await driver('Missing C not in file cities', 7700005, cityC.id);
    void inFile;

    await t.test('lists only enabled drivers of the cities named by the file routes, not those in the file, ordered by city then name', async () => {
      const out = await findMissingDrivers(db, { driverCodes: [7700001, 123, 123], routeCodes: [rA, rB] });
      assert.equal(out.checked, true);
      assert.deepEqual(out.cities, [`Test Missing A ${tag}`, `Test Missing B ${tag}`]);
      assert.deepEqual(out.drivers.map((d) => [d.driverId, d.name, d.driverCode, d.city]), [
        [missingA.id, 'Missing A', 7700002, `Test Missing A ${tag}`],
        [missingB.id, 'Missing B', 7700004, `Test Missing B ${tag}`],
      ]);
      assert.deepEqual([out.total, out.shown], [2, 2]);
    });

    await t.test('a file for one city never lists another city; an empty or unknown file lists nobody', async () => {
      const onlyB = await findMissingDrivers(db, { driverCodes: [], routeCodes: [rB] });
      assert.deepEqual(onlyB.drivers.map((d) => d.driverId), [missingB.id]);
      assert.deepEqual(await findMissingDrivers(db, { driverCodes: [1], routeCodes: ['NO-SUCH-ROUTE'] }), { checked: true, cities: [], total: 0, shown: 0, drivers: [] });
      assert.deepEqual(await findMissingDrivers(db, { driverCodes: [1], routeCodes: [] }), { checked: true, cities: [], total: 0, shown: 0, drivers: [] });
    });

    await t.test('when everyone is in the file nobody is listed', async () => {
      const out = await findMissingDrivers(db, { driverCodes: [7700001, 7700002], routeCodes: [rA] });
      assert.deepEqual([out.checked, out.total, out.drivers], [true, 0, []]);
    });

    await t.test('a list longer than the limit is cut, and the total says how many there really are', async () => {
      for (let i = 0; i < MISSING_LIST_LIMIT + 5; i += 1) await driver(`Bulk ${String(i).padStart(4, '0')}`, 7800000 + i, cityC.id);
      const out = await findMissingDrivers(db, { driverCodes: [], routeCodes: [rC] });
      assert.deepEqual([out.shown, out.total], [MISSING_LIST_LIMIT, MISSING_LIST_LIMIT + 6]);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
