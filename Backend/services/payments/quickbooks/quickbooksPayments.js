import logger from '../../../utils/logger.js';
import { fromCents, toCents } from '../../payroll/payRuns/payCalculator.js';
import { PayrollError, assertCityAllowed, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { lockCityPayroll } from '../../payroll/claims/claimsStore.js';
import { reviewRunAsBatch } from '../../payroll/payRuns/payBatchReview.js';
import { approvedWork, invalidWork, lockApprovedEarnings, settlePaidStatements } from '../../payroll/payRuns/paymentRecords.js';
import { methodAllowed, QUICKBOOKS } from '../../payroll/payRuns/driverPaymentRules.js';
import { parseDate } from '../../payroll/ledger/ledgerRules.js';
import { inTransaction } from '../everee/batchSubmit.js';
import { quickbooksPaymentsGate, readQuickbooksConfig } from './quickbooksConfig.js';
import { createQuickbooksClient, QuickbooksError } from './quickbooksClient.js';
import { getAuth } from './connectionStore.js';
import {
  QB_BLOCKERS, UnexpectedAnswerError, billBody, billPaymentBody, billRequestId, clip, classifyFailure, docNumberOf, paymentRequestId, previewHashOf,
} from './paymentRules.js';

// Paying a finalized pay run for DESI drivers by recording each driver's bill and bill payment in QuickBooks (their 1099 record). THIS IS THE STEP THAT
// MARKS DRIVERS PAID, so it is guarded in layers, the same way the Everee batch is:
//   1. ONE short transaction: lock the run and the city, repeat the preview and compare its hash (a change is a 409 with the new preview), check the
//      earnings did not change, and RESERVE every statement (`payout_status = submitted`), with the batch and one item per statement written.
//   2. Per item, outside any transaction: write the attempt row FIRST; find the bill by its number (NASA-S<statement>) or make it; record the payment
//      only if the bill still has a balance; read the bill again and require a zero balance. No second bill or payment can be made, whatever was lost.
//   3. Only then, in a transaction, the statement is marked paid by the one shared function (settlePaidStatements), with the QuickBooks ids as reference.
// A timeout or a 5xx is "unconfirmed", never "failed"; a retry asks QuickBooks first, so it is always safe. The same request ID returns the same batch.

const THROTTLE_MS = 250; // QuickBooks allows 500 requests a minute per company; each item makes at most four
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RATE_LIMIT_RETRIES = 3;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class PreviewChangedError extends PayrollError {
  constructor(preview) {
    super(409, 'what would be recorded has changed since the preview; review the new preview and confirm again');
    this.preview = preview;
  }
}

const requireSuperAdmin = (admin) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can record payments in QuickBooks');
};

const withRateLimitRetry = async (call, { sleep = defaultSleep } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof QuickbooksError) || error.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      await sleep(Math.max((error.retryAfterSeconds ?? 0) * 1000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250));
    }
  }
};

const clientFor = (db, config, deps) => deps.client ?? createQuickbooksClient(config, () => getAuth(db, config, { fetchImpl: deps.fetchImpl }), deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});

// ---------- settings: which QuickBooks accounts the pay is booked to ----------

export const getPaymentSettings = async (db, admin, deps = {}) => {
  requireSuperAdmin(admin);
  const env = deps.env ?? process.env;
  const config = readQuickbooksConfig(env);
  const { rows: [saved] } = await db.query('SELECT expense_account_id, bank_account_id FROM quickbooks_settings WHERE environment = $1', [config.environment]);
  const out = { environment: config.environment, saved: saved ? { expenseAccountId: saved.expense_account_id, bankAccountId: saved.bank_account_id } : null, expenseAccounts: [], bankAccounts: [] };
  if (!config.configured) return out;
  const { rows: [conn] } = await db.query('SELECT 1 FROM quickbooks_connection WHERE environment = $1', [config.environment]);
  if (!conn) return out;
  const client = clientFor(db, config, deps);
  try {
    const pick = (list) => list.map((a) => ({ id: String(a.Id), name: a.Name }));
    out.expenseAccounts = pick(await client.listAccounts('Expense'));
    out.bankAccounts = pick(await client.listAccounts('Bank'));
  } catch (error) {
    if (!(error instanceof QuickbooksError)) throw error;
    throw new PayrollError(502, `${error.message}${error.requestId ? ` (QuickBooks request ${error.requestId})` : ''}`);
  }
  return out;
};

export const savePaymentSettings = async (db, admin, { expenseAccountId, bankAccountId }, deps = {}) => {
  requireSuperAdmin(admin);
  const config = readQuickbooksConfig(deps.env ?? process.env);
  if (!config.configured) throw new PayrollError(409, 'QuickBooks is not set up in the backend settings');
  const current = await getPaymentSettings(db, admin, deps);
  if (!current.expenseAccounts.some((a) => a.id === String(expenseAccountId))) throw new PayrollError(400, 'choose an expense account from the list');
  if (!current.bankAccounts.some((a) => a.id === String(bankAccountId))) throw new PayrollError(400, 'choose a bank account from the list');
  await db.query(
    `INSERT INTO quickbooks_settings (environment, expense_account_id, bank_account_id, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (environment) DO UPDATE SET expense_account_id = EXCLUDED.expense_account_id, bank_account_id = EXCLUDED.bank_account_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [config.environment, String(expenseAccountId), String(bankAccountId), admin.id]);
  return { saved: { expenseAccountId: String(expenseAccountId), bankAccountId: String(bankAccountId) } };
};

// ---------- preview (read-only) ----------

const narrowedTo = (review, statementIds) => {
  if (statementIds === undefined || statementIds === null) return review;
  const wanted = new Set(statementIds.map(String));
  const drivers = review.drivers.filter((d) => wanted.has(String(d.statementId)));
  if (wanted.size === 0 || drivers.length !== wanted.size) throw new PayrollError(400, 'choose statements that belong to this pay run');
  return { ...review, drivers };
};

export const computePreview = async (db, admin, runId, { env = process.env, statementIds: selection } = {}) => {
  requireSuperAdmin(admin);
  const review = narrowedTo(await reviewRunAsBatch(db, admin, runId), selection);
  const config = readQuickbooksConfig(env);
  const gate = quickbooksPaymentsGate(config, env);
  const [{ rows: [conn] }, { rows: [settings] }] = config.configured
    ? await Promise.all([db.query('SELECT realm_id FROM quickbooks_connection WHERE environment = $1', [config.environment]),
      db.query('SELECT expense_account_id, bank_account_id FROM quickbooks_settings WHERE environment = $1', [config.environment])])
    : [{ rows: [] }, { rows: [] }];
  const realmId = conn?.realm_id ?? null;
  const driverIds = review.drivers.map((d) => d.driverId);
  const statementIdList = review.drivers.map((d) => d.statementId);
  const { rows: links } = realmId
    ? await db.query(`SELECT driver_id, vendor_id, vendor_1099 FROM quickbooks_vendors WHERE environment = $1 AND realm_id = $2 AND unlinked_at IS NULL AND driver_id = ANY($3::int[])`, [config.environment, realmId, driverIds])
    : { rows: [] };
  const { rows: sent } = await db.query('SELECT pay_statement_id, status FROM quickbooks_payment_items WHERE pay_statement_id = ANY($1::bigint[])', [statementIdList]);
  const linkOf = new Map(links.map((l) => [l.driver_id, l]));
  const sentOf = new Map(sent.map((i) => [String(i.pay_statement_id), i.status]));

  const drivers = review.drivers.map((d) => {
    const blockers = [...d.blockers];
    const add = (code, extra = {}) => blockers.push({ code, ...QB_BLOCKERS[code], ...extra });
    if (d.driverType !== 'DESI') add('not_desi'); // a driver with no type is already blocked by the review
    if (toCents(d.amounts.net) === 0) add('nothing_to_pay');
    if (sentOf.has(String(d.statementId))) add('in_quickbooks_batch', { itemStatus: sentOf.get(String(d.statementId)) });
    const link = linkOf.get(d.driverId);
    if (!link) add('no_quickbooks_vendor');
    else if (!link.vendor_1099) add('vendor_not_1099');
    return { statementId: d.statementId, driverId: d.driverId, driverName: d.driverName, driverType: d.driverType, amount: d.amounts.net, amounts: d.amounts,
      payoutStatus: d.payoutStatus, vendor: { linked: Boolean(link), vendor1099: link?.vendor_1099 ?? false }, blockers, eligible: !blockers.some((b) => b.severity === 'blocking'),
      _vendorId: link?.vendor_id ?? null };
  });
  const eligible = drivers.filter((d) => d.eligible);
  const batchBlockers = [];
  if (review.run.status !== 'finalized') batchBlockers.push({ code: 'run_not_finalized', message: 'the pay run is not finalized; only a finalized run can be paid' });
  if (!gate.enabled) batchBlockers.push({ code: 'payments_off', message: gate.reason });
  else if (!realmId) batchBlockers.push({ code: 'not_connected', message: 'QuickBooks is not connected' });
  else if (!settings) batchBlockers.push({ code: 'accounts_missing', message: 'choose the QuickBooks expense and bank accounts first' });
  if (eligible.length === 0) batchBlockers.push({ code: 'nobody_to_pay', message: 'no driver in this run can be recorded in QuickBooks right now' });

  const previewHash = realmId
    ? previewHashOf({ runId, environment: config.environment, realmId, items: eligible.map((d) => ({ statementId: d.statementId, driverId: d.driverId, amountCents: toCents(d.amount), vendorId: d._vendorId })) })
    : null;
  const result = {
    readOnly: true,
    environment: config.configured ? config.environment : null,
    run: review.run,
    drivers: drivers.map(({ _vendorId, ...rest }) => rest),
    summary: { drivers: drivers.length, eligible: eligible.length, blocked: drivers.length - eligible.length, total: fromCents(eligible.reduce((n, d) => n + toCents(d.amount), 0)), pendingClaims: review.summary.pendingClaims },
    batchBlockers,
    canSubmit: batchBlockers.length === 0,
    previewHash,
  };
  const items = eligible.map((d) => ({ statementId: d.statementId, driverId: d.driverId, driverName: d.driverName, amount: d.amount, vendorId: d._vendorId }));
  return { result, items, config, gate, realmId, settings };
};

export const previewQuickbooksBatch = async (db, admin, runId, deps = {}) => (await computePreview(db, admin, runId, deps)).result;

// ---------- views ----------

const itemView = (row) => ({ itemId: row.id, statementId: row.pay_statement_id, driverId: row.driver_id, driverName: row.driver_name, amount: row.amount, status: row.status,
  quickbooks: { vendorId: row.vendor_id, billId: row.bill_id, billPaymentId: row.bill_payment_id, docNumber: row.doc_number }, attempts: row.attempts, error: row.error_message, lastAttemptAt: row.last_attempt_at, paidAt: row.paid_at });

export const getBatchView = async (db, admin, batchId) => {
  requireSuperAdmin(admin);
  const { rows: [batch] } = await db.query(
    `SELECT id, pay_run_id, city_id, environment, realm_id, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, driver_count, total::text AS total, created_at, request_id FROM quickbooks_payment_batches WHERE id = $1`, [batchId]);
  if (!batch) throw new PayrollError(404, 'payment batch not found');
  await assertCityAllowed(db, admin, batch.city_id);
  const { rows } = await db.query(
    `SELECT i.id, i.pay_statement_id, i.driver_id, d.name AS driver_name, i.amount::text AS amount, i.status, i.vendor_id, i.doc_number, i.bill_id, i.bill_payment_id,
            i.attempts, i.error_message, i.last_attempt_at, i.paid_at
       FROM quickbooks_payment_items i JOIN drivers d ON d.id = i.driver_id WHERE i.batch_id = $1 ORDER BY d.name, i.id`, [batchId]);
  const items = rows.map(itemView);
  const count = (status) => items.filter((i) => i.status === status).length;
  return {
    batch: { id: batch.id, runId: batch.pay_run_id, cityId: batch.city_id, environment: batch.environment, realmId: batch.realm_id, paidOn: batch.paid_on, drivers: batch.driver_count, total: batch.total, createdAt: batch.created_at, requestId: batch.request_id },
    counts: { submitted: count('submitted'), paid: count('paid'), failed: count('failed'), unconfirmed: count('unconfirmed') },
    items,
    canRetry: count('failed') + count('unconfirmed') > 0,
  };
};

export const listRunBatches = async (db, admin, runId) => {
  requireSuperAdmin(admin);
  const { rows: [run] } = await db.query('SELECT city_id FROM pay_runs WHERE id = $1', [runId]);
  if (!run) throw new PayrollError(404, 'pay run not found');
  await assertCityAllowed(db, admin, run.city_id);
  const { rows } = await db.query('SELECT id FROM quickbooks_payment_batches WHERE pay_run_id = $1 ORDER BY id DESC LIMIT 20', [runId]);
  return { batches: await Promise.all(rows.map((r) => getBatchView(db, admin, r.id))) };
};

// ---------- sending ----------

const finishAttempt = (tx, attemptId, f) => tx.query(
  'UPDATE quickbooks_payment_attempts SET finished_at = now(), outcome = $2, http_status = $3, intuit_tid = $4, error_message = $5 WHERE id = $1',
  [attemptId, f.outcome, f.httpStatus ?? null, f.requestId ?? null, f.message ? clip(f.message) : null]);
const setStatement = (tx, id, to, from) => tx.query('UPDATE pay_statements SET payout_status = $2 WHERE id = $3 AND payout_status = $1', [from, to, id]);
const cents = (value) => Math.round(Number(value) * 100);

// Finds the bill by its number, or makes it. A bill that exists must be this driver's vendor and this amount, or the answer is not trusted.
const ensureBill = async (db, item, batch, accounts, deps, client) => {
  const found = (await withRateLimitRetry(() => client.findBillsByDocNumber(item.doc_number), deps)).filter((b) => b.DocNumber === item.doc_number);
  if (found.length > 1) throw new UnexpectedAnswerError('QuickBooks has more than one bill with this number; reconcile it in QuickBooks');
  let bill = found[0];
  if (bill) {
    if (String(bill.VendorRef?.value) !== String(item.vendor_id) || cents(bill.TotalAmt) !== cents(item.amount)) {
      throw new UnexpectedAnswerError('QuickBooks has a bill with this number for another vendor or amount; reconcile it in QuickBooks');
    }
  } else {
    bill = await withRateLimitRetry(() => client.createBill(billBody({ statementId: item.pay_statement_id, vendorId: item.vendor_id, amount: item.amount, paidOn: batch.paid_on, expenseAccountId: accounts.expense_account_id,
      runId: batch.pay_run_id, periodStart: batch.period_start, periodEnd: batch.period_end }), billRequestId(item.pay_statement_id)), deps);
    if (!bill?.Id || cents(bill.TotalAmt) !== cents(item.amount)) throw new UnexpectedAnswerError('QuickBooks answered for a different bill; reconcile this one');
  }
  await db.query('UPDATE quickbooks_payment_items SET bill_id = $2, updated_at = now() WHERE id = $1', [item.id, String(bill.Id)]);
  return bill;
};

// Records the payment only when the bill still has a balance, then reads the bill again and requires a zero balance.
const ensurePaid = async (db, item, batch, accounts, bill, deps, client) => {
  let paymentId = null;
  if (cents(bill.Balance) > 0) {
    const payment = await withRateLimitRetry(() => client.createBillPayment(billPaymentBody({ statementId: item.pay_statement_id, vendorId: item.vendor_id, amount: item.amount, paidOn: batch.paid_on,
      bankAccountId: accounts.bank_account_id, billId: bill.Id }), paymentRequestId(item.pay_statement_id)), deps);
    paymentId = payment?.Id ? String(payment.Id) : null;
  }
  const after = (await withRateLimitRetry(() => client.findBillsByDocNumber(item.doc_number), deps)).find((b) => b.DocNumber === item.doc_number);
  if (!after || cents(after.Balance) !== 0) throw new UnexpectedAnswerError('the bill still shows a balance in QuickBooks; reconcile it before paying again');
  return paymentId;
};

const sendItem = async (db, item, batch, accounts, deps, client) => {
  const attempt = await inTransaction(db, async (tx) => {
    await tx.query('SELECT id FROM pay_runs WHERE id = $1 FOR UPDATE', [batch.pay_run_id]);
    await lockCityPayroll(tx, batch.city_id);
    const { rows: [fresh] } = await tx.query(
      `SELECT i.status AS item_status, s.payout_status FROM quickbooks_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id WHERE i.id = $1 FOR UPDATE OF i, s`, [item.id]);
    if (!fresh || fresh.item_status !== 'submitted' || fresh.payout_status !== 'submitted') return null;
    const { rows: [row] } = await tx.query('UPDATE quickbooks_payment_items SET attempts = attempts + 1, last_attempt_at = now(), updated_at = now() WHERE id = $1 RETURNING attempts', [item.id]);
    const { rows: [a] } = await tx.query('INSERT INTO quickbooks_payment_attempts (item_id, attempt_no) VALUES ($1, $2) RETURNING id', [item.id, row.attempts]);
    return a.id;
  });
  if (attempt === null) {
    logger.warn('QuickBooks item is no longer reserved for sending, so nothing was sent', { itemId: item.id });
    return 'skipped';
  }

  let result;
  try {
    const bill = await ensureBill(db, item, batch, accounts, deps, client);
    const paymentId = await ensurePaid(db, item, batch, accounts, bill, deps, client);
    result = { outcome: 'paid', billId: String(bill.Id), paymentId };
  } catch (error) {
    result = { ...classifyFailure(error), requestId: error.requestId ?? null, message: error.message };
  }

  return inTransaction(db, async (tx) => {
    await finishAttempt(tx, attempt, { outcome: result.outcome, httpStatus: result.status, requestId: result.requestId, message: result.message });
    if (result.outcome === 'paid') {
      // The earnings are re-checked and locked in the same order as manual recording; the one shared function marks the statement paid.
      await tx.query('SELECT id FROM pay_runs WHERE id = $1 FOR UPDATE', [batch.pay_run_id]);
      await lockCityPayroll(tx, batch.city_id);
      const { rows: [statement] } = await tx.query(
        `SELECT s.*, (SELECT count(*) FROM pay_statement_lines l WHERE l.statement_id = s.id AND l.active AND l.line_type = 'earning')::int AS earning_lines FROM pay_statements s WHERE s.id = $1 FOR UPDATE`, [item.pay_statement_id]);
      const earnings = await lockApprovedEarnings(tx, [item.pay_statement_id]);
      if (statement.payout_status !== 'submitted' || invalidWork([statement], earnings).size > 0) {
        const message = 'recorded in QuickBooks, but the included earnings changed; review this statement before doing anything else';
        await tx.query("UPDATE quickbooks_payment_items SET status = 'unconfirmed', bill_payment_id = $2, error_message = $3, updated_at = now() WHERE id = $1", [item.id, result.paymentId, message]);
        await setStatement(tx, item.pay_statement_id, 'unconfirmed', 'submitted');
        return 'unconfirmed';
      }
      await settlePaidStatements(tx, { statementIds: [item.pay_statement_id], earnings, paidOn: batch.paid_on, reference: `QuickBooks bill ${result.billId}` });
      await tx.query("UPDATE quickbooks_payment_items SET status = 'paid', bill_payment_id = $2, error_message = NULL, paid_at = now(), updated_at = now() WHERE id = $1", [item.id, result.paymentId]);
      return 'paid';
    }
    const status = result.definite === false ? 'unconfirmed' : 'failed';
    await tx.query('UPDATE quickbooks_payment_items SET status = $2, error_message = $3, updated_at = now() WHERE id = $1', [item.id, status, clip(result.message)]);
    await setStatement(tx, item.pay_statement_id, status, 'submitted');
    return status;
  });
};

const sendBatch = async (db, batchId, itemIds, deps, client) => {
  const { rows: [batch] } = await db.query(
    `SELECT b.id, b.city_id, b.pay_run_id, to_char(b.paid_on, 'YYYY-MM-DD') AS paid_on, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            b.environment FROM quickbooks_payment_batches b JOIN pay_runs r ON r.id = b.pay_run_id WHERE b.id = $1`, [batchId]);
  const { rows: [accounts] } = await db.query('SELECT expense_account_id, bank_account_id FROM quickbooks_settings WHERE environment = $1', [batch.environment]);
  if (!accounts) throw new PayrollError(409, 'choose the QuickBooks expense and bank accounts first');
  const { rows: items } = await db.query('SELECT id, pay_statement_id, vendor_id, doc_number, amount::text AS amount FROM quickbooks_payment_items WHERE id = ANY($1::bigint[]) ORDER BY id', [itemIds]);
  const sleep = deps.sleep ?? defaultSleep;
  let first = true;
  for (const item of items) {
    if (!first) await sleep(deps.throttleMs ?? THROTTLE_MS);
    first = false;
    await sendItem(db, item, batch, accounts, deps, client);
  }
};

// ---------- confirm and record ----------

export const submitBatch = async (db, admin, { runId, requestId, previewHash, paidOn, statementIds }, deps = {}) => {
  requireSuperAdmin(admin);
  if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new PayrollError(400, 'requestId must be a UUID made by the confirm click');
  if (typeof previewHash !== 'string' || !/^[0-9a-f]{64}$/.test(previewHash)) throw new PayrollError(400, 'previewHash must be the hash of the preview that was confirmed');
  const paid = parseDate(paidOn);
  if (!paid) throw new PayrollError(400, 'choose the date the drivers were paid');
  const env = deps.env ?? process.env;

  const reserved = await inTransaction(db, async (tx) => {
    const { rows: [run] } = await tx.query('SELECT id, city_id FROM pay_runs WHERE id = $1 FOR UPDATE', [runId]);
    if (!run) throw new PayrollError(404, 'pay run not found');
    await assertCityAllowed(tx, admin, run.city_id);
    await lockCityPayroll(tx, run.city_id);
    const { rows: [prior] } = await tx.query('SELECT id, pay_run_id, created_by, preview_hash, to_char(paid_on, \'YYYY-MM-DD\') AS paid_on FROM quickbooks_payment_batches WHERE request_id = $1', [requestId.toLowerCase()]);
    if (prior) {
      if (String(prior.pay_run_id) !== String(runId) || prior.created_by !== Number(admin.id) || prior.preview_hash !== previewHash || prior.paid_on !== paid) {
        throw new PayrollError(409, 'this confirmation was already used for something else; reopen the preview');
      }
      return { replay: true, batchId: prior.id, itemIds: [] };
    }
    const { rows: [today] } = await tx.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d");
    if (paid > today.d) throw new PayrollError(400, 'the payment date cannot be in the future');

    const { result, items, config, gate, realmId } = await computePreview(tx, admin, runId, { env, statementIds });
    if (!gate.enabled) throw new PayrollError(409, `payments cannot be recorded in QuickBooks: ${gate.reason}`);
    const blocker = result.batchBlockers.find((b) => b.code !== 'payments_off');
    if (blocker) throw new PayrollError(409, blocker.message);
    if (result.previewHash !== previewHash) throw new PreviewChangedError(result);

    const ids = items.map((i) => i.statementId);
    // Defence in depth: the drivers are read again under a share lock and only a driver whose type allows QuickBooks (a Desi driver) is ever recorded.
    const { rows: typed } = await tx.query(`SELECT s.id, d.driver_type FROM pay_statements s JOIN drivers d ON d.id = s.driver_id WHERE s.id = ANY($1::bigint[]) ORDER BY s.id FOR SHARE OF d`, [ids]);
    if (typed.length !== ids.length || typed.some((r) => !methodAllowed(r.driver_type, QUICKBOOKS) || r.driver_type !== 'DESI')) throw new PayrollError(409, 'only Desi drivers are recorded in QuickBooks; a selected driver is Local or has no driver type');
    const typeOf = new Map(typed.map((r) => [String(r.id), r.driver_type]));
    const { rows: locked } = await tx.query(
      `SELECT s.id, s.payout_status, (SELECT count(*) FROM pay_statement_lines l WHERE l.statement_id = s.id AND l.active AND l.line_type = 'earning')::int AS earning_lines FROM pay_statements s WHERE s.id = ANY($1::bigint[]) ORDER BY s.id FOR UPDATE`, [ids]);
    if (locked.some((s) => !['not_submitted', 'failed'].includes(s.payout_status))) throw new PayrollError(409, 'a statement changed while the batch was prepared; review the preview again');
    await tx.query(`SELECT dd.id FROM dashboard_data dd WHERE dd.id IN (SELECT pd.dashboard_data_id FROM payment_dashboard pd JOIN pay_statement_lines l ON l.payment_dashboard_id = pd.id WHERE l.statement_id = ANY($1::bigint[]) AND l.active AND l.line_type = 'earning') ORDER BY dd.id FOR UPDATE`, [ids]);
    if (invalidWork(locked, await approvedWork(tx, ids, true)).size > 0) throw new PayrollError(409, 'some included earnings changed or are already marked paid; review the run before paying');

    const { rowCount } = await tx.query("UPDATE pay_statements SET payout_status = 'submitted', payout_reference = 'nasa-qb-' || id::text WHERE id = ANY($1::bigint[]) AND payout_status IN ('not_submitted', 'failed')", [ids]);
    if (rowCount !== ids.length) throw new PayrollError(409, 'a statement changed while the batch was prepared; review the preview again');

    const totalCents = items.reduce((n, i) => n + toCents(i.amount), 0);
    const { rows: [batch] } = await tx.query(
      `INSERT INTO quickbooks_payment_batches (request_id, pay_run_id, city_id, environment, realm_id, preview_hash, paid_on, driver_count, total, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [requestId.toLowerCase(), runId, run.city_id, config.environment, realmId, previewHash, paid, items.length, fromCents(totalCents), admin.id]);
    const itemIds = [];
    for (const i of items) {
      const { rows: [row] } = await tx.query(
        `INSERT INTO quickbooks_payment_items (batch_id, pay_statement_id, driver_id, driver_type, vendor_id, doc_number, amount) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [batch.id, i.statementId, i.driverId, typeOf.get(String(i.statementId)), i.vendorId, docNumberOf(i.statementId), i.amount]);
      itemIds.push(row.id);
    }
    return { replay: false, batchId: batch.id, itemIds, config };
  });

  if (!reserved.replay) {
    logger.info('QuickBooks batch reserved', { batchId: reserved.batchId, drivers: reserved.itemIds.length });
    await sendBatch(db, reserved.batchId, reserved.itemIds, deps, clientFor(db, reserved.config, deps));
  }
  return { replay: reserved.replay, ...(await getBatchView(db, admin, reserved.batchId)) };
};

// ---------- retry what failed or is unconfirmed ----------

// Failed and unconfirmed items are tried again. This is always safe: each attempt asks QuickBooks for the bill by number and for its balance first, so a
// bill or payment that did land is found and never made twice. Paid and submitted (in flight) items are never touched.
export const retryBatch = async (db, admin, batchId, deps = {}) => {
  requireSuperAdmin(admin);
  const env = deps.env ?? process.env;
  const prepared = await inTransaction(db, async (tx) => {
    const { rows: [batch] } = await tx.query('SELECT id, pay_run_id, city_id, environment FROM quickbooks_payment_batches WHERE id = $1', [batchId]);
    if (!batch) throw new PayrollError(404, 'payment batch not found');
    const { rows: [run] } = await tx.query('SELECT id, city_id, status FROM pay_runs WHERE id = $1 FOR UPDATE', [batch.pay_run_id]);
    await assertCityAllowed(tx, admin, run.city_id);
    await lockCityPayroll(tx, run.city_id);
    const config = readQuickbooksConfig(env);
    const gate = quickbooksPaymentsGate(config, env);
    if (!gate.enabled) throw new PayrollError(409, `payments cannot be recorded in QuickBooks: ${gate.reason}`);
    if (run.status !== 'finalized') throw new PayrollError(409, 'the pay run is not finalized; only a finalized run can be paid');
    if (config.environment !== batch.environment) throw new PayrollError(409, `this batch was made in ${batch.environment}; the server is set up for ${config.environment}`);
    const { rows: open } = await tx.query(
      `SELECT i.id, i.pay_statement_id, i.status, s.payout_status, d.driver_type, v.vendor_id AS live_vendor
         FROM quickbooks_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id JOIN drivers d ON d.id = i.driver_id
         LEFT JOIN quickbooks_vendors v ON v.driver_id = i.driver_id AND v.environment = $2 AND v.unlinked_at IS NULL AND v.vendor_id = i.vendor_id
        WHERE i.batch_id = $1 AND i.status IN ('failed', 'unconfirmed') ORDER BY i.id FOR UPDATE OF i, s FOR SHARE OF d`, [batchId, batch.environment]);
    const retryable = open.filter((i) => i.payout_status === i.status && i.driver_type === 'DESI' && i.live_vendor);
    if (retryable.length === 0) throw new PayrollError(409, 'nothing can be retried: the items are paid, in progress, or their vendor link changed');
    for (const item of retryable) {
      await tx.query("UPDATE quickbooks_payment_items SET status = 'submitted', error_message = NULL, updated_at = now() WHERE id = $1", [item.id]);
      await setStatement(tx, item.pay_statement_id, 'submitted', item.status);
    }
    return { config, itemIds: retryable.map((i) => i.id) };
  });
  await sendBatch(db, batchId, prepared.itemIds, deps, clientFor(db, prepared.config, deps));
  return getBatchView(db, admin, batchId);
};
