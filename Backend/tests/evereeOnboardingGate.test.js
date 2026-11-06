import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertMayBePaid, assertMayWork, blockedDriverIds, enforcement, ONBOARDING_REQUIRED, OnboardingRequiredError, turnsWorkOn } from '../services/payments/everee/onboardingGate.js';

// The hard gate of Everee onboarding (issue #242, PR B): a Local driver without verified onboarding cannot work and cannot be paid by any method.
// The first tests need no database. The later ones need a disposable PostgreSQL copy (PAYROLL_TEST_DB=1), run in a transaction that is rolled back.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const GATED = { ...SANDBOX, EVEREE_DRIVER_ONBOARDING_ENABLED: 'true', EVEREE_ONBOARDING_ENFORCED: 'true' };

test('the gate is enforced only when both switches are exactly "true"', () => {
  assert.equal(enforcement(SANDBOX).enforced, false);
  assert.equal(enforcement({ ...SANDBOX, EVEREE_DRIVER_ONBOARDING_ENABLED: 'true' }).enforced, false, 'onboarding on but not enforced');
  assert.equal(enforcement({ ...SANDBOX, EVEREE_ONBOARDING_ENFORCED: 'true' }).enforced, false, 'enforced without onboarding');
  assert.equal(enforcement({ ...GATED, EVEREE_ONBOARDING_ENFORCED: 'yes' }).enforced, false);
  assert.equal(enforcement(GATED).enforced, true);
});

test('with the gate off nothing is queried, so the app works as before and on a database without the migration', async () => {
  const db = { query: async () => { throw new Error('the database must not be used'); } };
  assert.deepEqual([...await blockedDriverIds(db, [1, 2, 3], { env: SANDBOX })], []);
  await assertMayWork(db, 1, { env: SANDBOX });
  await assertMayBePaid(db, [1, 2], { env: SANDBOX });
  assert.deepEqual([...await blockedDriverIds(db, [], { env: GATED })], [], 'no drivers, no query');
});

test('turning a day ON allows work; turning days off or leaving them as they are does not', () => {
  const all = (v) => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, v]));
  assert.equal(turnsWorkOn({ ...all(false), monday: true }, { availability: all(false) }), true);
  assert.equal(turnsWorkOn(all(true), { availability: { ...all(true), friday: false } }), true);
  assert.equal(turnsWorkOn(all(true), { availability: all(true) }), false, 'unchanged');
  assert.equal(turnsWorkOn(all(false), { availability: all(true) }), false, 'turning off');
  assert.equal(turnsWorkOn({ ...all(false), monday: true }, all(false)), true, 'a plain current object works too');
});

test('every work and payment path runs its check and its write together, the check first', () => {
  const before = (file, gate, write, from = '') => {
    const whole = source(file);
    const text = from ? whole.slice(whole.indexOf(from)) : whole;
    assert.ok(from === '' || whole.includes(from), `${file} must contain ${from}`);
    const g = text.indexOf(gate);
    const w = text.indexOf(write);
    assert.ok(g > -1, `${file} must call ${gate}`);
    assert.ok(w > -1 && g < w, `${file}: ${gate} must come before ${write}`);
  };
  // Work: the writes are the arguments of withWorkGate (one transaction with the check), never a separate call after a separate check.
  before('controllers/driver/journeyController.js', 'withWorkGate(', 'await insertJourney(');
  before('controllers/driver/journeyController.js', 'withWorkGate(', 'await addRangeOfSqeunceToDeliveries(');
  before('controllers/admin/adminJourneyController.js', 'withWorkGate(pool, driver_id', 'AdminJourneyQuery.addJourney(', 'addJourney: async');
  before('controllers/admin/adminJourneyController.js', 'withWorkGate(pool, driver_id', 'AdminJourneyQuery.updateJourneyById(', 'updateJourney: async');
  before('controllers/driver/driveravailabilityController.js', 'withWorkGate(', 'availabilityService.updateDriverAvailability(driverId, availability, db)');
  before('controllers/admin/adminavailabilityController.js', 'withWorkGate(', 'availabilityService.updateDriverAvailabilityByAdmin(id, availability, adminId, adminRole, db)');
  for (const file of ['controllers/driver/journeyController.js', 'controllers/admin/adminJourneyController.js', 'controllers/driver/driveravailabilityController.js', 'controllers/admin/adminavailabilityController.js']) {
    assert.doesNotMatch(source(file), /assertMayWork\(/, `${file} must not check on one connection and write on another`);
  }
  before('services/payroll/payRuns/paymentRecords.js', 'blockedDriverIds(', 'INSERT INTO pay_run_payment_records');
  before('services/payments/everee/batchSubmit.js', 'blockedDriverIds(tx, typed', 'INSERT INTO everee_payment_items');
  assert.match(source('services/payroll/payRuns/payBatchReview.js'), /blockedDriverIds\(db, driverIds\)/);
});

test('deleting a journey and importing delivery evidence are not gated; the legacy paid flag stays refused outright', () => {
  assert.doesNotMatch(source('controllers/admin/adminJourneyController.js').split('deleteJourney')[1] ?? '', /assertMayWork/);
  for (const file of ['controllers/admin/weeklyUploadsController.js', 'controllers/admin/fileUploadsController.js']) {
    assert.doesNotMatch(source(file), /onboardingGate/, `${file} (imported evidence) must not be gated`);
  }
  assert.match(source('controllers/admin/dashboardController.js'), /export const payDriver = \(_req, res\) => res\.status\(HttpStatus\.CONFLICT\)/);
});

test('the stable reason', () => {
  assert.equal(ONBOARDING_REQUIRED.code, 'onboarding_required');
  const error = new OnboardingRequiredError([5]);
  assert.deepEqual([error.status, error.code, error.driverIds], [409, 'onboarding_required', [5]]);
});

test('who is held: only Local drivers without a verified, complete link of this tenant', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  let sp = 0;
  const savepoint = async (fn) => { const name = `g${sp++}`; await db.query(`SAVEPOINT ${name}`); try { return await fn(); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); } };
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-04-issue-031-everee-workers.sql', import.meta.url)), 'utf8'));
    await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-07-issue-242-everee-driver-onboarding.sql', import.meta.url)), 'utf8'));
    const admin = (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id;
    const [complete, incomplete, legacy, otherTenant, unlinked, none, desi, untyped] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 8')).rows.map((r) => r.id);
    await db.query("UPDATE drivers SET driver_type = 'LOCAL' WHERE id = ANY($1::int[])", [[complete, incomplete, legacy, otherTenant, unlinked, none]]);
    await db.query("UPDATE drivers SET driver_type = 'DESI' WHERE id = $1", [desi]);
    await db.query('UPDATE drivers SET driver_type = NULL WHERE id = $1', [untyped]);
    const link = (driver, { done, tenant, gone } = {}) => db.query(
      `INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, onboarding_complete, linked_by, unlinked_by, unlinked_at, unlink_reason)
       VALUES ($1, 'sandbox', $2, $3, 'matched_email', $4, $5, $6, $7, $8)`,
      [driver, tenant === undefined ? '4321' : tenant, `W${driver}`, done ?? true, admin, gone ? admin : null, gone ? new Date() : null, gone ? 'test' : null]);
    await link(complete);
    await link(incomplete, { done: false });
    await link(legacy, { tenant: null });
    await link(otherTenant, { tenant: '9999' });
    await link(unlinked, { gone: true });
    const all = [complete, incomplete, legacy, otherTenant, unlinked, none, desi, untyped];

    await t.test('the matrix', async () => {
      const held = await blockedDriverIds(db, all, { env: GATED });
      assert.deepEqual([...held].sort((a, b) => a - b), [incomplete, legacy, otherTenant, unlinked, none].sort((a, b) => a - b));
      assert.equal(held.has(desi) || held.has(untyped) || held.has(complete), false, 'Desi, no type and a verified driver are not held');
    });

    await t.test('it fails closed: with the gate on and Everee not set up, every Local driver is held', async () => {
      const held = await blockedDriverIds(db, all, { env: { EVEREE_DRIVER_ONBOARDING_ENABLED: 'true', EVEREE_ONBOARDING_ENFORCED: 'true' } });
      assert.equal(held.has(complete), true);
      assert.equal(held.has(desi) || held.has(untyped), false);
    });

    await t.test('one held driver refuses the whole set, with the stable reason', async () => {
      await assert.rejects(assertMayBePaid(db, [complete, none], { env: GATED }), (e) => e instanceof OnboardingRequiredError && e.code === 'onboarding_required' && e.driverIds.length === 1 && e.driverIds[0] === none);
      await assertMayBePaid(db, [complete, desi, untyped], { env: GATED });
      await assertMayWork(db, complete, { env: GATED });
      await assert.rejects(assertMayWork(db, incomplete, { env: GATED }), OnboardingRequiredError);
    });

    await t.test('changes take effect at once: completing, unlinking and changing the type', async () => {
      await savepoint(async () => {
        await db.query('UPDATE everee_workers SET onboarding_complete = true WHERE driver_id = $1', [incomplete]);
        assert.equal((await blockedDriverIds(db, [incomplete], { env: GATED })).size, 0);
        await db.query("UPDATE everee_workers SET unlinked_by = $2, unlinked_at = now(), unlink_reason = 'test' WHERE driver_id = $1 AND unlinked_at IS NULL", [complete, admin]);
        assert.equal((await blockedDriverIds(db, [complete], { env: GATED })).size, 1);
        await db.query("UPDATE drivers SET driver_type = 'DESI' WHERE id = $1", [none]);
        assert.equal((await blockedDriverIds(db, [none], { env: GATED })).size, 0, 'a Desi driver is not held (and was never entitled to Everee)');
      });
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
