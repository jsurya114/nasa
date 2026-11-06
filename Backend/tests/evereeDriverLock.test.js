import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lockDriver } from '../services/payments/everee/driverLock.js';
import { linkDriver, unlinkDriver, createSandboxWorker } from '../services/payments/everee/workerStore.js';
import { startOnboarding, getStatus } from '../services/payments/everee/driverOnboarding.js';
import { EvereeError } from '../services/payments/everee/evereeClient.js';

// TWO REAL DATABASE CONNECTIONS (issue #242, review of #243). These tests COMMIT their rows (a second connection cannot see an uncommitted one), and the
// guard on everee_workers forbids deleting them, so they run only on a throw-away copy of the database: PAYROLL_TEST_DB=1, PAYROLL_TEST_DB_COMMIT=1 and a
// DB_NAME that contains "test". Everee is replaced by a fake; no call leaves this machine.
const dbName = process.env.DB_NAME ?? '';
const enabled = process.env.PAYROLL_TEST_DB === '1' && process.env.PAYROLL_TEST_DB_COMMIT === '1' && /test|tmp|scratch/i.test(dbName);
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const ENV = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_DRIVER_ONBOARDING_ENABLED: 'true' };
const ADDRESS = { line1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 'pending' if the promise has not settled after a short wait: the writer is waiting for the lock.
const state = (promise, ms = 400) => Promise.race([promise.then(() => 'done', () => 'done'), sleep(ms).then(() => 'pending')]);

test('the per-driver lock is shared by the admin writers and the driver’s onboarding save', { skip: !enabled && 'needs PAYROLL_TEST_DB=1, PAYROLL_TEST_DB_COMMIT=1 and a throw-away database whose name contains "test"' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const tag = randomUUID().slice(0, 8);
  const setup = await pool.connect();
  await setup.query(migration('2026-11-04-issue-031-everee-workers.sql'));
  await setup.query(migration('2026-11-07-issue-242-everee-driver-onboarding.sql'));
  setup.release();
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const admin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Lock Admin ${tag}`, `lock${tag}@example.com`]);
  const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Lock City ${tag}`, `LK${tag}`.slice(0, 10)])).id;
  let seq = 0;
  const driver = async (over = {}) => {
    seq += 1;
    const email = over.email ?? `lock${tag}${seq}@example.com`;
    return (await one(
      `INSERT INTO drivers (name, email, password, driver_code, city_id, driver_type, enabled, phone_number, agreement_signed, agreement_joining_date)
       VALUES ($1, $2, 'x', $3, $4, 'LOCAL', true, $5, true, '2026-10-01') RETURNING id`,
      [`Lock Driver${tag}${seq}`.replace(/[0-9]/g, (d) => 'abcdefghij'[d]) + ' Rider', email, 9_100_000 + Number.parseInt(tag.slice(0, 4), 16) % 1000 * 10 + seq, city, over.phone ?? `5559${String(seq).padStart(6, '0')}`],
    )).id;
  };
  // Holds the driver's lock on its own connection until release() is called, like an administrator's transaction that is still open.
  const holdLock = async (driverId) => {
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await lockDriver(holder, driverId);
    return { client: holder, release: async (commit = true) => { await holder.query(commit ? 'COMMIT' : 'ROLLBACK'); holder.release(); } };
  };
  const liveLinks = async (id) => (await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [id])).n;

  await t.test('an admin unlink waits for the driver’s lock, then applies', async () => {
    const d = await driver();
    await pool.query("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', '4321', $2, 'matched_email', $3)", [d, `W${d}`, admin.id]);
    const lock = await holdLock(d);
    const pending = unlinkDriver(pool, admin, { cityId: city, driverId: d, reason: 'two connection test' }, { env: ENV });
    assert.equal(await state(pending), 'pending', 'the unlink must wait while another transaction holds the driver’s lock');
    assert.equal(await liveLinks(d), 1);
    await lock.release();
    await pending;
    assert.equal(await liveLinks(d), 0);
  });

  await t.test('an admin link waits for the driver’s lock, then applies with the tenant', async () => {
    const d = await driver({ email: `link${tag}@example.com`, phone: '5558880001' });
    const worker = { workerId: `LK-${d}`, externalWorkerId: null, email: `link${tag}@example.com`, phoneNumber: '5558880001' };
    const client = { searchWorkers: async () => ({ data: { items: [worker], totalItems: 1 } }), getWorker: async () => ({ data: { id: worker.workerId, onboardingComplete: false } }) };
    const lock = await holdLock(d);
    const pending = linkDriver(pool, admin, { cityId: city, driverId: d, workerId: worker.workerId }, { client, env: ENV });
    assert.equal(await state(pending), 'pending');
    assert.equal(await liveLinks(d), 0);
    await lock.release();
    await pending;
    assert.equal(await liveLinks(d), 1);
    assert.equal((await one('SELECT tenant_id FROM everee_workers WHERE driver_id = $1', [d])).tenant_id, '4321');
  });

  await t.test('creating a sandbox test worker waits for the driver’s lock too', async () => {
    const d = await driver({ phone: null, email: 'not-an-email' }); // no valid contact: no lookup, the test worker is created
    const created = new Map();
    const client = {
      searchWorkers: async (term) => ({ data: { items: [...created.values()].filter((w) => w.externalWorkerId === term).map((w) => ({ workerId: `SB-${d}`, externalWorkerId: w.externalWorkerId })) } }),
      createContractor: async (body) => { created.set(body.externalWorkerId, body); return { data: { id: body.externalWorkerId, onboardingComplete: true } }; },
      getWorker: async (id) => ({ data: { id, onboardingComplete: true } }),
    };
    const lock = await holdLock(d);
    const pending = createSandboxWorker(pool, admin, { cityId: city, driverId: d }, { client, env: ENV });
    assert.equal(await state(pending), 'pending');
    await lock.release();
    await pending;
    assert.equal(await liveLinks(d), 1);
  });

  await t.test('an administrator’s revocation committed while the driver’s save waits is authoritative: no live link is written', async () => {
    const d = await driver();
    let lock = null;
    let save = null;
    const created = new Map();
    const fake = {
      getWorker: async (id) => { const w = created.get(id); if (!w) throw new EvereeError('not found', { status: 404 }); return { data: { id, externalWorkerId: id, onboardingComplete: false } }; },
      searchWorkers: async (term) => ({ data: { items: [...created.values()].filter((w) => w.externalWorkerId === term).map((w) => ({ workerId: `CAN-${w.externalWorkerId}`, externalWorkerId: w.externalWorkerId })) } }),
      // After Everee has created the worker and before the driver's save, an administrator's transaction takes the lock, writes the revocation and stays open.
      createEmbeddedContractor: async (body) => {
        created.set(body.externalWorkerId, body);
        lock = await holdLock(d);
        await lock.client.query(
          "INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by, unlinked_by, unlinked_at, unlink_reason) VALUES ($1, 'sandbox', '4321', 'ADMIN-REVOKED', 'matched_email', $2, $2, now(), 'revoked by admin')", [d, admin.id]);
        return { data: { id: body.externalWorkerId, onboardingComplete: false } };
      },
    };
    save = startOnboarding(pool, d, { homeAddress: ADDRESS }, { client: fake, env: ENV });
    assert.equal(await state(save, 600), 'pending', 'the save must wait for the administrator’s transaction instead of writing around it');
    assert.equal(await liveLinks(d), 0);
    await lock.release(); // the revocation commits
    const result = await save;
    assert.equal(await liveLinks(d), 0, 'no live link may contradict the administrator’s decision');
    assert.deepEqual([result.state, result.reason], ['needs-review', 'previously_unlinked']);
    assert.equal((await getStatus(pool, d, { env: ENV })).state, 'needs-review');
  });

  await t.test('and when no revocation happens the same save simply links (the lock does not get in the way)', async () => {
    const d = await driver();
    const created = new Map();
    const fake = {
      getWorker: async (id) => { const w = created.get(id); if (!w) throw new EvereeError('not found', { status: 404 }); return { data: { id, externalWorkerId: id, onboardingComplete: false } }; },
      searchWorkers: async (term) => ({ data: { items: [...created.values()].filter((w) => w.externalWorkerId === term).map((w) => ({ workerId: `CAN-${w.externalWorkerId}`, externalWorkerId: w.externalWorkerId })) } }),
      createEmbeddedContractor: async (body) => { created.set(body.externalWorkerId, body); return { data: { id: body.externalWorkerId, onboardingComplete: false } }; },
    };
    assert.equal((await startOnboarding(pool, d, { homeAddress: ADDRESS }, { client: fake, env: ENV })).state, 'in-progress');
    assert.equal(await liveLinks(d), 1);
  });

  await pool.end();
});
