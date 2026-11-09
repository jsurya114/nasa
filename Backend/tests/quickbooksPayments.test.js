import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getBatchView, PreviewChangedError, previewQuickbooksBatch, retryBatch, submitBatch } from '../services/payments/quickbooks/quickbooksPayments.js';
import { QuickbooksError } from '../services/payments/quickbooks/quickbooksClient.js';
import { finalizeRun, generateRun } from '../services/payroll/payRuns/payRunStore.js';
import { recordRunPayment } from '../services/payroll/payRuns/paymentRecords.js';

// Needs a PostgreSQL copy with the app's tables (never production): PAYROLL_TEST_DB=1 and the DB_* variables. One transaction, always rolled back.
// Everything is made up, and QuickBooks is a fake: no request leaves this machine, no money moves.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const BASE = { QUICKBOOKS_ENABLED: 'true', QUICKBOOKS_ENVIRONMENT: 'sandbox', QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 's', QUICKBOOKS_REDIRECT_URI: 'https://nasa.example/cb', QUICKBOOKS_TOKEN_KEY: 'a'.repeat(64) };
const ARMED = { ...BASE, QUICKBOOKS_PAYMENTS_ENABLED: 'true' };

// A fake QuickBooks that keeps its bills. `behaviors` says what happens to a vendor's bill or payment: ok, refuse (400), timeout, server (500).
const makeQuickbooks = (behaviors = {}) => {
  const state = { bills: [], payments: [], finds: 0 };
  const act = (vendor, step) => {
    const b = behaviors[vendor]?.[step];
    const kind = typeof b === 'function' ? b() : b;
    if (kind === 'refuse') throw new QuickbooksError('QuickBooks answered 400: Business Validation Error', { status: 400, requestId: 'tid-400' });
    if (kind === 'timeout') throw new QuickbooksError('QuickBooks did not answer in time');
    if (kind === 'server') throw new QuickbooksError('QuickBooks answered 500', { status: 500, requestId: 'tid-500' });
  };
  const client = {
    findBillsByDocNumber: async (doc) => { state.finds += 1; return state.bills.filter((b) => b.DocNumber === doc).map((b) => ({ ...b })); },
    createBill: async (body) => {
      const vendor = body.VendorRef.value;
      act(vendor, 'bill');
      const bill = { Id: String(100 + state.bills.length), DocNumber: body.DocNumber, TotalAmt: body.Line[0].Amount, Balance: body.Line[0].Amount, VendorRef: body.VendorRef, body };
      state.bills.push(bill);
      return { ...bill };
    },
    createBillPayment: async (body) => {
      const vendor = body.VendorRef.value;
      act(vendor, 'payment');
      const bill = state.bills.find((b) => b.Id === body.Line[0].LinkedTxn[0].TxnId);
      bill.Balance = 0;
      const payment = { Id: String(500 + state.payments.length), body };
      state.payments.push(payment);
      return payment;
    },
  };
  return { state, client };
};

test('quickbooks payments: reserve, send, settle, replay, partial failure, safe retry, and the guards', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql',
      '2026-11-04-approved-run-payment-records.sql', '2026-11-06-issue-232-driver-type.sql', '2026-11-10-quickbooks-connection.sql', '2026-11-10-quickbooks-payments.sql']) await db.query(migration(m));

    const tag = randomUUID();
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `s${tag}@example.com`]);
    const plain = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id, role", [`Plain ${tag}`, `p${tag}@example.com`]);
    const [dA, dB, dC, dD] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 4')).rows.map((r) => r.id);
    await db.query("UPDATE drivers SET driver_type = 'DESI' WHERE id = ANY($1::int[])", [[dA, dB, dC]]);
    await db.query("UPDATE drivers SET driver_type = 'LOCAL' WHERE id = $1", [dD]);
    await db.query(`INSERT INTO quickbooks_connection (environment, realm_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, connected_by)
      VALUES ('sandbox', '12345678', 'x', 'x', now() + interval '1 hour', now() + interval '90 days', $1) ON CONFLICT (environment) DO UPDATE SET realm_id = '12345678'`, [sup.id]);
    await db.query(`INSERT INTO quickbooks_settings (environment, expense_account_id, bank_account_id, updated_by) VALUES ('sandbox', '61', '35', $1)
      ON CONFLICT (environment) DO UPDATE SET expense_account_id = '61', bank_account_id = '35'`, [sup.id]);
    const link = (driver, vendor, is1099 = true) => db.query(
      `INSERT INTO quickbooks_vendors (driver_id, environment, realm_id, vendor_id, link_source, tax_id_supplied, vendor_1099, linked_by)
       VALUES ($1, 'sandbox', '12345678', $2, 'existing_vendor', true, $3, $4)`, [driver, vendor, is1099, sup.id]);
    await link(dA, '71'); await link(dB, '72'); await link(dC, '73', false);

    let seq = 19900;
    const scenario = async (label, pairs) => {
      const job = `Test QB ${label}`;
      const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [job, `QB${label}`])).id;
      const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3) RETURNING id`, [`QB ${label}`, job, `QB-${label}`])).id;
      for (const [driver, gross] of pairs) {
        const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, '2026-11-02'])).id;
        seq += 10;
        await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 0 WHERE dashboard_data_id = $1', [dd, gross]);
      }
      const run = (await generateRun(db, sup, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' })).run;
      await finalizeRun(db, sup, run.id);
      return { run, city };
    };
    const hashOf = async (run, env = ARMED) => (await previewQuickbooksBatch(db, sup, run.id, { env })).previewHash;
    const deps = (client, extra = {}) => ({ env: ARMED, client, sleep: async () => {}, throttleMs: 0, ...extra });
    const submit = async (run, client, { who = sup, requestId = randomUUID(), previewHash, paidOn = '2026-11-08', extra } = {}) =>
      submitBatch(db, who, { runId: run.id, requestId, previewHash: previewHash ?? await hashOf(run), paidOn }, deps(client, extra));
    const statement = (run, driver) => one('SELECT id, payout_status, payout_reference, paid_at FROM pay_statements WHERE pay_run_id = $1 AND driver_id = $2', [run.id, driver]);
    const item = (run, driver) => one('SELECT i.* FROM quickbooks_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id WHERE s.pay_run_id = $1 AND s.driver_id = $2', [run.id, driver]);
    const counts = () => one('SELECT (SELECT count(*) FROM quickbooks_payment_batches)::int b, (SELECT count(*) FROM quickbooks_payment_items)::int i, (SELECT count(*) FROM quickbooks_payment_attempts)::int a');

    const happy = await scenario('H', [[dA, '100.00'], [dB, '50.00']]);

    await t.test('nothing is recorded without the switch, a super admin, a valid confirmation, a date and an unchanged preview', async () => {
      const fake = makeQuickbooks();
      const hash = await hashOf(happy.run);
      const before = await counts();
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, extra: { env: BASE } }), { status: 409, message: /switched off/ });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, who: plain }), { status: 403 });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, requestId: 'nope' }), { status: 400 });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, paidOn: 'tomorrow' }), { status: 400 });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: hash, paidOn: '2999-01-01' }), { status: 400, message: /future/ });
      await assert.rejects(submit(happy.run, fake.client, { previewHash: '0'.repeat(64) }), (e) => e instanceof PreviewChangedError && e.preview.previewHash === hash);
      assert.deepEqual(fake.state.bills, []);
      assert.deepEqual(await counts(), before);
    });

    let batch;
    await t.test('a confirmed batch makes one bill and one payment per driver, marks the statements paid with the QuickBooks reference, and replays safely', async () => {
      const fake = makeQuickbooks();
      batch = await submit(happy.run, fake.client);
      assert.deepEqual(batch.counts, { submitted: 0, paid: 2, failed: 0, unconfirmed: 0 });
      assert.deepEqual([batch.batch.drivers, batch.batch.total, batch.batch.paidOn], [2, '150.00', '2026-11-08']);
      assert.equal(fake.state.bills.length, 2);
      assert.equal(fake.state.payments.length, 2);
      const sa = await statement(happy.run, dA);
      const bill = fake.state.bills.find((b) => b.VendorRef.value === '71');
      assert.equal(bill.DocNumber, `NASA-S${sa.id}`);
      assert.equal(bill.TotalAmt, 100);
      assert.equal(bill.body.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, '61');
      assert.equal(fake.state.payments.find((p) => p.body.VendorRef.value === '71').body.CheckPayment.BankAccountRef.value, '35');
      assert.ok(!JSON.stringify([...fake.state.bills.map((b) => b.body), ...fake.state.payments.map((p) => p.body)]).includes(tag), 'no driver name or email is sent');
      assert.deepEqual([sa.payout_status, sa.payout_reference, sa.paid_at !== null], ['paid', `QuickBooks bill ${bill.Id}`, true]);
      assert.equal((await one('SELECT count(*)::int n FROM payment_dashboard pd JOIN pay_statement_lines l ON l.payment_dashboard_id = pd.id JOIN pay_statements s ON s.id = l.statement_id WHERE s.pay_run_id = $1 AND pd.paid', [happy.run.id])).n, 2);

      const again = await submitBatch(db, sup, { runId: happy.run.id, requestId: batch.batch.requestId, previewHash: (await one('SELECT preview_hash h FROM quickbooks_payment_batches WHERE id = $1', [batch.batch.id])).h, paidOn: '2026-11-08' }, deps(fake.client));
      assert.deepEqual([again.replay, again.batch.id], [true, batch.batch.id]);
      assert.equal(fake.state.bills.length, 2);
      await assert.rejects(submitBatch(db, sup, { runId: happy.run.id, requestId: batch.batch.requestId, previewHash: '1'.repeat(64), paidOn: '2026-11-08' }, deps(fake.client)), { status: 409 });
    });

    await t.test('a paid statement is not offered again, cannot be recorded by hand, and the batch can be read', async () => {
      const preview = await previewQuickbooksBatch(db, sup, happy.run.id, { env: ARMED });
      assert.equal(preview.canSubmit, false);
      assert.ok(preview.drivers.every((d) => d.blockers.some((b) => b.code === 'already_paid' || b.code === 'in_quickbooks_batch')));
      const view = await getBatchView(db, sup, batch.batch.id);
      assert.equal(view.items.length, 2);
      assert.equal(view.canRetry, false);
      await assert.rejects(retryBatch(db, sup, batch.batch.id, deps(makeQuickbooks().client)), { status: 409, message: /nothing can be retried/ });
    });

    await t.test('a Local driver, an unlinked driver and a non-1099 vendor are blocked, and Desi cash is refused while QuickBooks payments are on', async () => {
      const mixed = await scenario('M', [[dC, '40.00'], [dD, '30.00']]);
      const preview = await previewQuickbooksBatch(db, sup, mixed.run.id, { env: ARMED });
      const codes = (name) => preview.drivers.find((d) => d.driverName === name)?.blockers.map((b) => b.code) ?? [];
      const names = (await db.query('SELECT id, name FROM drivers WHERE id = ANY($1::int[])', [[dC, dD]])).rows;
      assert.ok(codes(names.find((n) => n.id === dC).name).includes('vendor_not_1099'));
      assert.ok(codes(names.find((n) => n.id === dD).name).includes('not_desi'));
      assert.equal(preview.canSubmit, false);
      assert.ok(preview.batchBlockers.some((b) => b.code === 'nobody_to_pay'));
      process.env.QUICKBOOKS_ENABLED = 'true'; process.env.QUICKBOOKS_PAYMENTS_ENABLED = 'true';
      try {
        await assert.rejects(recordRunPayment(db, sup, mixed.run.id, { requestId: randomUUID(), paidOn: '2026-11-08', method: 'cash', reference: 'cash test', statementIds: [(await statement(mixed.run, dC)).id] }), { status: 409, message: /through QuickBooks/ });
      } finally { delete process.env.QUICKBOOKS_PAYMENTS_ENABLED; delete process.env.QUICKBOOKS_ENABLED; }
    });

    await t.test('a refused payment leaves the bill, marks the item failed and the statement retryable; retry pays the same bill and never makes a second one', async () => {
      const part = await scenario('P', [[dA, '20.00'], [dB, '10.00']]);
      let refuse = true;
      const fake = makeQuickbooks({ 71: { payment: () => (refuse ? 'refuse' : 'ok') } });
      const result = await submit(part.run, fake.client);
      assert.deepEqual(result.counts, { submitted: 0, paid: 1, failed: 1, unconfirmed: 0 });
      assert.equal((await statement(part.run, dA)).payout_status, 'failed');
      assert.equal((await statement(part.run, dB)).payout_status, 'paid');
      assert.equal((await item(part.run, dA)).bill_id !== null, true, 'the bill that was made is remembered');
      refuse = false;
      const retried = await retryBatch(db, sup, result.batch.id, deps(fake.client));
      assert.deepEqual(retried.counts, { submitted: 0, paid: 2, failed: 0, unconfirmed: 0 });
      assert.equal(fake.state.bills.length, 2, 'the existing bill was found by its number, not made again');
      assert.equal(fake.state.payments.length, 2);
      assert.equal((await statement(part.run, dA)).payout_status, 'paid');
    });

    await t.test('a lost answer when making the bill is unconfirmed; a retry finds the bill that did land and does not duplicate it', async () => {
      const lost = await scenario('L', [[dA, '15.00']]);
      const fake = makeQuickbooks();
      const realCreate = fake.client.createBill;
      let first = true;
      fake.client.createBill = async (body) => { const bill = await realCreate(body); if (first) { first = false; throw new QuickbooksError('QuickBooks did not answer in time'); } return bill; };
      const result = await submit(lost.run, fake.client);
      assert.deepEqual(result.counts, { submitted: 0, paid: 0, failed: 0, unconfirmed: 1 });
      assert.equal((await statement(lost.run, dA)).payout_status, 'unconfirmed');
      assert.equal(fake.state.bills.length, 1, 'QuickBooks did make the bill');
      const retried = await retryBatch(db, sup, result.batch.id, deps(fake.client));
      assert.deepEqual(retried.counts, { submitted: 0, paid: 1, failed: 0, unconfirmed: 0 });
      assert.equal(fake.state.bills.length, 1);
      assert.equal(fake.state.payments.length, 1);
    });

    await t.test('a bill with this number for another vendor or amount is never trusted', async () => {
      const bad = await scenario('B', [[dB, '12.00']]);
      const fake = makeQuickbooks();
      const sb = await statement(bad.run, dB);
      fake.state.bills.push({ Id: '900', DocNumber: `NASA-S${sb.id}`, TotalAmt: 99, Balance: 99, VendorRef: { value: '72' } });
      const result = await submit(bad.run, fake.client);
      assert.deepEqual(result.counts, { submitted: 0, paid: 0, failed: 0, unconfirmed: 1 });
      assert.equal(fake.state.payments.length, 0, 'nothing was paid against a bill that does not match');
      assert.match((await item(bad.run, dB)).error_message, /another vendor or amount/);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});
