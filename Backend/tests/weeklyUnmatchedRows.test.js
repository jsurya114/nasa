import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { findUnmatchedRows, reasonOf, REASONS, UNMATCHED_LIST_LIMIT } from '../services/admin/weeklyUnmatchedRows.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything runs in one transaction that is
// always rolled back. Synthetic cities, routes, drivers and codes only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';

test('the limit is a sane number', () => assert.ok(UNMATCHED_LIST_LIMIT >= 50 && UNMATCHED_LIST_LIMIT <= 1000));

test('a database that fails is reported as "not checked", never thrown', async () => {
  const broken = { query: async () => { throw new Error('boom'); } };
  assert.deepEqual(await findUnmatchedRows(broken, [], { read: 0, unreadable: 0 }), { checked: false });
});

test('the reasons are checked in order: driver first, then route, then city, then the Dashboard', () => {
  const ok = { driver_known: true, driver_enabled: true, route_known: true, route_enabled: true, has_city: true, already: false };
  assert.equal(reasonOf(ok), REASONS.TO_ADD);
  assert.equal(reasonOf({ ...ok, already: true }), REASONS.ALREADY_ON_DASHBOARD);
  assert.equal(reasonOf({ ...ok, has_city: false }), REASONS.ROUTE_WITHOUT_CITY);
  assert.equal(reasonOf({ ...ok, route_enabled: false }), REASONS.ROUTE_DISABLED);
  assert.equal(reasonOf({ ...ok, route_known: false, route_enabled: false }), REASONS.ROUTE_NOT_IN_APP);
  assert.equal(reasonOf({ ...ok, driver_enabled: false, route_known: false }), REASONS.DRIVER_DISABLED);
  assert.equal(reasonOf({ ...ok, driver_known: false, driver_enabled: false, route_known: false }), REASONS.DRIVER_NOT_IN_APP);
});

test('unmatched weekly lines: every file row counted once, with the reason and an estimate from route prices', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const tag = randomUUID().slice(0, 8);
    const job = `Test Unmatched ${tag}`;
    const city = await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, 'TUM', 'WEEKLY') RETURNING id", [job]);
    const route = (code, enabled = true) => one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string, enabled)
      VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3, $4) RETURNING id`, [`R ${code}`, job, code, enabled]);
    const rA = `TUM-A-${tag}`; const rD = `TUM-D-${tag}`; const rNone = `TUM-NONE-${tag}`;
    const routeA = await route(rA);
    await route(rD, false);
    let n = 0;
    const driver = (code, enabled = true) => one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, $5) RETURNING id",
      [`Unmatched ${code}`, `u${n += 1}${tag}@example.test`, code, city.id, enabled]);
    const ok = await driver(7710001);
    await driver(7710002, false);
    await db.query('INSERT INTO dashboard_data (driver_id, journey_date, route_id) VALUES ($1, $2, $3)', [ok.id, '2026-11-03', routeA.id]);

    const line = (driver_id, del_route, del_date, total_deliveries, fs, ds) => ({ driver_id, del_route, del_date, total_deliveries, fs, ds });
    const entries = [
      line(7710001, rA, '2026-11-02', 5, 3, 2), // goes to the Dashboard
      line(7710001, rA, '2026-11-03', 1, 1, 0), // already there
      line(9999991, rA, '2026-11-02', 4, 4, 0), // Delivery ID not in the app: 4 x 1.60 = 6.40
      line(9999991, rA, '2026-11-04', 2, 1, 1), // the same ID another day: 1.60 + 0.25 = 1.85
      line(7710002, rA, '2026-11-02', 3, 3, 0), // a disabled driver: 4.80
      line(7710001, rNone, '2026-11-02', 7, 7, 0), // route not in the app
      line(7710001, rD, '2026-11-02', 1, 1, 0), // a disabled route
      line(9999992, rNone, '2026-11-02', 2, 2, 0), // unknown ID and unknown route: counted under the ID, with no price
    ];
    const out = await findUnmatchedRows(db, entries, { read: 25, unreadable: 3 });

    assert.equal(out.checked, true);
    assert.deepEqual(out.rows, {
      inFile: 28, unreadable: 3, counted: 28,
      to_add: 5, already_on_dashboard: 1, driver_not_in_app: 8, driver_disabled: 3, route_not_in_app: 7, route_disabled: 1, route_without_city: 0,
    });
    assert.deepEqual(out.drivers.list, [
      { deliveryId: 7710002, reason: 'driver_disabled', routes: [rA], days: ['2026-11-02'], packages: 3, fs: 3, ds: 0, estimate: '4.80', unpricedPackages: 0 },
      { deliveryId: 9999991, reason: 'driver_not_in_app', routes: [rA], days: ['2026-11-02', '2026-11-04'], packages: 6, fs: 5, ds: 1, estimate: '8.25', unpricedPackages: 0 },
      { deliveryId: 9999992, reason: 'driver_not_in_app', routes: [rNone], days: ['2026-11-02'], packages: 2, fs: 2, ds: 0, estimate: null, unpricedPackages: 2 },
    ]);
    assert.deepEqual(out.routes.list.map((r) => [r.route, r.reason, r.deliveryIds, r.packages, r.estimate]), [
      [rNone, 'route_not_in_app', 1, 7, null],
      [rD, 'route_disabled', 1, 1, null],
    ]);
    assert.deepEqual([out.drivers.total, out.routes.total], [3, 2]);

    const none = await findUnmatchedRows(db, [], { read: 0, unreadable: 0 });
    assert.deepEqual([none.rows.counted, none.drivers.total, none.routes.total], [0, 0, 0]);
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
