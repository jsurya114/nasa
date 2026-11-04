import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getBatchView, getCitySettings, PreviewChangedError, retryBatch, setCitySettings, submitBatch } from '../services/payments/everee/batchSubmit.js';
import { previewEvereeBatch } from '../services/payments/everee/batchPreview.js';
import { EvereeError } from '../services/payments/everee/evereeClient.js';
import { noonInZone } from '../services/payments/everee/payableRules.js';
import { finalizeRun, generateRun } from '../services/payroll/payRuns/payRunStore.js';
import { recordRunPayment } from '../services/payroll/payRuns/paymentRecords.js';

// Needs a PostgreSQL copy with the app's tables (never production): PAYROLL_TEST_DB=1 and the DB_* variables. One transaction, always rolled back.
// Everything is made up, and Everee is a fake: no request leaves this machine, no money moves.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const ARMED = { ...SANDBOX, EVEREE_PAYMENTS_ENABLED: 'true' };
const PRODUCTION = { EVEREE_API_TOKEN: 'tsk_prod_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_ENVIRONMENT: 'production', EVEREE_PAYMENTS_ENABLED: 'true' };

// A fake Everee. `behaviors` says what happens to a payable by its worker ID: ok, refuse (422), timeout, down, server (500), wrong (another
// payable's ID in the answer), or a function of how many times that payable has been sent.
const makeEveree = (behaviors = {}) => {
  const state = { creates: [], payouts: [], reads: [], payout: 'ok', payableStatus: 'PENDING_APPROVAL', readFails: false };
  const client = {
    createPayable: async (body) => {
      state.creates.push(body);
      const key = body.workerId ?? body.externalWorkerId;
      const sent = state.creates.filter((c) => c.externalId === body.externalId).length;
      const b = behaviors[key] ?? 'ok';
      const kind = typeof b === 'function' ? b(sent) : b;
      if (kind === 'ok') return { status: 201, data: { externalId: body.externalId }, requestId: 'req-ok' };
      if (kind === 'wrong') return { status: 201, data: { externalId: 'nasa-stmt-999999' }, requestId: 'req-wrong' };
      if (kind === 'refuse') throw new EvereeError('Everee answered 422: Validation failed', { status: 422, requestId: 'req-422' });
      if (kind === 'timeout') throw new EvereeError('Everee did not answer in time');
      if (kind === 'down') throw new EvereeError('Everee could not be reached');
      if (kind === 'server') throw new EvereeError('Everee answered 500', { status: 500, requestId: 'req-500' });
      if (kind === 'limit') throw new EvereeError('Everee is limiting requests; try again in a moment', { status: 429, retryAfterSeconds: 1 });
      throw new Error(`unknown behavior ${kind}`);
    },
    getPayable: async (externalId) => {
      state.reads.push(externalId);
      if (state.readFails) throw new EvereeError('Everee could not be reached');
      return { status: 200, data: { externalId, paymentStatus: state.payableStatus }, requestId: 'req-get' };
    },
    requestPayout: async (ids) => {
      state.payouts.push(ids);
      if (state.payout === 'server') throw new EvereeError('Everee answered 500', { status: 500, requestId: 'req-p500' });
      if (state.payout === 'empty') return { status: 200, data: { payableCount: 0 }, requestId: 'req-empty' };
      return { status: 201, data: { id: 5, payableCount: ids.length, payableExternalIds: ids }, requestId: 'req-pay' };
    },
  };
  return { state, client };
};

test('everee submit: reserve, send, payout request, replay, partial failure, retry, and the guards', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT guard');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT guard'); }
  };
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-04-issue-031-everee-payments.sql']) await db.query(migration(m));

    const tag = randomUUID();
    const admin = async (role, n) => one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${n} ${tag}`, `${n}${tag}@example.com`, role]);
    const sup1 = await admin('superadmin', 'one'); // finalizes the runs
    const sup2 = await admin('superadmin', 'two'); // confirms the payments
    const cityAdmin = await admin('admin', 'city');
    const [dA, dB, dC, dD, dE] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 5')).rows.map((r) => r.id);
    const workers = { [dA]: 'EW-A', [dB]: 'EW-B', [dC]: 'EW-C', [dD]: 'EW-D', [dE]: 'EW-E' };
    for (const [driver, worker] of Object.entries(workers)) {
      await db.query(`INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, onboarding_complete, tin_status, linked_by)
        VALUES ($1, 'sandbox', $2, 'created_sandbox', true, 'VERIFIED', $3)`, [driver, worker, sup1.id]);
    }

    let seq = 9900;
    const scenario = async (label, pairs) => {
      const job = `Test Submit ${label}`;
      const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [job, `TS${label}`])).id;
      const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3) RETURNING id`, [`TS ${label}`, job, `TS-${label}`])).id;
      await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, city]);
      for (const [driver, gross] of pairs) {
        const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, '2026-11-02'])).id;
        seq += 10;
        await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 0 WHERE dashboard_data_id = $1', [dd, gross]);
      }
      const run = (await generateRun(db, sup1, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' })).run;
      await finalizeRun(db, sup1, run.id);
      return { run, city, route };
    };
    const hashOf = async (run, env = ARMED) => (await previewEvereeBatch(db, sup2, run.id, { env })).previewHash;
    const sleeps = [];
    const deps = (client, extra = {}) => ({ env: ARMED, client, sleep: async (ms) => { sleeps.push(ms); }, throttleMs: 0, ...extra });
    const submit = async (run, client, { who = sup2, requestId = randomUUID(), previewHash, extra } = {}) =>
      submitBatch(db, who, { runId: run.id, requestId, previewHash: previewHash ?? await hashOf(run) }, deps(client, extra));
    const statement = async (run, driver) => one('SELECT id, payout_status, payout_reference, paid_at FROM pay_statements WHERE pay_run_id = $1 AND driver_id = $2', [run.id, driver]);
    const item = async (run, driver) => one(
      `SELECT i.* FROM everee_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id WHERE s.pay_run_id = $1 AND s.driver_id = $2`, [run.id, driver]);
    const counts = async () => one('SELECT (SELECT count(*) FROM everee_payment_batches)::int b, (SELECT count(*) FROM everee_payment_items)::int i, (SELECT count(*) FROM everee_payment_attempts)::int a')
    const periodEnd = (run) => one("SELECT to_char(period_end, 'YYYY-MM-DD') d FROM pay_runs WHERE id = $1", [run.id]).then((r) => r.d);

    const happy = await scenario('H', [[dA, '100.00'], [dB, '50.00']]);

    await t.test('nothing is sent without the switch, a real super admin who did not finalize, a valid confirmation and an unchanged preview', async () => {
      const fake = makeEveree();
      const hash = await hashOf(happy.run);
      const before = await counts();
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, extra: { env: SANDBOX } }), { status: 409, message: /switched off/ });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, who: cityAdmin }), { status: 403 });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, who: sup1 }), { status: 403, message: /finalized this run/ });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, requestId: 'not-a-uuid' }), { status: 400 });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: 'abc' }), { status: 400 });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: '0'.repeat(64) }), (error) => {
        assert.ok(error instanceof PreviewChangedError);
        assert.equal(error.status, 409);
        assert.equal(error.preview.previewHash, hash, 'the answer carries the new preview');
        return true;
      });
      assert.deepEqual(fake.state.creates, []);
      assert.deepEqual(await counts(), before, 'nothing was reserved or written by any refusal');
      assert.deepEqual([(await statement(happy.run, dA)).payout_status, (await statement(happy.run, dB)).payout_status], ['not_submitted', 'not_submitted']);
    });

    let happyBatch;
    await t.test('a confirmed batch reserves, sends one payable per driver with a stable ID, then ONE payout request, and never says "paid"', async () => {
      const fake = makeEveree();
      happyBatch = await submit(happy.run, fake.client);
      assert.equal(happyBatch.replay, false);
      assert.deepEqual(happyBatch.counts, { submitted: 2, paid: 0, failed: 0, unconfirmed: 0 });
      assert.deepEqual([happyBatch.batch.drivers, happyBatch.batch.total, happyBatch.batch.environment], [2, '150.00', 'sandbox']);

      assert.equal(fake.state.creates.length, 2);
      const a = fake.state.creates.find((c) => c.workerId === 'EW-A');
      const sa = await statement(happy.run, dA);
      assert.deepEqual(a, {
        externalId: `nasa-stmt-${sa.id}`, workerId: 'EW-A', type: 'NASA_PAY_RUN', label: 'NASA pay 2026-11-01 to 2026-11-07',
        amount: { amount: 100, currency: 'USD' }, payableModel: 'PRE_CALCULATED', payCode: 'CONTRACTOR',
        earningTimestamp: noonInZone(await periodEnd(happy.run), 'America/Chicago'),
      });
      assert.ok(!JSON.stringify(fake.state.creates).includes(`Test one ${tag}`), 'no name or email is sent');
      assert.equal(fake.state.payouts.length, 1, 'one payout request for the whole batch');
      assert.deepEqual(fake.state.payouts[0].sort(), fake.state.creates.map((c) => c.externalId).sort(), 'exactly this batch\'s payables');

      for (const driver of [dA, dB]) {
        const s = await statement(happy.run, driver);
        const i = await item(happy.run, driver);
        assert.deepEqual([s.payout_status, s.paid_at, s.payout_reference], ['submitted', null, `nasa-stmt-${s.id}`]);
        assert.deepEqual([i.status, i.attempts, i.external_id, i.payout_requested_at !== null], ['submitted', 1, `nasa-stmt-${s.id}`, true]);
      }
      const attempts = (await db.query('SELECT outcome, http_status, everee_request_id, finished_at IS NOT NULL AS done FROM everee_payment_attempts')).rows;
      assert.deepEqual(attempts.map((r) => [r.outcome, r.http_status, r.everee_request_id, r.done]), [['accepted', 201, 'req-ok', true], ['accepted', 201, 'req-ok', true]]);
      assert.equal(happyBatch.payoutRequests[0].outcome, 'requested');
      // Submitting is not paying: the earning rows are untouched and nothing is "paid".
      assert.equal((await one('SELECT count(*)::int n FROM payment_dashboard WHERE paid')).n, 0);
      assert.equal((await one("SELECT count(*)::int n FROM pay_statements WHERE payout_status = 'paid'")).n, 0);
    });

    await t.test('the same confirmation again returns the same batch and sends nothing; the same ID for something else is refused', async () => {
      const fake = makeEveree();
      const before = await counts();
      const requestId = happyBatch.batch.requestId;
      const hash = (await one('SELECT preview_hash FROM everee_payment_batches WHERE id = $1', [happyBatch.batch.id])).preview_hash;
      const again = await submitBatch(db, sup2, { runId: happy.run.id, requestId, previewHash: hash }, deps(fake.client));
      assert.deepEqual([again.replay, again.batch.id], [true, happyBatch.batch.id]);
      assert.deepEqual(fake.state.creates, []);
      assert.deepEqual(await counts(), before);
      await assert.rejects(submitBatch(db, sup2, { runId: happy.run.id, requestId, previewHash: '1'.repeat(64) }, deps(fake.client)), { status: 409, message: /already used/ });
      const other = await admin('superadmin', 'three');
      await assert.rejects(submitBatch(db, other, { runId: happy.run.id, requestId, previewHash: hash }, deps(fake.client)), { status: 409 });
    });

    await t.test('while a batch is submitted manual recording is blocked, and a second batch for the same statements is refused', async () => {
      await assert.rejects(recordRunPayment(db, sup2, happy.run.id, {
        requestId: randomUUID(), paidOn: new Date().toISOString().slice(0, 10), method: 'bank_transfer', reference: 'Test reference', statementIds: null,
      }), { status: 409, message: /processing/ });
      const fake = makeEveree();
      await assert.rejects(submit(happy.run, fake.client), { status: 409, message: /no driver in this run can be paid/ });
      assert.deepEqual(fake.state.creates, []);
      const preview = await previewEvereeBatch(db, sup2, happy.run.id, { env: ARMED });
      assert.ok(preview.drivers.every((d) => d.blockers.some((b) => b.code === 'in_everee_batch')));
    });

    await t.test('a statement already paid by hand is never sent', async () => {
      const manual = await scenario('M', [[dA, '20.00']]);
      await recordRunPayment(db, sup2, manual.run.id, {
        requestId: randomUUID(), paidOn: new Date().toISOString().slice(0, 10), method: 'cash', reference: 'Test cash handover', statementIds: null,
      });
      const fake = makeEveree();
      await assert.rejects(submit(manual.run, fake.client), { status: 409 });
      assert.deepEqual(fake.state.creates, []);
    });

    let partial;
    let partialBatch;
    await t.test('partial failure: refused is "failed", a timeout and a server error are "unconfirmed", and only what Everee took is asked for payout', async () => {
      partial = await scenario('P', [[dA, '100.00'], [dB, '50.00'], [dC, '40.00'], [dD, '30.00'], [dE, '25.50']]);
      const fake = makeEveree({ 'EW-B': 'refuse', 'EW-C': 'timeout', 'EW-D': 'server' });
      partialBatch = await submit(partial.run, fake.client);
      assert.deepEqual(partialBatch.counts, { submitted: 2, paid: 0, failed: 1, unconfirmed: 2 });
      const by = (driver) => partialBatch.items.find((i) => i.driverId === driver);
      assert.deepEqual([by(dA).status, by(dB).status, by(dC).status, by(dD).status, by(dE).status], ['submitted', 'failed', 'unconfirmed', 'unconfirmed', 'submitted']);
      assert.match(by(dB).error, /422/);
      assert.equal((await statement(partial.run, dB)).payout_status, 'failed');
      assert.equal((await statement(partial.run, dC)).payout_status, 'unconfirmed', 'a timeout is never "failed"');
      assert.equal((await statement(partial.run, dD)).payout_status, 'unconfirmed');
      assert.equal(fake.state.payouts.length, 1);
      assert.deepEqual(fake.state.payouts[0].length, 2, 'only the two Everee accepted');
      const outcomeOf = async (driver) => (await db.query(
        `SELECT a.outcome FROM everee_payment_attempts a JOIN everee_payment_items i ON i.id = a.item_id WHERE i.batch_id = $1 AND i.driver_id = $2`, [partialBatch.batch.id, driver])).rows.map((r) => r.outcome);
      assert.deepEqual(await Promise.all([dA, dB, dC, dD, dE].map(outcomeOf)), [['accepted'], ['refused'], ['timeout'], ['server_error'], ['accepted']]);
      assert.equal(partialBatch.canRetry, true);
    });

    await t.test('retry sends only what failed, with the same ID; unconfirmed and submitted items are never touched; a refusal stays failed', async () => {
      const refusing = makeEveree({ 'EW-B': 'refuse' });
      let view = await retryBatch(db, sup2, partialBatch.batch.id, deps(refusing.client));
      assert.deepEqual(refusing.state.creates.map((c) => c.workerId), ['EW-B'], 'only the failed one');
      assert.equal(view.items.find((i) => i.driverId === dB).status, 'failed');
      assert.equal(view.items.find((i) => i.driverId === dB).attempts, 2);
      assert.equal(refusing.state.payouts.length, 0, 'nothing new to pay out');

      const ok = makeEveree();
      const idBefore = (await item(partial.run, dB)).external_id;
      view = await retryBatch(db, sup2, partialBatch.batch.id, deps(ok.client));
      assert.deepEqual(ok.state.creates.map((c) => [c.workerId, c.externalId]), [['EW-B', idBefore]], 'the same external ID, so Everee cannot make a second payable');
      assert.deepEqual(ok.state.payouts, [[idBefore]], 'and only that payable is asked for payout');
      assert.deepEqual(view.counts, { submitted: 3, paid: 0, failed: 0, unconfirmed: 2 });
      assert.deepEqual([(await statement(partial.run, dC)).payout_status, (await statement(partial.run, dD)).payout_status], ['unconfirmed', 'unconfirmed']);
      assert.equal(view.canRetry, false, 'the unconfirmed ones wait for reconciliation, not a blind retry');
      const none = makeEveree();
      await retryBatch(db, sup2, partialBatch.batch.id, deps(none.client));
      assert.deepEqual([none.state.creates, none.state.payouts], [[], []]);
    });

    await t.test('retry skips a statement paid by hand or a worker who is no longer ready, and needs the same permission as confirming', async () => {
      const run = await scenario('R', [[dA, '10.00'], [dB, '11.00']]);
      const first = makeEveree({ 'EW-A': 'refuse', 'EW-B': 'refuse' });
      const batch = await submit(run.run, first.client);
      assert.equal(batch.counts.failed, 2);
      await db.query("UPDATE pay_statements SET payout_status = 'paid', paid_at = now() WHERE pay_run_id = $1 AND driver_id = $2", [run.run.id, dA]);
      await db.query("UPDATE everee_workers SET terminated = true WHERE driver_id = $1 AND environment = 'sandbox'", [dB]);
      const retry = makeEveree();
      const view = await retryBatch(db, sup2, batch.batch.id, deps(retry.client));
      assert.deepEqual(retry.state.creates, [], 'the paid-by-hand statement and the worker who left are not sent');
      assert.equal(view.counts.failed, 2);
      await db.query("UPDATE everee_workers SET terminated = false WHERE driver_id = $1 AND environment = 'sandbox'", [dB]);
      await assert.rejects(retryBatch(db, cityAdmin, batch.batch.id, deps(retry.client)), { status: 403 });
      await assert.rejects(retryBatch(db, sup1, batch.batch.id, deps(retry.client)), { status: 403, message: /finalized this run/ });
      await assert.rejects(retryBatch(db, sup2, batch.batch.id, deps(retry.client, { env: SANDBOX })), { status: 409, message: /switched off/ });
    });

    await t.test('a rate limit is waited out and repeated (it means Everee did not run the request); one that never clears is "failed", not "unconfirmed"', async () => {
      const run = await scenario('L', [[dA, '10.00'], [dB, '11.00']]);
      sleeps.length = 0;
      const fake = makeEveree({ 'EW-A': (n) => (n === 1 ? 'limit' : 'ok'), 'EW-B': 'limit' });
      const batch = await submit(run.run, fake.client);
      assert.equal(batch.items.find((i) => i.driverId === dA).status, 'submitted');
      assert.equal(batch.items.find((i) => i.driverId === dB).status, 'failed');
      assert.match(batch.items.find((i) => i.driverId === dB).error, /limiting/);
      assert.ok(sleeps.length >= 4 && sleeps.some((ms) => ms >= 1000), 'it waited at least what Everee asked');
      assert.equal(fake.state.creates.filter((c) => c.workerId === 'EW-A').length, 2);
      assert.equal(fake.state.creates.filter((c) => c.workerId === 'EW-B').length, 4, 'one try and three repeats, then it stops');
    });

    await t.test('if the payout request fails the payables stay submitted and only the payout request is repeated', async () => {
      const run = await scenario('Q', [[dA, '10.00'], [dB, '11.00']]);
      const fake = makeEveree();
      fake.state.payout = 'server';
      const batch = await submit(run.run, fake.client);
      assert.deepEqual(batch.counts, { submitted: 2, paid: 0, failed: 0, unconfirmed: 0 });
      assert.equal(batch.payoutRequests[0].outcome, 'server_error');
      assert.equal(batch.items.every((i) => i.everee.payoutRequested === false), true);
      assert.equal(batch.canRetry, true);
      fake.state.payout = 'ok';
      fake.state.creates.length = 0;
      const view = await retryBatch(db, sup2, batch.batch.id, deps(fake.client));
      assert.deepEqual(fake.state.creates, [], 'the payables are not created again');
      assert.equal(fake.state.payouts.length, 2);
      assert.equal(view.items.every((i) => i.everee.payoutRequested), true);
      assert.equal(view.canRetry, false);
    });

    await t.test('an answer for another payable is "unconfirmed"; a payout request that takes nothing is recorded as such', async () => {
      const run = await scenario('W', [[dA, '10.00'], [dB, '11.00']]);
      const fake = makeEveree({ 'EW-A': 'wrong' });
      fake.state.payout = 'empty';
      const batch = await submit(run.run, fake.client);
      assert.equal(batch.items.find((i) => i.driverId === dA).status, 'unconfirmed');
      assert.equal(batch.items.find((i) => i.driverId === dB).status, 'submitted');
      assert.equal(batch.payoutRequests[0].outcome, 'nothing_to_process');
      const attempt = await one(`SELECT outcome FROM everee_payment_attempts a JOIN everee_payment_items i ON i.id = a.item_id JOIN pay_statements s ON s.id = i.pay_statement_id WHERE s.pay_run_id = $1 AND s.driver_id = $2`, [run.run.id, dA]);
      assert.equal(attempt.outcome, 'unexpected_answer');
      assert.deepEqual(fake.state.reads, [(await item(run.run, dB)).external_id], 'only the payable the request did not take was looked at');
      assert.equal(batch.items.find((i) => i.driverId === dB).everee.payableStatus, 'PENDING_APPROVAL');
      assert.equal(batch.items.find((i) => i.driverId === dB).everee.payoutRequested, true, 'Everee already has it in payment (a lost reply to an earlier request): recorded, not asked again');
    });

    await t.test('a payable Everee took but will not pay out (status ERROR, as the real sandbox does) is "unconfirmed": blocked for manual recording and for a blind retry', async () => {
      const run = await scenario('K', [[dA, '10.00'], [dB, '11.00']]);
      const fake = makeEveree();
      fake.state.payout = 'empty';
      fake.state.payableStatus = 'ERROR';
      const batch = await submit(run.run, fake.client);
      assert.deepEqual(batch.counts, { submitted: 0, paid: 0, failed: 0, unconfirmed: 2 });
      assert.ok(batch.items.every((i) => i.everee.payableStatus === 'ERROR' && /Check the worker in Everee/.test(i.error)));
      assert.deepEqual([(await statement(run.run, dA)).payout_status, (await statement(run.run, dB)).payout_status], ['unconfirmed', 'unconfirmed']);
      await assert.rejects(recordRunPayment(db, sup2, run.run.id, {
        requestId: randomUUID(), paidOn: new Date().toISOString().slice(0, 10), method: 'cash', reference: 'Test reference', statementIds: null,
      }), { status: 409 }, 'it cannot be marked paid by hand while Everee might still pay it');
      const retry = makeEveree();
      const view = await retryBatch(db, sup2, batch.batch.id, deps(retry.client));
      assert.deepEqual([retry.state.creates, retry.state.payouts], [[], []], 'nothing is sent again');
      assert.equal(view.counts.unconfirmed, 2);
      assert.equal(view.canRetry, false);
    });

    await t.test('if the status of an untaken payable cannot be read it stays submitted, to be looked at again', async () => {
      const run = await scenario('U', [[dA, '10.00']]);
      const fake = makeEveree();
      fake.state.payout = 'empty';
      fake.state.readFails = true;
      const batch = await submit(run.run, fake.client);
      assert.deepEqual(batch.counts, { submitted: 1, paid: 0, failed: 0, unconfirmed: 0 });
      assert.equal(batch.items[0].everee.payoutRequested, false);
      assert.equal(batch.canRetry, true);
      fake.state.readFails = false;
      fake.state.payout = 'ok';
      const view = await retryBatch(db, sup2, batch.batch.id, deps(fake.client));
      assert.equal(view.items[0].everee.payoutRequested, true, 'the next try asks for payout again');
    });

    await t.test('earnings that changed after approval stop the batch before anything is reserved', async () => {
      const run = await scenario('E', [[dA, '10.00']]);
      const hash = await hashOf(run.run);
      await db.query("UPDATE payment_dashboard SET paid = true WHERE id = (SELECT pd.id FROM payment_dashboard pd JOIN dashboard_data dd ON dd.id = pd.dashboard_data_id WHERE dd.route_id = $1 LIMIT 1)", [run.route]);
      const fake = makeEveree();
      const before = await counts();
      await assert.rejects(submit(run.run, fake.client, { previewHash: hash }), { status: 409 });
      assert.deepEqual(fake.state.creates, []);
      assert.deepEqual(await counts(), before);
      assert.equal((await statement(run.run, dA)).payout_status, 'not_submitted');
    });

    await t.test('the time zone and work location are per city: they change the earning date and go on the payable; live payments need both', async () => {
      const run = await scenario('C', [[dA, '10.00']]);
      await assert.rejects(setCitySettings(db, cityAdmin, run.city, { timeZone: 'UTC' }), { status: 403 });
      await assert.rejects(setCitySettings(db, sup2, run.city, { timeZone: 'Mars/Olympus' }), { status: 400 });
      await assert.rejects(setCitySettings(db, sup2, run.city, { workLocationId: -3 }), { status: 400 });
      await assert.rejects(setCitySettings(db, sup2, 999999, { timeZone: 'UTC' }), { status: 404 });
      assert.deepEqual(await getCitySettings(db, sup2, run.city), { cityId: run.city, timeZone: null, effectiveTimeZone: 'America/Chicago', workLocationId: null });
      const settings = await setCitySettings(db, sup2, run.city, { timeZone: 'America/New_York', workLocationId: 77 });
      assert.deepEqual([settings.timeZone, settings.workLocationId], ['America/New_York', 77]);

      const fake = makeEveree();
      await submit(run.run, fake.client);
      const sent = fake.state.creates[0];
      assert.equal(sent.earningTimestamp, noonInZone(await periodEnd(run.run), 'America/New_York'));
      assert.equal(sent.workLocationId, 77);

      const bare = await scenario('B', [[dA, '10.00']]);
      const live = await previewEvereeBatch(db, sup2, bare.run.id, { env: PRODUCTION });
      assert.ok(live.batchBlockers.some((b) => b.code === 'city_settings_missing'), 'live needs the city settings');
      assert.equal(live.citySettings.timeZoneIsDefault, true);
      const sandbox = await previewEvereeBatch(db, sup2, bare.run.id, { env: ARMED });
      assert.ok(!sandbox.batchBlockers.some((b) => b.code === 'city_settings_missing'), 'the sandbox does not');
    });

    await t.test('live payments are refused until they are approved, however the rest is set', async () => {
      const run = await scenario('X', [[dA, '10.00']]);
      const fake = makeEveree();
      await assert.rejects(submitBatch(db, sup2, { runId: run.run.id, requestId: randomUUID(), previewHash: '2'.repeat(64) }, deps(fake.client, { env: PRODUCTION })), { status: 409, message: /not approved/ });
      assert.deepEqual(fake.state.creates, []);
    });

    await t.test('the database keeps every payment record: one item per statement for ever, nothing deleted, and identity never changes', async () => {
      await savepoint(() => assert.rejects(db.query('DELETE FROM everee_payment_items'), /cannot be deleted/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM everee_payment_attempts'), /cannot be deleted/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM everee_payout_requests'), /cannot be deleted/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM everee_payment_batches'), /cannot be deleted/));
      await savepoint(() => assert.rejects(db.query('UPDATE everee_payment_batches SET total = 1'), /cannot be changed/));
      const first = await item(happy.run, dA);
      await savepoint(() => assert.rejects(db.query('UPDATE everee_payment_items SET amount = 1 WHERE id = $1', [first.id]), /cannot be changed/));
      await savepoint(() => assert.rejects(db.query("UPDATE everee_payment_items SET external_id = 'nasa-stmt-1' WHERE id = $1", [first.id]), /cannot be changed/));
      await savepoint(() => assert.rejects(db.query("UPDATE everee_payment_attempts SET outcome = 'refused' WHERE outcome = 'accepted'"), /once finished/));
      await savepoint(() => assert.rejects(db.query(
        `INSERT INTO everee_payment_items (batch_id, pay_statement_id, driver_id, everee_worker_id, external_id, amount) VALUES ($1, $2, $3, 'EW-A', 'nasa-stmt-777777', 1)`,
        [first.batch_id, first.pay_statement_id, dA]), /duplicate key|everee_payment_items_pay_statement_id_key/), 'a second item for the same statement');
      await savepoint(() => assert.rejects(db.query(
        `INSERT INTO everee_payment_items (batch_id, pay_statement_id, driver_id, everee_worker_id, external_id, amount) VALUES ($1, 1, $2, 'EW-A', $3, 1)`,
        [first.batch_id, dA, first.external_id]), /duplicate key|everee_payment_items_external_id_key/), 'the same external ID twice');
    });

    await t.test('reading a batch is for a super admin of its city', async () => {
      await assert.rejects(getBatchView(db, cityAdmin, happyBatch.batch.id), { status: 403 });
      await assert.rejects(getBatchView(db, sup2, 987654321), { status: 404 });
      const view = await getBatchView(db, sup2, happyBatch.batch.id);
      assert.deepEqual(view.items.map((i) => i.status), ['submitted', 'submitted']);
      assert.ok(!JSON.stringify(view).includes('EW-A'), 'no Everee worker ID is shown');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
