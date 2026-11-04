import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getBatchView, submitBatch } from '../services/payments/everee/batchSubmit.js';
import { previewEvereeBatch } from '../services/payments/everee/batchPreview.js';
import { EvereeError } from '../services/payments/everee/evereeClient.js';
import { applyPaymentEvent, checkBatch, checkOpenItems, reconcileItem } from '../services/payments/everee/paymentStatus.js';
import { receiveEvent } from '../services/payments/everee/webhookService.js';
import { finalizeRun, generateRun } from '../services/payroll/payRuns/payRunStore.js';
import { recordRunPayment } from '../services/payroll/payRuns/paymentRecords.js';

// Needs a PostgreSQL copy with the app's tables (never production): PAYROLL_TEST_DB=1 and the DB_* variables. One transaction, always rolled back.
// Everything is made up, and Everee is a fake: no request leaves this machine, no money moves.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const ARMED = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_PAYMENTS_ENABLED: 'true' };
const KEY = 'whsec_test_key';

// A fake Everee: payables and payments are whatever the test puts in `state`.
const makeEveree = () => {
  const state = { payables: {}, payments: {}, readFails: false, historyReads: 0 };
  const client = {
    createPayable: async (body) => ({ status: 201, data: { externalId: body.externalId }, requestId: 'req-ok' }),
    requestPayout: async (ids) => ({ status: 201, data: { payableCount: ids.length, payableExternalIds: ids }, requestId: 'req-pay' }),
    getPayable: async (externalId) => {
      if (state.readFails) throw new EvereeError('Everee refused the token', { status: 401 });
      return { status: 200, data: state.payables[externalId] ?? { externalId, paymentStatus: 'PENDING_APPROVAL' }, requestId: 'req-get' };
    },
    getPaymentHistoryItem: async (paymentId) => {
      state.historyReads += 1;
      if (!(paymentId in state.payments)) throw new EvereeError('Everee did not find what was asked for', { status: 404 });
      return { status: 200, data: state.payments[paymentId], requestId: 'req-hist' };
    },
  };
  return { state, client };
};

test('everee payment status: only a payment that landed marks a statement paid', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-04-issue-031-everee-payments.sql', '2026-11-04-issue-031-everee-payment-status.sql']) await db.query(migration(m));

    const tag = randomUUID();
    const admin = async (role, n) => one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${n} ${tag}`, `${n}${tag}@example.com`, role]);
    const sup1 = await admin('superadmin', 'one');
    const sup2 = await admin('superadmin', 'two');
    const cityAdmin = await admin('admin', 'city');
    const drivers = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 6')).rows.map((r) => r.id);
    const [dA, dB, dC, dD, dE, dF] = drivers;
    const workers = { [dA]: 'EW-A', [dB]: 'EW-B', [dC]: 'EW-C', [dD]: 'EW-D', [dE]: 'EW-E', [dF]: 'EW-F' };
    for (const [driver, worker] of Object.entries(workers)) {
      await db.query(`INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, onboarding_complete, tin_status, linked_by)
        VALUES ($1, 'sandbox', $2, 'created_sandbox', true, 'VERIFIED', $3)`, [driver, worker, sup1.id]);
    }
    let seq = 8800;
    const scenario = async (label, pairs) => {
      const job = `Test Status ${label}`;
      const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [job, `TT${label}`])).id;
      const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3) RETURNING id`, [`TT ${label}`, job, `TT-${label}`])).id;
      await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, city]);
      for (const [driver, gross] of pairs) {
        const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, '2026-11-02'])).id;
        seq += 10;
        await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 0 WHERE dashboard_data_id = $1', [dd, gross]);
      }
      const run = (await generateRun(db, sup1, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' })).run;
      await finalizeRun(db, sup1, run.id);
      return { run, city };
    };
    const deps = (client, extra = {}) => ({ env: ARMED, client, sleep: async () => {}, throttleMs: 0, ...extra });
    const sent = async (sc, fake) => submitBatch(db, sup2, { runId: sc.run.id, requestId: randomUUID(), previewHash: (await previewEvereeBatch(db, sup2, sc.run.id, { env: ARMED })).previewHash }, deps(fake.client));
    const item = (sc, driver) => one('SELECT i.* FROM everee_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id WHERE s.pay_run_id = $1 AND s.driver_id = $2', [sc.run.id, driver]);
    const stmt = (sc, driver) => one('SELECT id, payout_status, payout_reference, paid_at, net::text AS net FROM pay_statements WHERE pay_run_id = $1 AND driver_id = $2', [sc.run.id, driver]);
    const rows = async (sc) => (await db.query(
      `SELECT pd.paid AS pd_paid, dd.paid AS dd_paid, to_char(pd.payment_date, 'YYYY-MM-DD') AS payment_date FROM pay_statements s JOIN pay_statement_lines l ON l.statement_id = s.id AND l.active AND l.line_type = 'earning'
        JOIN payment_dashboard pd ON pd.id = l.payment_dashboard_id JOIN dashboard_data dd ON dd.id = pd.dashboard_data_id WHERE s.pay_run_id = $1`, [sc.run.id])).rows;
    const check = (fake, id) => reconcileItem(db, id, deps(fake.client), fake.client);
    const landed = (amount) => ({ netPayouts: [{ id: 'po1', status: 'PAID', netAmount: amount }], payDate: '2026-11-09' });

    const sc = await scenario('P', [[dA, '100.00'], [dB, '50.00'], [dC, '25.00']]);
    const fake = makeEveree();
    const batch = await sent(sc, fake);
    assert.deepEqual(batch.counts, { submitted: 3, paid: 0, failed: 0, unconfirmed: 0 });
    const iA = await item(sc, dA);
    const frozenNet = (await stmt(sc, dA)).net;

    await t.test('waiting: no payment yet, not processed yet, still pending, an answer not understood: nothing is paid', async () => {
      assert.equal(await check(fake, iA.id), 'waiting', 'Everee has not put the payable in a payment');
      fake.state.payables[iA.external_id] = { externalId: iA.external_id, paymentStatus: 'PENDING_APPROVAL', paymentId: 'pay-A' };
      assert.equal(await check(fake, iA.id), 'not_processed', '404 until processed for deposit');
      fake.state.payments['pay-A'] = { netPayouts: [{ id: 'po1', status: 'PENDING' }] };
      assert.equal(await check(fake, iA.id), 'pending');
      fake.state.payments['pay-A'] = { status: 'PAID' };
      assert.equal(await check(fake, iA.id), 'unknown');
      fake.state.payments['pay-A'] = { netPayouts: [{ id: 'po1', status: 'SETTLED' }] };
      assert.equal(await check(fake, iA.id), 'unknown');
      const after = await item(sc, dA);
      assert.deepEqual([after.status, (await stmt(sc, dA)).payout_status, after.everee_payment_id], ['submitted', 'submitted', 'pay-A']);
      assert.match(after.check_note, /not understood/);
      assert.ok(after.last_checked_at);
      assert.ok((await rows(sc)).every((r) => !r.pd_paid && !r.dd_paid));
    });

    await t.test('an unreadable payable (a refused token) changes nothing and is only noted', async () => {
      fake.state.readFails = true;
      const other = await item(sc, dB);
      assert.equal(await check(fake, other.id), 'unreadable');
      assert.match((await item(sc, dB)).check_note, /could not be read/);
      assert.equal((await item(sc, dB)).status, 'submitted');
      fake.state.readFails = false;
    });

    await t.test('a returned deposit is flagged, never paid; a total that differs from what was sent is never paid', async () => {
      fake.state.payments['pay-A'] = { netPayouts: [{ id: 'po1', status: 'FAILED' }] };
      assert.equal(await check(fake, iA.id), 'returned');
      assert.deepEqual([(await item(sc, dA)).status, (await item(sc, dA)).deposit_returned], ['submitted', true]);
      fake.state.payments['pay-A'] = landed(99);
      assert.equal(await check(fake, iA.id), 'amount_differs');
      assert.match((await item(sc, dA)).check_note, /99\.00 for this payment but 100\.00 was sent/);
      assert.deepEqual([(await item(sc, dA)).status, (await stmt(sc, dA)).payout_status], ['submitted', 'submitted']);
    });

    await t.test('landed: the statement, the item and the rows it included become paid in one step, once, with nothing recalculated', async () => {
      fake.state.payments['pay-A'] = landed(100);
      assert.equal(await check(fake, iA.id), 'paid');
      const done = await item(sc, dA);
      assert.deepEqual([done.status, done.everee_payment_id, done.deposit_returned, done.error_message], ['paid', 'pay-A', false, null]);
      assert.equal(String(done.everee_pay_date).slice(0, 10), '2026-11-09');
      const s = await stmt(sc, dA);
      assert.deepEqual([s.payout_status, s.payout_reference, s.net], ['paid', 'everee:pay-A', frozenNet]);
      assert.ok(s.paid_at);
      const paidRows = (await rows(sc)).filter((r) => r.pd_paid);
      assert.equal(paidRows.length, 1, 'only the paid driver\'s rows');
      assert.deepEqual([paidRows[0].dd_paid, paidRows[0].payment_date], [true, '2026-11-09']);
      assert.equal(await check(fake, iA.id), 'unchanged', 'looking again changes nothing');
      assert.equal((await stmt(sc, dB)).payout_status, 'submitted', 'the others are untouched');
    });

    await t.test('manual recording cannot pay a statement Everee already paid, and cannot pay one Everee is processing', async () => {
      const manual = async (ids) => recordRunPayment(db, sup2, sc.run.id, { requestId: randomUUID(), paidOn: (await one("SELECT to_char(now(), 'YYYY-MM-DD') AS d")).d, method: 'other', reference: 'manual test', confirmed: true, statementIds: ids });
      assert.equal((await manual([(await stmt(sc, dA)).id])).alreadyPaid, true);
      await assert.rejects(manual([(await stmt(sc, dB)).id]), { status: 409, message: /processing, unconfirmed or needs review/ });
    });

    await t.test('a deposit returned AFTER paid is flagged for a person and the statement stays paid; the flag clears when the retry settles', async () => {
      fake.state.payments['pay-A'] = { netPayouts: [{ id: 'po1', status: 'FAILED' }] };
      assert.equal(await applyPaymentEvent(db, { paymentId: 'pay-A', workerId: 'EW-A' }, { environment: 'sandbox' }, fake.client, deps(fake.client)), 'applied');
      assert.deepEqual([(await item(sc, dA)).status, (await item(sc, dA)).deposit_returned, (await stmt(sc, dA)).payout_status], ['paid', true, 'paid']);
      fake.state.payments['pay-A'] = { netPayouts: [{ id: 'po2', status: 'PENDING' }] };
      assert.equal(await check(fake, iA.id), 'pending');
      assert.equal((await item(sc, dA)).deposit_returned, true, 'still flagged while the retry is pending');
      fake.state.payments['pay-A'] = landed(100);
      assert.equal(await check(fake, iA.id), 'retry_settled');
      assert.equal((await item(sc, dA)).deposit_returned, false);
      assert.equal((await stmt(sc, dA)).payout_status, 'paid');
    });

    await t.test('a blocked payable makes the item unconfirmed; once Everee is processing it again it goes back to submitted', async () => {
      const iB = await item(sc, dB);
      fake.state.payables[iB.external_id] = { externalId: iB.external_id, paymentStatus: 'ERROR' };
      assert.equal(await check(fake, iB.id), 'waiting');
      assert.deepEqual([(await item(sc, dB)).status, (await stmt(sc, dB)).payout_status], ['unconfirmed', 'unconfirmed']);
      fake.state.payables[iB.external_id] = { externalId: iB.external_id, paymentStatus: 'PENDING_PAYMENT', paymentId: 'pay-B' };
      assert.equal(await check(fake, iB.id), 'not_processed');
      assert.deepEqual([(await item(sc, dB)).status, (await item(sc, dB)).error_message, (await stmt(sc, dB)).payout_status], ['submitted', null, 'submitted']);
      fake.state.payments['pay-B'] = landed(50);
      assert.equal(await check(fake, iB.id), 'paid', 'an unconfirmed item that landed is paid too');
    });

    await t.test('events only prompt a fresh look: a payment event for a payment that is not ours does nothing, and the state comes from Everee, not the event', async () => {
      assert.equal(await applyPaymentEvent(db, { paymentId: 'someone-else' }, { environment: 'sandbox' }, fake.client, deps(fake.client)), 'no_item');
      assert.equal(await applyPaymentEvent(db, {}, { environment: 'sandbox' }, fake.client, deps(fake.client)), 'no_payment_id');
      const iC = await item(sc, dC);
      fake.state.payables[iC.external_id] = { externalId: iC.external_id, paymentStatus: 'PENDING_APPROVAL', paymentId: 'pay-C' };
      // an event that CLAIMS the payment is paid, while Everee says pending: nothing is paid
      fake.state.payments['pay-C'] = { netPayouts: [{ id: 'po1', status: 'PENDING' }] };
      assert.equal(await applyPaymentEvent(db, { paymentId: 'pay-C', workerId: 'EW-C', paymentStatus: 'PAID', payableExternalIds: [iC.external_id] }, { environment: 'sandbox' }, fake.client, deps(fake.client)), 'applied');
      assert.equal((await item(sc, dC)).status, 'submitted');
    });

    await t.test('a signed payment.paid event, end to end through the webhook, pays the item once; the same event again is a duplicate', async () => {
      const iC = await item(sc, dC);
      fake.state.payments['pay-C'] = landed(25);
      const body = Buffer.from(JSON.stringify({ version: '1', id: `evt-${tag}`, companyId: 4321, type: 'payment.paid', timestamp: 1, data: { object: { paymentId: 'pay-C', workerId: 'EW-C' } } }));
      const now = Math.floor(Date.now() / 1000);
      const headers = { 'x-everee-webhook-timestamp': String(now), 'x-everee-webhook-signature': `v1=${createHmac('sha256', KEY).update(`${now}.${body}`).digest('hex')}` };
      const env = { ...ARMED, EVEREE_WEBHOOK_SIGNING_KEY: KEY };
      const first = await receiveEvent(db, { rawBody: body, headers }, { ...deps(fake.client), env, nowSeconds: now });
      assert.deepEqual([first.status, first.body.outcome], [200, 'applied']);
      assert.deepEqual([(await item(sc, dC)).status, (await stmt(sc, dC)).payout_status], ['paid', 'paid']);
      const again = await receiveEvent(db, { rawBody: body, headers }, { ...deps(fake.client), env, nowSeconds: now });
      assert.deepEqual([again.status, again.body.duplicate], [200, true]);
      assert.equal(iC.status, 'submitted');
    });

    await t.test('earnings that changed after approval: the money landed so the statement is paid, but the changed rows are left and the note says so', async () => {
      const sc2 = await scenario('Q', [[dD, '40.00']]);
      const fake2 = makeEveree();
      await sent(sc2, fake2);
      const it = await item(sc2, dD);
      await db.query('UPDATE payment_dashboard SET driver_payment = 41 WHERE id IN (SELECT l.payment_dashboard_id FROM pay_statement_lines l JOIN pay_statements s ON s.id = l.statement_id WHERE s.pay_run_id = $1 AND l.line_type = \'earning\')', [sc2.run.id]);
      fake2.state.payables[it.external_id] = { externalId: it.external_id, paymentStatus: 'PAID', paymentId: 'pay-D' };
      fake2.state.payments['pay-D'] = landed(40);
      assert.equal(await check(fake2, it.id), 'paid_review');
      assert.equal((await stmt(sc2, dD)).payout_status, 'paid');
      assert.ok((await rows(sc2)).every((r) => !r.pd_paid), 'the changed source rows were not touched');
      assert.match((await item(sc2, dD)).check_note, /review this run/);
    });

    await t.test('the batch view shows the result, the checked time and the note; "check now" is for a super admin of the city and is gentle', async () => {
      const view = await getBatchView(db, sup2, batch.batch.id);
      const a = view.items.find((i) => i.statementId === iA.pay_statement_id);
      assert.deepEqual([a.status, a.payDate], ['paid', '2026-11-09']);
      assert.ok(a.paidAt && a.lastCheckedAt);
      assert.equal(view.counts.paid, 3);
      await assert.rejects(checkBatch(db, cityAdmin, batch.batch.id, deps(fake.client)), { status: 403 });
      await assert.rejects(checkBatch(db, sup2, 987654321, deps(fake.client)), { status: 404 });
      const sc3 = await scenario('R', [[dE, '10.00']]);
      const fake3 = makeEveree();
      const b3 = await sent(sc3, fake3);
      const it = await item(sc3, dE);
      fake3.state.payables[it.external_id] = { externalId: it.external_id, paymentStatus: 'PENDING_APPROVAL', paymentId: 'pay-E' };
      fake3.state.payments['pay-E'] = landed(10);
      assert.deepEqual((await checkBatch(db, sup2, b3.batch.id, deps(fake3.client))).results, { paid: 1 });
      assert.deepEqual((await checkBatch(db, sup2, b3.batch.id, deps(fake3.client))).results, {}, 'a paid item is not looked at again');
    });

    await t.test('the scheduled check does nothing unless payments are switched on, and skips items looked at a moment ago', async () => {
      assert.deepEqual(await checkOpenItems(db, { env: { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' }, client: makeEveree().client }), { skipped: true });
      const sc4 = await scenario('S', [[dF, '12.00']]);
      const fake4 = makeEveree();
      await sent(sc4, fake4);
      const it = await item(sc4, dF);
      await db.query("UPDATE everee_payment_items SET last_checked_at = now() WHERE id = $1", [it.id]);
      const before = fake4.state.historyReads;
      await checkOpenItems(db, deps(fake4.client));
      assert.equal(fake4.state.historyReads, before, 'looked at a moment ago: not read again');
      await db.query("UPDATE everee_payment_items SET last_checked_at = now() - interval '20 minutes' WHERE id = $1", [it.id]);
      const result = await checkOpenItems(db, deps(fake4.client));
      assert.ok(result.checked >= 1);
    });

    await t.test('the guard still blocks changing who is paid how much, but allows the new status columns', async () => {
      const iA2 = await item(sc, dA);
      await assert.rejects(db.query('SAVEPOINT g').then(() => db.query('UPDATE everee_payment_items SET amount = 1 WHERE id = $1', [iA2.id])).finally(() => db.query('ROLLBACK TO SAVEPOINT g')), /cannot be changed/);
      await db.query("UPDATE everee_payment_items SET check_note = 'x', last_checked_at = now() WHERE id = $1", [iA2.id]);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
