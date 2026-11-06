import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lockDriver } from '../services/payments/everee/driverLock.js';
import { OnboardingRequiredError, withWorkGate } from '../services/payments/everee/onboardingGate.js';
import { unlinkDriver } from '../services/payments/everee/workerStore.js';
import { insertJourney, addRangeOfSqeunceToDeliveries } from '../services/driver/journeyQueries.js';
import { availabilityService } from '../services/driver/availabilityQuery.js';
import { setDriverTypes } from '../services/admin/driverType.js';

// TWO REAL DATABASE CONNECTIONS (issue #242, review of #244): the onboarding check and the work write must be one transaction, so a concurrent
// revocation, unlink or reclassification is either completely before the work (which is then refused) or waits until the work has committed.
// These tests COMMIT rows, so they run only on a throw-away copy of the database (see evereeDriverLock.test.js for the three switches).
const dbName = process.env.DB_NAME ?? '';
const enabled = process.env.PAYROLL_TEST_DB === '1' && process.env.PAYROLL_TEST_DB_COMMIT === '1' && /test|tmp|scratch/i.test(dbName);
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const GATED = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_DRIVER_ONBOARDING_ENABLED: 'true', EVEREE_ONBOARDING_ENFORCED: 'true' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = (promise, ms = 400) => Promise.race([promise.then(() => 'done', () => 'done'), sleep(ms).then(() => 'pending')]);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('the work gate: the check and the write are one transaction', { skip: !enabled && 'needs PAYROLL_TEST_DB=1, PAYROLL_TEST_DB_COMMIT=1 and a throw-away database whose name contains "test"' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const tag = randomUUID().slice(0, 8);
  const boot = await pool.connect();
  await boot.query(migration('2026-11-04-issue-031-everee-workers.sql'));
  await boot.query(migration('2026-11-07-issue-242-everee-driver-onboarding.sql'));
  boot.release();
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const admin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Gate Admin ${tag}`, `gate${tag}@example.com`]);
  const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [`Gate City ${tag}`, `GT${tag}`.slice(0, 10)])).id;
  const route = (await one("INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 2, 1, 1, 1, $3) RETURNING id", [`Gate Route ${tag}`, `Gate City ${tag}`, `GT${tag}`])).id;
  const today = (await one("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d")).d;
  let seq = 0;
  const driver = async ({ verified }) => {
    seq += 1;
    const id = (await one(
      `INSERT INTO drivers (name, email, password, driver_code, city_id, driver_type, enabled, agreement_signed) VALUES ($1, $2, 'x', $3, $4, 'LOCAL', true, true) RETURNING id`,
      [`Gate Driver${'abcdefghij'[seq]} ${tag.replace(/[0-9]/g, (d) => 'ghijklmnop'[d])}`, `gate${tag}${seq}@example.com`, 9_300_000 + (Number.parseInt(tag.slice(0, 4), 16) % 1000) * 10 + seq, city],
    )).id;
    if (verified) await pool.query("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, onboarding_complete, linked_by) VALUES ($1, 'sandbox', '4321', $2, 'matched_email', true, $3)", [id, `W${id}`, admin.id]);
    return id;
  };
  const journeys = async (id) => (await one('SELECT count(*)::int AS n FROM dashboard_data WHERE driver_id = $1', [id])).n;
  const hold = async (id) => { const c = await pool.connect(); await c.query('BEGIN'); await lockDriver(c, id); return { c, release: async () => { await c.query('COMMIT'); c.release(); } }; };
  let start = 100 * (Number.parseInt(tag.slice(0, 3), 16) % 5000);
  const write = (id) => async (db) => {
    start += 10;
    const journey = await insertJourney({ driver_id: id, route_id: route, packages: 10, start_seq: start, end_seq: start + 9, journey_date: today }, db);
    assert.notEqual(journey.success, false, JSON.stringify(journey));
    await addRangeOfSqeunceToDeliveries(id, route, start, start + 9, journey.id, db);
    return journey;
  };

  await t.test('a verified driver’s work is written, together with its deliveries', async () => {
    const d = await driver({ verified: true });
    const journey = await withWorkGate(pool, d, write(d), { env: GATED });
    assert.equal(await journeys(d), 1);
    assert.equal((await one('SELECT count(*)::int AS n FROM deliveries WHERE dashboard_data_id = $1', [journey.id])).n, 10);
  });

  await t.test('a driver without a verified link is refused and nothing is written, not even half of it', async () => {
    const d = await driver({ verified: false });
    await assert.rejects(withWorkGate(pool, d, write(d), { env: GATED }), OnboardingRequiredError);
    assert.equal(await journeys(d), 0);
  });

  await t.test('an unlink that commits first refuses the work, even though the driver looked verified a moment ago', async () => {
    const d = await driver({ verified: true });
    const admins = await hold(d); // an administrator's transaction is revoking the link
    await admins.c.query("UPDATE everee_workers SET unlinked_by = $2, unlinked_at = now(), unlink_reason = 'revoked' WHERE driver_id = $1 AND unlinked_at IS NULL", [d, admin.id]);
    let wrote = false;
    const attempt = withWorkGate(pool, d, async (db) => { wrote = true; return write(d)(db); }, { env: GATED });
    assert.equal(await state(attempt), 'pending', 'the work waits for the administrator’s transaction');
    await admins.release();
    await assert.rejects(attempt, OnboardingRequiredError);
    assert.deepEqual([wrote, await journeys(d)], [false, 0], 'the work was never started');
  });

  await t.test('an unlink that arrives while the work is being written waits until the work has committed', async () => {
    const d = await driver({ verified: true });
    const midWrite = deferred();
    const finish = deferred();
    const work = withWorkGate(pool, d, async (db) => { const journey = await write(d)(db); midWrite.resolve(); await finish.promise; return journey; }, { env: GATED });
    await midWrite.promise;
    const unlink = unlinkDriver(pool, admin, { cityId: city, driverId: d, reason: 'two connection test' }, { env: GATED });
    assert.equal(await state(unlink), 'pending', 'the unlink waits for the work’s transaction');
    assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [d])).n, 1);
    finish.resolve();
    await work;
    await unlink;
    assert.equal(await journeys(d), 1, 'the work that was allowed stays');
    assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [d])).n, 0, 'and the unlink then applies');
  });

  await t.test('a reclassification waits for the work’s transaction too', async () => {
    const d = await driver({ verified: true });
    const midWrite = deferred();
    const finish = deferred();
    const work = withWorkGate(pool, d, async (db) => { const journey = await write(d)(db); midWrite.resolve(); await finish.promise; return journey; }, { env: GATED });
    await midWrite.promise;
    const change = setDriverTypes(admin, [d], 'DESI', pool);
    assert.equal(await state(change), 'pending');
    finish.resolve();
    await work;
    assert.deepEqual(await change, { updated: 1, unchanged: 0 });
    assert.equal(await journeys(d), 1);
  });

  await t.test('turning availability on is part of the same transaction; a held driver’s row is not changed', async () => {
    const on = { monday: true, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false };
    const held = await driver({ verified: false });
    await assert.rejects(withWorkGate(pool, held, (db) => availabilityService.updateDriverAvailability(held, on, db), { env: GATED }), OnboardingRequiredError);
    assert.equal((await one('SELECT monday FROM drivers WHERE id = $1', [held])).monday === true, false);
    const ok = await driver({ verified: true });
    const result = await withWorkGate(pool, ok, (db) => availabilityService.updateDriverAvailability(ok, on, db), { env: GATED });
    assert.equal(result.availability.monday, true);
  });

  await t.test('with the gate off the work runs on the pool exactly as before (no transaction, no lock)', async () => {
    const d = await driver({ verified: false });
    let given = null;
    const journey = await withWorkGate(pool, d, async (db) => { given = db; return write(d)(db); }, { env: {} });
    assert.equal(given, pool);
    assert.ok(journey.id);
    assert.equal(await journeys(d), 1);
  });

  await t.test('classification stays locked before the first work mutation, including a driver who needs no onboarding', async () => {
    const d = await driver({ verified: false });
    await pool.query("UPDATE drivers SET driver_type = 'DESI' WHERE id = $1", [d]);
    const checked = deferred();
    const proceed = deferred();
    const work = withWorkGate(pool, d, async (db) => {
      checked.resolve();
      await proceed.promise;
      return write(d)(db);
    }, { env: GATED });
    await checked.promise;
    const change = setDriverTypes(admin, [d], 'LOCAL', pool);
    const beforeWrite = await state(change);
    // Release the writer before asserting, so a failed assertion cannot strand either transaction.
    proceed.resolve();
    await work;
    await change;
    assert.equal(beforeWrite, 'pending', 'classification must wait even before a journey FK or availability write locks the row');
    assert.equal(await journeys(d), 1);
    await assert.rejects(withWorkGate(pool, d, write(d), { env: GATED }), OnboardingRequiredError);
    assert.equal(await journeys(d), 1, 'subsequent work is held under the new classification');
  });

  await pool.end();
});
