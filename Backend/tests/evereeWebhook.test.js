import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { receiveEvent } from '../services/payments/everee/webhookService.js';
import { signPayload } from '../services/payments/everee/webhookSignature.js';
import { EvereeError } from '../services/payments/everee/evereeClient.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything, the
// migrations included, runs in one transaction that is always rolled back. Events are signed here with a made-up key; Everee is a fake.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const KEY = 'whsec_test_key_not_a_real_one';
const NOW = 1_793_500_000;
const ENV = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_WEBHOOK_SIGNING_KEY: KEY };

const signed = (event, { key = KEY, at = NOW, raw } = {}) => {
  const rawBody = Buffer.from(raw ?? JSON.stringify(event));
  return { rawBody, headers: { 'x-everee-webhook-timestamp': String(at), 'x-everee-webhook-signature': `v1=${signPayload(key, at, rawBody)}` } };
};
const event = (o = {}) => ({ version: '1', id: 'evt-1', companyId: 4321, type: 'worker.onboarding-completed', timestamp: NOW, data: { object: { workerId: 'W-1', externalWorkerId: 'nasa-sandbox-driver-1' } }, ...o });

test('everee webhook: signature, company, once per event ID, worker events, retries', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    await db.query(migration('2026-11-04-issue-031-everee-workers.sql'));
    await db.query(migration('2026-11-04-issue-031-everee-webhook-events.sql'));
    const driver = (await one('SELECT id FROM drivers ORDER BY id LIMIT 1')).id;
    const admin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id", [`Test Admin ${Math.random()}`, `h${Math.random()}@example.com`]);
    await one(
      `INSERT INTO everee_workers (driver_id, environment, everee_worker_id, external_worker_id, link_source, onboarding_complete, tin_status, linked_by)
       VALUES ($1, 'sandbox', 'W-1', 'nasa-sandbox-driver-1', 'created_sandbox', false, 'NEEDS_VERIFICATION', $2) RETURNING id`, [driver, admin.id]);

    const evereeState = { workers: {}, calls: [], failWith: null };
    const client = {
      getWorker: async (id) => {
        evereeState.calls.push(id);
        if (evereeState.failWith) throw evereeState.failWith;
        return { data: evereeState.workers[id] ?? { id, onboardingComplete: true, tinVerificationStatus: 'VERIFIED' }, requestId: 'req' };
      },
    };
    const send = (e, opts = {}, env = ENV) => receiveEvent(db, signed(e, opts), { env, client, nowSeconds: NOW });
    const link = async () => one('SELECT onboarding_complete, tin_status, terminated FROM everee_workers WHERE driver_id = $1', [driver]);
    const stored = async (id) => one('SELECT event_type, attempts, processed_at IS NOT NULL AS done, outcome, data FROM everee_webhook_events WHERE event_id = $1', [id]);
    const eventCount = async () => (await one('SELECT count(*)::int n FROM everee_webhook_events')).n;
    const base = await eventCount();

    await t.test('without the signing key or Everee settings nothing is processed (503)', async () => {
      const { EVEREE_WEBHOOK_SIGNING_KEY, ...noKey } = ENV;
      assert.equal((await send(event(), {}, noKey)).status, 503);
      assert.equal((await send(event(), {}, {})).status, 503);
      assert.equal(await eventCount(), base);
    });

    await t.test('a wrong key, a tampered body, no signature or an old timestamp is refused (401) and nothing is stored or read', async () => {
      assert.equal((await send(event(), { key: 'another key' })).status, 401);
      const good = signed(event());
      const tampered = { rawBody: Buffer.from(good.rawBody.toString().replace('W-1', 'W-2')), headers: good.headers };
      assert.equal((await receiveEvent(db, tampered, { env: ENV, client, nowSeconds: NOW })).status, 401);
      assert.equal((await receiveEvent(db, { rawBody: good.rawBody, headers: {} }, { env: ENV, client, nowSeconds: NOW })).status, 401);
      assert.equal((await send(event(), { at: NOW - 600 })).status, 401);
      assert.equal(await eventCount(), base);
      assert.deepEqual(evereeState.calls, []);
    });

    await t.test('a signed event that is not an Everee event is 400; one for another company is 403; neither is stored', async () => {
      assert.equal((await send(null, { raw: 'not json' })).status, 400);
      assert.equal((await send(null, { raw: '[1,2]' })).status, 400);
      assert.equal((await send(event({ id: '' }))).status, 400);
      assert.equal((await send(event({ type: 'Bad Type!' }))).status, 400);
      assert.equal((await send(event({ companyId: '4321' }))).status, 400, 'the company ID must be a number');
      const other = await send(event({ id: 'evt-other', companyId: 9999 }));
      assert.equal(other.status, 403);
      assert.equal(await eventCount(), base);
    });

    await t.test('worker.onboarding-completed re-reads the worker from Everee and updates the link; the event is stored once as processed', async () => {
      assert.deepEqual(await link(), { onboarding_complete: false, tin_status: 'NEEDS_VERIFICATION', terminated: false });
      const result = await send(event());
      assert.deepEqual([result.status, result.body.outcome], [200, 'applied']);
      assert.deepEqual(evereeState.calls, ['nasa-sandbox-driver-1']);
      assert.deepEqual(await link(), { onboarding_complete: true, tin_status: 'VERIFIED', terminated: false });
      const row = await stored('evt-1');
      assert.deepEqual([row.event_type, row.attempts, row.done, row.outcome], ['worker.onboarding-completed', 1, true, 'applied']);
    });

    await t.test('the same event delivered again is answered but not processed again', async () => {
      evereeState.calls.length = 0;
      evereeState.workers['nasa-sandbox-driver-1'] = { id: 'x', onboardingComplete: false };
      const again = await send(event());
      assert.deepEqual([again.status, again.body.duplicate], [200, true]);
      assert.deepEqual(evereeState.calls, [], 'Everee was not asked again');
      assert.equal((await link()).onboarding_complete, true, 'nothing changed');
      assert.equal((await stored('evt-1')).attempts, 2);
      delete evereeState.workers['nasa-sandbox-driver-1'];
    });

    await t.test('what the event says is not trusted: the worker is read from Everee (a claim of "terminated" in the event changes nothing by itself)', async () => {
      const result = await send(event({ id: 'evt-claim', type: 'worker.profile-updated', data: { object: { workerId: 'W-1', terminated: true, terminationDate: '2026-01-01' } } }));
      assert.equal(result.body.outcome, 'applied');
      assert.equal((await link()).terminated, false);
    });

    await t.test('worker.terminated shows when Everee says the worker left; worker.deleted or a worker Everee no longer finds ends it too', async () => {
      evereeState.workers['nasa-sandbox-driver-1'] = { id: 'x', onboardingComplete: true, terminationDate: '2026-11-01' };
      assert.equal((await send(event({ id: 'evt-left', type: 'worker.terminated' }))).body.outcome, 'applied');
      assert.equal((await link()).terminated, true);
      await db.query('UPDATE everee_workers SET terminated = false WHERE driver_id = $1', [driver]);
      delete evereeState.workers['nasa-sandbox-driver-1'];
      evereeState.failWith = new EvereeError('Everee did not find what was asked for', { status: 404, requestId: 'r' });
      assert.equal((await send(event({ id: 'evt-gone', type: 'worker.profile-updated' }))).body.outcome, 'applied_worker_not_found');
      assert.equal((await link()).terminated, true);
      evereeState.failWith = null;
      await db.query('UPDATE everee_workers SET terminated = false WHERE driver_id = $1', [driver]);
      evereeState.calls.length = 0;
      assert.equal((await send(event({ id: 'evt-del', type: 'worker.deleted' }))).body.outcome, 'applied');
      assert.deepEqual(evereeState.calls, [], 'a deleted worker is not looked up');
      assert.equal((await link()).terminated, true);
      await db.query('UPDATE everee_workers SET terminated = false WHERE driver_id = $1', [driver]);
    });

    await t.test('a worker that is not linked to a driver is stored and ignored', async () => {
      evereeState.calls.length = 0;
      const result = await send(event({ id: 'evt-stranger', data: { object: { workerId: 'W-UNKNOWN', externalWorkerId: 'someone-elses' } } }));
      assert.deepEqual([result.status, result.body.outcome], [200, 'no_link']);
      assert.deepEqual(evereeState.calls, []);
      assert.equal((await send(event({ id: 'evt-noid', data: { object: {} } }))).body.outcome, 'no_worker_id');
    });

    await t.test('if Everee cannot be reached the answer is 500 so Everee delivers it again, and the next delivery is processed (not called a duplicate)', async () => {
      evereeState.failWith = new EvereeError('Everee could not be reached');
      await db.query('UPDATE everee_workers SET onboarding_complete = false WHERE driver_id = $1', [driver]);
      const failed = await send(event({ id: 'evt-retry', type: 'worker.profile-updated' }));
      assert.equal(failed.status, 500);
      let row = await stored('evt-retry');
      assert.deepEqual([row.done, row.outcome, row.attempts], [false, null, 1]);
      evereeState.failWith = null;
      const retried = await send(event({ id: 'evt-retry', type: 'worker.profile-updated' }));
      assert.deepEqual([retried.status, retried.body.outcome, retried.body.duplicate], [200, 'applied', undefined]);
      row = await stored('evt-retry');
      assert.deepEqual([row.done, row.attempts], [true, 2]);
      assert.equal((await link()).onboarding_complete, true);
    });

    await t.test('payment events and the rest are stored, with ids and statuses only (no amounts, names, emails or bank details)', async () => {
      const payment = event({
        id: 'evt-paid', type: 'payment-payables.status-changed',
        data: { object: { paymentStatus: 'PAID', paymentErrorMessage: null, payableExternalIds: ['nasa-stmt-1', 'nasa-stmt-2'], workerId: 'W-1', email: 'x@example.com', netAmount: { amount: '99.00' }, bankName: 'Some Bank' } },
      });
      assert.deepEqual((await send(payment)).body, { received: true, outcome: 'stored' });
      const row = await stored('evt-paid');
      assert.deepEqual(row.data, { workerId: 'W-1', paymentStatus: 'PAID', payableExternalIds: ['nasa-stmt-1', 'nasa-stmt-2'] });
      const paid = event({ id: 'evt-paid2', type: 'payment.paid', data: { object: { paymentId: 77, grossAmount: { amount: '5' }, payables: [{ externalId: 'nasa-stmt-9', amount: { amount: '5' } }] } } });
      assert.equal((await send(paid)).body.outcome, 'stored');
      assert.deepEqual((await stored('evt-paid2')).data, { paymentId: '77', payableExternalIds: ['nasa-stmt-9'] });
      assert.equal((await send(event({ id: 'evt-unknown', type: 'report.completed' }))).body.outcome, 'stored');
      assert.equal((await send(event({ id: 'evt-test', type: 'test-event.created', data: { object: { testMessage: 'This is a test message' } } }))).body.outcome, 'test_ok');
      assert.equal((await send(event({ id: 'evt-v2', version: '2' }))).body.outcome, 'unsupported_version');
    });

    await t.test('the database never deletes an event or rewrites what it said; a sandbox event is not a production event', async () => {
      await db.query('SAVEPOINT s');
      await assert.rejects(db.query('DELETE FROM everee_webhook_events'), /cannot be deleted/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      await db.query('SAVEPOINT s');
      await assert.rejects(db.query("UPDATE everee_webhook_events SET event_type = 'x'"), /only the result of processing/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      const production = { ...ENV, EVEREE_ENVIRONMENT: 'production', EVEREE_API_TOKEN: 'tsk_prod_ABCDEF123456' };
      assert.equal((await send(event(), {}, production)).body.duplicate, undefined, 'the same event ID in production is a new event');
      assert.equal((await one("SELECT count(*)::int n FROM everee_webhook_events WHERE event_id = 'evt-1'")).n, 2);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
