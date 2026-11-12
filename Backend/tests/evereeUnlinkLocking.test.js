import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unlinkDriver } from '../services/payments/everee/workerStore.js';

// TWO REAL DATABASE CONNECTIONS. Unlink checks for unsettled Everee payments and removes the link in ONE transaction that first waits for a payment batch
// that is still reserving the driver's payments. These tests COMMIT their rows, and the guard on everee_workers forbids deleting them, so they run only on a
// throw-away copy of the database: PAYROLL_TEST_DB=1, PAYROLL_TEST_DB_COMMIT=1 and a DB_NAME that contains "test". Everee is not involved.
const dbName = process.env.DB_NAME ?? '';
const enabled = process.env.PAYROLL_TEST_DB === '1' && process.env.PAYROLL_TEST_DB_COMMIT === '1' && /test|tmp|scratch/i.test(dbName);
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const ENV = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = (promise, ms = 400) => Promise.race([promise.then(() => 'done', () => 'done'), sleep(ms).then(() => 'pending')]);

test('unlink waits for a payment batch that is still reserving the driver, then sees its payment', { skip: !enabled && 'needs PAYROLL_TEST_DB=1, PAYROLL_TEST_DB_COMMIT=1 and a throw-away database whose name contains "test"' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const tag = randomUUID().slice(0, 8);
  const setup = await pool.connect();
  for (const m of ['2026-11-04-issue-031-everee-workers.sql', '2026-11-07-issue-242-everee-driver-onboarding.sql']) await setup.query(migration(m));
  setup.release();
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
  const admin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Race Admin ${tag}`, `race${tag}@example.com`]);
  const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Race City ${tag}`, `RC${tag}`.slice(0, 10)])).id;
  let seq = 0;
  const linkedDriver = async () => {
    seq += 1;
    const id = (await one(
      `INSERT INTO drivers (name, email, password, driver_code, city_id, driver_type, enabled, phone_number)
       VALUES ($1, $2, 'x', $3, $4, 'LOCAL', true, '5551230001') RETURNING id`,
      [`Race Driver ${tag} ${'abcdefghij'[seq]}`, `race${tag}${seq}@example.com`, 9_200_000 + Number.parseInt(tag.slice(0, 4), 16) % 1000 * 10 + seq, city])).id;
    const link = await one("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', '4321', $2, 'matched_email', $3) RETURNING id", [id, `W-${tag}-${seq}`, admin.id]);
    return { id, linkId: Number(link.id) };
  };
  const liveLinks = async (id) => (await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [id])).n;
  // A payment batch holds the driver row in SHARE mode while it reserves the driver's payments, until it commits. The payment item itself needs a long chain of
  // records (pay run, statement, batch), so the result of the "unsettled payments" query is stood in for: it says "unsettled" only once the batch has committed.
  const reservation = { committed: false };
  const view = {
    query: (sql, params) => pool.query(sql, params),
    connect: async () => {
      const client = await pool.connect();
      return { query: (sql, params) => (/AS outstanding/.test(sql) ? Promise.resolve({ rows: [{ outstanding: reservation.committed }] }) : client.query(sql, params)), release: () => client.release() };
    },
  };
  const startBatch = async (driverId) => {
    const batch = await pool.connect();
    await batch.query('BEGIN');
    await batch.query('SELECT id FROM drivers WHERE id = $1 FOR SHARE', [driverId]);
    return { commit: async () => { reservation.committed = true; await batch.query('COMMIT'); batch.release(); } };
  };

  // 1. a batch is mid-reservation: the unlink waits, and once the batch commits it sees the payment and refuses without the acknowledgement
  const a = await linkedDriver();
  const batch = await startBatch(a.id);
  const refused = unlinkDriver(view, admin, { cityId: city, driverId: a.id, linkId: a.linkId, reason: 'moved to the active record' }, { env: ENV });
  assert.equal(await state(refused), 'pending', 'the unlink waits for the batch that is reserving the driver');
  assert.equal(await liveLinks(a.id), 1);
  await batch.commit();
  await assert.rejects(refused, (e) => e.status === 409 && /not settled/.test(e.message));
  assert.equal(await liveLinks(a.id), 1, 'the link is still there');

  // 2. with the admin's acknowledgement the same situation unlinks, after the batch has finished
  reservation.committed = false;
  const b = await linkedDriver();
  const batch2 = await startBatch(b.id);
  const acknowledged = unlinkDriver(view, admin, { cityId: city, driverId: b.id, linkId: b.linkId, reason: 'moved to the active record', acknowledgeOutstanding: true }, { env: ENV });
  assert.equal(await state(acknowledged), 'pending');
  await batch2.commit();
  assert.deepEqual(await acknowledged, { unlinked: true });
  assert.equal(await liveLinks(b.id), 0);

  // 3. nothing is reserving: the unlink does not wait
  reservation.committed = false;
  const c = await linkedDriver();
  assert.deepEqual(await unlinkDriver(view, admin, { cityId: city, driverId: c.id, linkId: c.linkId, reason: 'moved to the active record' }, { env: ENV }), { unlinked: true });
  await pool.end();
  (await import('../config/redis.js')).default.quit().catch(() => {});
});
