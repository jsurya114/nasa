import logger from '../../../utils/logger.js';
import { fromCents, toCents } from '../../payroll/payRuns/payCalculator.js';
import { PayrollError, assertCityAllowed, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { lockCityPayroll, withTransaction } from '../../payroll/claims/claimsStore.js';
import { approvedWork, invalidWork } from '../../payroll/payRuns/paymentRecords.js';
import { readEvereeConfig } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { computePreview } from './batchPreview.js';
import { DEFAULT_TIME_ZONE, externalIdOf, isTimeZone, payableBody } from './payableRules.js';
import { readyToPay } from './workerRules.js';

// Paying a finalized pay run through Everee (issue #31, part 4). THIS IS THE STEP THAT SENDS MONEY, so it is guarded in layers.
//
// Rules (Jasil, #31 and #202): hosted payroll, so an admin approves the payments in the Everee portal; "Paid" means the money landed (the next
// part reads that back), so nothing here ever sets "paid"; a timeout is "unconfirmed", never "failed"; a statement is never paid twice; the same
// run, city and statement locks as manual recording are used so the two cannot race; no network call is made inside a database transaction.
//
// The order, per confirmed click:
//   1. ONE short transaction: lock the run and the city (the same order as recordRunPayment), repeat the preview and compare its hash (a
//      change is a 409 with the new preview), check the earnings did not change, and RESERVE every statement (`payout_status = submitted`),
//      with the batch and one item per statement written. From here manual recording is blocked for them (payout_in_progress).
//   2. Per item, outside any transaction: write the attempt row FIRST, send the payable with a stable external ID (the idempotency key),
//      then write the answer. 4xx and 429 mean Everee did not take it: `failed`. A timeout, a lost connection or a 5xx means unknown:
//      `unconfirmed`, blocked until reconciled. A crash leaves an unfinished attempt row, which is also "unknown", never "failed".
//   3. ONE request to Everee to pay out exactly this batch's payables (contractors are paid only after it).
// The same request ID returns the same batch and sends nothing again.

const MAX_RATE_LIMIT_RETRIES = 3;
const THROTTLE_MS = 120; // well inside Everee's 100 operations per 5 seconds
const MAX_MESSAGE = 480;

export class PreviewChangedError extends PayrollError {
  constructor(preview) {
    super(409, 'what would be paid has changed since the preview; review the new preview and confirm again');
    this.preview = preview;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const clip = (text) => String(text ?? '').slice(0, MAX_MESSAGE);
let savepointCounter = 0;

// A short transaction on a pool; on a client that is already inside one (the tests) a savepoint, so a failure undoes only this step.
export const inTransaction = async (db, fn) => {
  // A pool has connect() but no release(); a client taken from a pool has both, so connect() alone cannot tell them apart.
  if (typeof db.connect === 'function' && typeof db.release !== 'function') return withTransaction(db, fn);
  const name = `everee_sp_${savepointCounter++}`;
  await db.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn(db);
    await db.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
};

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A 429 means Everee did not run the request, so it is repeated after the wait Everee names (or a growing one, with a little jitter).
export const withRateLimitRetry = async (call, { sleep = defaultSleep } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof EvereeError) || error.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      await sleep(Math.max((error.retryAfterSeconds ?? 0) * 1000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
    }
  }
};

// What an Everee failure means for the payable: not taken (safe to retry) or unknown (must be reconciled).
export const classifyFailure = (error) => {
  if (!(error instanceof EvereeError)) return { outcome: 'unreachable', definite: false, status: null };
  if (error.status === null) return { outcome: /in time/.test(error.message) ? 'timeout' : 'unreachable', definite: false, status: null };
  if (error.status === 429) return { outcome: 'rate_limited', definite: true, status: 429 };
  if (error.status >= 500) return { outcome: 'server_error', definite: false, status: error.status };
  return { outcome: 'refused', definite: true, status: error.status };
};

const requireSuperAdmin = (admin) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can pay through Everee');
};

// ---------- views ----------

const itemView = (row) => ({
  itemId: row.id, statementId: row.pay_statement_id, driverId: row.driver_id, driverName: row.driver_name, amount: row.amount, status: row.status,
  everee: { payableStatus: row.everee_payable_status, payoutRequested: Boolean(row.payout_requested_at), depositReturned: row.deposit_returned },
  attempts: row.attempts, error: row.error_message, lastAttemptAt: row.last_attempt_at,
  paidAt: row.paid_at, payDate: row.everee_pay_date, lastCheckedAt: row.last_checked_at, note: row.check_note,
});

export const getBatchView = async (db, admin, batchId) => {
  requireSuperAdmin(admin);
  const { rows: [batch] } = await db.query(
    `SELECT id, pay_run_id, city_id, environment, driver_count, total::text AS total, created_at, request_id FROM everee_payment_batches WHERE id = $1`, [batchId]);
  if (!batch) throw new PayrollError(404, 'payment batch not found');
  await assertCityAllowed(db, admin, batch.city_id);
  const { rows } = await db.query(
    `SELECT i.id, i.pay_statement_id, i.driver_id, d.name AS driver_name, i.amount::text AS amount, i.status, i.everee_payable_status, i.payout_requested_at,
            i.deposit_returned, i.attempts, i.error_message, i.last_attempt_at, i.paid_at, to_char(i.everee_pay_date, 'YYYY-MM-DD') AS everee_pay_date, i.last_checked_at, i.check_note
       FROM everee_payment_items i JOIN drivers d ON d.id = i.driver_id WHERE i.batch_id = $1 ORDER BY d.name, i.id`, [batchId]);
  const { rows: payouts } = await db.query(
    `SELECT id, started_at, finished_at, asked_count, taken_count, outcome, http_status, everee_request_id, error_message
       FROM everee_payout_requests WHERE batch_id = $1 ORDER BY id DESC LIMIT 5`, [batchId]);
  const items = rows.map(itemView);
  const count = (status) => items.filter((i) => i.status === status).length;
  const waitingForPayout = rows.filter((r) => r.status === 'submitted' && !r.payout_requested_at).length;
  return {
    batch: { id: batch.id, runId: batch.pay_run_id, cityId: batch.city_id, environment: batch.environment, drivers: batch.driver_count, total: batch.total, createdAt: batch.created_at, requestId: batch.request_id },
    counts: { submitted: count('submitted'), paid: count('paid'), failed: count('failed'), unconfirmed: count('unconfirmed') },
    items,
    payoutRequests: payouts,
    // What can be tried again safely: failed items (never taken by Everee) and payables not yet asked to be paid out.
    canRetry: count('failed') > 0 || waitingForPayout > 0,
  };
};

export const listRunBatches = async (db, admin, runId) => {
  requireSuperAdmin(admin);
  const { rows: [run] } = await db.query('SELECT city_id FROM pay_runs WHERE id = $1', [runId]);
  if (!run) throw new PayrollError(404, 'pay run not found');
  await assertCityAllowed(db, admin, run.city_id);
  const { rows } = await db.query('SELECT id FROM everee_payment_batches WHERE pay_run_id = $1 ORDER BY id DESC LIMIT 20', [runId]);
  return { batches: await Promise.all(rows.map((r) => getBatchView(db, admin, r.id))) };
};

// ---------- sending ----------

const finishAttempt = (tx, attemptId, fields) => tx.query(
  `UPDATE everee_payment_attempts SET finished_at = now(), outcome = $2, http_status = $3, everee_request_id = $4, error_message = $5 WHERE id = $1`,
  [attemptId, fields.outcome, fields.httpStatus ?? null, fields.requestId ?? null, fields.message ? clip(fields.message) : null]);

const setStatement = (tx, statementId, to, from) => tx.query('UPDATE pay_statements SET payout_status = $2 WHERE id = $3 AND payout_status = $1', [from, to, statementId]);

// One payable: the attempt is written first, then the request is sent, then the answer is written. Returns the new item status.
const sendItem = async (db, item, batch, deps, client) => {
  const attempt = await inTransaction(db, async (tx) => {
    const { rows: [row] } = await tx.query(
      'UPDATE everee_payment_items SET attempts = attempts + 1, last_attempt_at = now(), updated_at = now() WHERE id = $1 RETURNING attempts', [item.id]);
    const { rows: [a] } = await tx.query('INSERT INTO everee_payment_attempts (item_id, attempt_no) VALUES ($1, $2) RETURNING id', [item.id, row.attempts]);
    return a.id;
  });

  const body = payableBody({
    statementId: item.pay_statement_id, amount: item.amount,
    worker: { workerId: item.everee_worker_id, externalWorkerId: item.external_worker_id },
    periodStart: batch.period_start, periodEnd: batch.period_end, timeZone: batch.time_zone, workLocationId: batch.work_location_id,
  });

  let result;
  try {
    const answer = await withRateLimitRetry(() => client.createPayable(body), deps);
    const echoed = answer.data?.externalId;
    if (echoed !== undefined && echoed !== body.externalId) {
      result = { outcome: 'unexpected_answer', definite: false, status: answer.status, requestId: answer.requestId, message: 'Everee answered for a different payable; reconcile this one' };
    } else {
      result = { outcome: 'accepted', status: answer.status, requestId: answer.requestId, payableStatus: answer.data?.paymentStatus ?? null };
    }
  } catch (error) {
    const kind = classifyFailure(error);
    result = { ...kind, requestId: error.requestId ?? null, message: error.message };
  }

  await inTransaction(db, async (tx) => {
    await finishAttempt(tx, attempt, { outcome: result.outcome, httpStatus: result.status, requestId: result.requestId, message: result.message });
    if (result.outcome === 'accepted') {
      await tx.query('UPDATE everee_payment_items SET everee_payable_status = $2, error_message = NULL, updated_at = now() WHERE id = $1', [item.id, result.payableStatus]);
    } else {
      const status = result.definite === false || result.outcome === 'unexpected_answer' ? 'unconfirmed' : 'failed';
      await tx.query('UPDATE everee_payment_items SET status = $2, error_message = $3, updated_at = now() WHERE id = $1', [item.id, status, clip(result.message)]);
      await setStatement(tx, item.pay_statement_id, status, 'submitted');
    }
  });
  return result.outcome === 'accepted' ? 'submitted' : (result.definite === false || result.outcome === 'unexpected_answer' ? 'unconfirmed' : 'failed');
};

// What Everee says about a payable that the payout request did NOT take. A status that means "already asked for payout" is recorded as that
// (a lost reply to an earlier request); a blocked one (ERROR, the worker cannot be paid, deleted) means the money is not moving and nobody
// knows why from here, so it is "unconfirmed": blocked for manual recording and for a blind retry until someone has looked in Everee.
export const ASKED_FOR_PAYOUT = new Set(['PENDING_APPROVAL', 'PROCESSING', 'READY_TO_CALCULATE', 'PENDING_VERIFICATION', 'PENDING_PAYMENT', 'PENDING_FUNDING', 'PAID']);
export const BLOCKED = new Set(['ERROR', 'UNPAYABLE_WORKER', 'DELETED']);

// Writes what Everee says about a payable. "Already asked for payout" means money is moving: an item that was unconfirmed goes back to submitted.
// A blocked status on a submitted item makes it unconfirmed. Never sets paid: only a payment that landed does (paymentStatus.js).
export const recordPayableStatus = async (tx, item, status) => {
  if (status && ASKED_FOR_PAYOUT.has(status)) {
    await tx.query(
      "UPDATE everee_payment_items SET everee_payable_status = $2, payout_requested_at = COALESCE(payout_requested_at, now()), status = CASE WHEN status = 'unconfirmed' THEN 'submitted' ELSE status END, error_message = CASE WHEN status = 'unconfirmed' THEN NULL ELSE error_message END, updated_at = now() WHERE id = $1",
      [item.id, status]);
    await tx.query("UPDATE pay_statements SET payout_status = 'submitted' WHERE id = $1 AND payout_status = 'unconfirmed'", [item.pay_statement_id]);
  } else if (status && BLOCKED.has(status)) {
    await tx.query("UPDATE everee_payment_items SET everee_payable_status = $2, status = 'unconfirmed', error_message = $3, updated_at = now() WHERE id = $1 AND status = 'submitted'",
      [item.id, status, `Everee reports this payable as ${status}; it was not paid out. Check the worker in Everee before doing anything else.`]);
    await tx.query("UPDATE pay_statements SET payout_status = 'unconfirmed' WHERE id = $1 AND payout_status = 'submitted'", [item.pay_statement_id]);
  } else if (status) {
    // Everee knows the payable (so a create call that got no answer did land) but has not been asked to pay it out yet: it is no longer unknown.
    // It goes back to submitted, and the next "Retry what failed" asks Everee to pay it out. Nothing is created again.
    await tx.query(
      "UPDATE everee_payment_items SET everee_payable_status = $2, status = CASE WHEN status = 'unconfirmed' THEN 'submitted' ELSE status END, error_message = CASE WHEN status = 'unconfirmed' THEN NULL ELSE error_message END, updated_at = now() WHERE id = $1",
      [item.id, status]);
    await tx.query("UPDATE pay_statements SET payout_status = 'submitted' WHERE id = $1 AND payout_status = 'unconfirmed'", [item.pay_statement_id]);
  } else {
    await tx.query('UPDATE everee_payment_items SET everee_payable_status = $2, updated_at = now() WHERE id = $1', [item.id, status]);
  }
};

const inspectUntaken = async (db, items, deps, client) => {
  const sleep = deps.sleep ?? defaultSleep;
  let first = true;
  for (const item of items) {
    if (!first) await sleep(deps.throttleMs ?? THROTTLE_MS);
    first = false;
    let status;
    try {
      status = (await withRateLimitRetry(() => client.getPayable(item.external_id), deps)).data?.paymentStatus ?? null;
    } catch (error) {
      logger.warn('Everee payable status could not be read', { itemId: item.id, reason: error instanceof EvereeError ? error.status : 'unknown' });
      continue; // stays submitted; it is looked at again by the next retry or reconciliation
    }
    await inTransaction(db, (tx) => recordPayableStatus(tx, item, status));
  }
};

// ONE request to pay out the payables of this batch that Everee has accepted and not yet been asked to pay.
const requestPayout = async (db, batchId, deps, client) => {
  const { rows: waiting } = await db.query(
    `SELECT i.id, i.external_id, i.pay_statement_id FROM everee_payment_items i
      WHERE i.batch_id = $1 AND i.status = 'submitted' AND i.payout_requested_at IS NULL
        AND (i.everee_payable_status IS NOT NULL OR EXISTS (SELECT 1 FROM everee_payment_attempts a WHERE a.item_id = i.id AND a.outcome = 'accepted')) ORDER BY i.id`, [batchId]);
  if (waiting.length === 0) return null;
  const { rows: [request] } = await db.query('INSERT INTO everee_payout_requests (batch_id, asked_count) VALUES ($1, $2) RETURNING id', [batchId, waiting.length]);
  const asked = waiting.map((w) => w.external_id);

  let outcome; let taken = null; let status = null; let requestId = null; let message = null;
  try {
    const answer = await withRateLimitRetry(() => client.requestPayout(asked), deps);
    status = answer.status;
    requestId = answer.requestId;
    const named = Array.isArray(answer.data?.payableExternalIds) ? answer.data.payableExternalIds.filter((id) => asked.includes(id)) : [];
    taken = named.length;
    outcome = taken > 0 ? 'requested' : 'nothing_to_process';
    if (taken > 0) {
      await db.query('UPDATE everee_payment_items SET payout_requested_at = now(), updated_at = now() WHERE batch_id = $1 AND external_id = ANY($2::text[])', [batchId, named]);
    }
  } catch (error) {
    const kind = classifyFailure(error);
    outcome = kind.outcome;
    status = kind.status;
    requestId = error.requestId ?? null;
    message = error.message;
  }
  await db.query(
    'UPDATE everee_payout_requests SET finished_at = now(), outcome = $2, taken_count = $3, http_status = $4, everee_request_id = $5, error_message = $6 WHERE id = $1',
    [request.id, outcome, taken, status, requestId, message ? clip(message) : null]);
  // The request ran but did not take everything: look at what Everee says about the payables it left.
  if (outcome === 'requested' || outcome === 'nothing_to_process') {
    const takenIds = new Set(Array.isArray(taken) ? taken : []);
    const { rows: left } = await db.query(
      `SELECT id, external_id, pay_statement_id FROM everee_payment_items WHERE batch_id = $1 AND external_id = ANY($2::text[]) AND payout_requested_at IS NULL AND status = 'submitted' ORDER BY id`, [batchId, asked]);
    await inspectUntaken(db, left.filter((i) => !takenIds.has(i.external_id)), deps, client);
  }
  return outcome;
};

const sendBatch = async (db, batchId, itemIds, deps, client) => {
  const { rows: [batch] } = await db.query(
    `SELECT b.id, b.city_id, to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
            s.time_zone, s.work_location_id
       FROM everee_payment_batches b JOIN pay_runs r ON r.id = b.pay_run_id LEFT JOIN everee_city_settings s ON s.city_id = b.city_id WHERE b.id = $1`, [batchId]);
  batch.time_zone = batch.time_zone ?? DEFAULT_TIME_ZONE;
  const { rows: items } = await db.query(
    `SELECT id, pay_statement_id, everee_worker_id, external_worker_id, amount::text AS amount FROM everee_payment_items WHERE id = ANY($1::bigint[]) ORDER BY id`, [itemIds]);
  const sleep = deps.sleep ?? defaultSleep;
  let first = true;
  for (const item of items) {
    if (!first) await sleep(deps.throttleMs ?? THROTTLE_MS);
    first = false;
    await sendItem(db, item, batch, deps, client);
  }
  await requestPayout(db, batchId, deps, client);
};

// ---------- confirm and pay ----------

const clientFor = (config, deps) => deps.client ?? createEvereeClient(config);

// requestId: made by the confirm click. previewHash: what the admin saw (from the preview endpoint).
export const submitBatch = async (db, admin, { runId, requestId, previewHash }, deps = {}) => {
  requireSuperAdmin(admin);
  if (typeof requestId !== 'string' || !UUID.test(requestId)) throw new PayrollError(400, 'requestId must be a UUID made by the confirm click');
  if (typeof previewHash !== 'string' || !/^[0-9a-f]{64}$/.test(previewHash)) throw new PayrollError(400, 'previewHash must be the hash of the preview that was confirmed');
  const env = deps.env ?? process.env;

  const reserved = await inTransaction(db, async (tx) => {
    // The same order of locks as recordRunPayment: the run, then the city, then the statements and their earning rows.
    const { rows: [run] } = await tx.query('SELECT id, city_id FROM pay_runs WHERE id = $1 FOR UPDATE', [runId]);
    if (!run) throw new PayrollError(404, 'pay run not found');
    await assertCityAllowed(tx, admin, run.city_id);
    await lockCityPayroll(tx, run.city_id);

    const { rows: [prior] } = await tx.query('SELECT id, pay_run_id, created_by, preview_hash FROM everee_payment_batches WHERE request_id = $1', [requestId.toLowerCase()]);
    if (prior) {
      if (String(prior.pay_run_id) !== String(runId) || prior.created_by !== Number(admin.id) || prior.preview_hash !== previewHash) {
        throw new PayrollError(409, 'this confirmation was already used for something else; reopen the preview');
      }
      return { replay: true, batchId: prior.id, itemIds: [] };
    }

    const { result, items, config, gate } = await computePreview(tx, admin, runId, { env });
    if (!gate.enabled) throw new PayrollError(409, `payments to Everee cannot be sent: ${gate.reason}`);
    if (!result.confirm.allowed) throw new PayrollError(403, result.confirm.reason);
    const blocker = result.batchBlockers.find((b) => b.code !== 'payments_off');
    if (blocker) throw new PayrollError(409, blocker.message);
    if (result.previewHash !== previewHash) throw new PreviewChangedError(result);

    const ids = items.map((i) => i.statementId);
    const { rows: locked } = await tx.query(
      `SELECT s.id, s.payout_status, (SELECT count(*) FROM pay_statement_lines l WHERE l.statement_id = s.id AND l.active AND l.line_type = 'earning')::int AS earning_lines
         FROM pay_statements s WHERE s.id = ANY($1::bigint[]) ORDER BY s.id FOR UPDATE`, [ids]);
    if (locked.some((s) => !['not_submitted', 'failed'].includes(s.payout_status))) throw new PayrollError(409, 'a statement changed while the batch was prepared; review the preview again');
    // Lock source rows before derived pay rows (the upload's lock order), then check the earnings are still what was approved.
    await tx.query(
      `SELECT dd.id FROM dashboard_data dd WHERE dd.id IN (
         SELECT pd.dashboard_data_id FROM payment_dashboard pd JOIN pay_statement_lines l ON l.payment_dashboard_id = pd.id
          WHERE l.statement_id = ANY($1::bigint[]) AND l.active AND l.line_type = 'earning') ORDER BY dd.id FOR UPDATE`, [ids]);
    if (invalidWork(locked, await approvedWork(tx, ids, true)).size > 0) throw new PayrollError(409, 'some included earnings changed or are already marked paid; review the run before paying');

    // Reserve: from here the statements are "submitted", which blocks manual recording and any other batch.
    const { rowCount } = await tx.query(
      "UPDATE pay_statements SET payout_status = 'submitted', payout_reference = 'nasa-stmt-' || id::text WHERE id = ANY($1::bigint[]) AND payout_status IN ('not_submitted', 'failed')", [ids]);
    if (rowCount !== ids.length) throw new PayrollError(409, 'a statement changed while the batch was prepared; review the preview again');

    const totalCents = items.reduce((sum, i) => sum + toCents(i.amount), 0);
    const { rows: [batch] } = await tx.query(
      `INSERT INTO everee_payment_batches (request_id, pay_run_id, city_id, environment, preview_hash, driver_count, total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [requestId.toLowerCase(), runId, run.city_id, config.environment, previewHash, items.length, fromCents(totalCents), admin.id]);
    const itemIds = [];
    for (const i of items) {
      const { rows: [row] } = await tx.query(
        `INSERT INTO everee_payment_items (batch_id, pay_statement_id, driver_id, everee_worker_id, external_worker_id, external_id, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [batch.id, i.statementId, i.driverId, i.workerId, i.externalWorkerId, externalIdOf(i.statementId), i.amount]);
      itemIds.push(row.id);
    }
    return { replay: false, batchId: batch.id, itemIds, config };
  });

  if (!reserved.replay) {
    logger.info('Everee batch reserved', { batchId: reserved.batchId, drivers: reserved.itemIds.length });
    const client = clientFor(reserved.config, deps);
    await sendBatch(db, reserved.batchId, reserved.itemIds, deps, client);
  }
  return { replay: reserved.replay, ...(await getBatchView(db, admin, reserved.batchId)) };
};

// ---------- retry what failed ----------

// Tries again ONLY what Everee did not take (failed) and the payout request for payables it did take. Never touches submitted, unconfirmed or
// paid items: an unknown outcome is reconciled first. The same external ID is used, so Everee cannot create a second payable.
export const retryBatch = async (db, admin, batchId, deps = {}) => {
  requireSuperAdmin(admin);
  const env = deps.env ?? process.env;
  const prepared = await inTransaction(db, async (tx) => {
    const { rows: [batch] } = await tx.query('SELECT id, pay_run_id, city_id, environment FROM everee_payment_batches WHERE id = $1', [batchId]);
    if (!batch) throw new PayrollError(404, 'payment batch not found');
    const { rows: [run] } = await tx.query('SELECT id, city_id, finalized_by FROM pay_runs WHERE id = $1 FOR UPDATE', [batch.pay_run_id]);
    await assertCityAllowed(tx, admin, run.city_id);
    await lockCityPayroll(tx, run.city_id);

    const config = readEvereeConfig(env);
    const { gate, result } = await computePreview(tx, admin, batch.pay_run_id, { env }).then((r) => ({ gate: r.gate, result: r.result }));
    if (!gate.enabled) throw new PayrollError(409, `payments to Everee cannot be sent: ${gate.reason}`);
    if (!result.confirm.allowed) throw new PayrollError(403, result.confirm.reason);
    // The same batch-level rules as confirming (a voided run, or a live city without its time zone and work location). "Nobody to pay" is
    // not one of them: the statements of this batch are already in it, so the preview always calls them blocked.
    const batchBlocker = result.batchBlockers.find((b) => ['run_not_finalized', 'city_settings_missing'].includes(b.code));
    if (batchBlocker) throw new PayrollError(409, batchBlocker.message);
    if (config.environment !== batch.environment) throw new PayrollError(409, `this batch was made in ${batch.environment}; the server is set up for ${config.environment}`);

    const { rows: failed } = await tx.query(
      `SELECT i.id, i.pay_statement_id, i.driver_id, i.everee_worker_id, i.external_worker_id, s.payout_status FROM everee_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id
        WHERE i.batch_id = $1 AND i.status = 'failed' ORDER BY i.id FOR UPDATE OF i, s`, [batchId]);
    const retryable = [];
    for (const item of failed) {
      // A statement marked paid by hand in the meantime is never sent; a worker who is no longer ready is not sent either.
      if (item.payout_status !== 'failed') continue;
      const { rows: [link] } = await tx.query(
        `SELECT everee_worker_id, external_worker_id, onboarding_complete, tin_status, terminated FROM everee_workers
          WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NULL`, [item.driver_id, config.environment]);
      if (!link || !readyToPay({ onboardingComplete: link.onboarding_complete, tinStatus: link.tin_status, terminated: link.terminated })) continue;
      // The payable goes to the worker saved on the item. If the driver has been linked to another Everee worker since, that is not the worker
      // whose readiness was just checked, so it is not sent: it stays failed until a person looks.
      if (link.everee_worker_id !== item.everee_worker_id || (link.external_worker_id ?? null) !== (item.external_worker_id ?? null)) {
        await tx.query("UPDATE everee_payment_items SET error_message = $2, updated_at = now() WHERE id = $1",
          [item.id, 'The driver is now linked to a different Everee worker than this payment was made for; it was not sent. Check it before doing anything else.']);
        continue;
      }
      retryable.push(item);
    }
    if (retryable.length > 0) {
      const ids = retryable.map((i) => i.pay_statement_id);
      const locked = (await tx.query(
        `SELECT s.id, (SELECT count(*) FROM pay_statement_lines l WHERE l.statement_id = s.id AND l.active AND l.line_type = 'earning')::int AS earning_lines
           FROM pay_statements s WHERE s.id = ANY($1::bigint[]) ORDER BY s.id`, [ids])).rows;
      if (invalidWork(locked, await approvedWork(tx, ids, true)).size > 0) throw new PayrollError(409, 'some included earnings changed or are already marked paid; review the run before retrying');
      const { rowCount } = await tx.query("UPDATE pay_statements SET payout_status = 'submitted' WHERE id = ANY($1::bigint[]) AND payout_status = 'failed'", [ids]);
      if (rowCount !== ids.length) throw new PayrollError(409, 'a statement changed; refresh the batch');
      await tx.query("UPDATE everee_payment_items SET status = 'submitted', error_message = NULL, updated_at = now() WHERE id = ANY($1::bigint[]) AND status = 'failed'", [retryable.map((i) => i.id)]);
    }
    return { config, itemIds: retryable.map((i) => i.id) };
  });

  const client = clientFor(prepared.config, deps);
  await sendBatch(db, batchId, prepared.itemIds, deps, client);
  logger.info('Everee batch retried', { batchId, retried: prepared.itemIds.length });
  return getBatchView(db, admin, batchId);
};

// ---------- per-city settings ----------

export const getCitySettings = async (db, admin, cityId) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const { rows: [row] } = await db.query('SELECT time_zone, work_location_id FROM everee_city_settings WHERE city_id = $1', [cityId]);
  return { cityId, timeZone: row?.time_zone ?? null, effectiveTimeZone: row?.time_zone ?? DEFAULT_TIME_ZONE, workLocationId: row?.work_location_id ? Number(row.work_location_id) : null };
};

export const setCitySettings = async (db, admin, cityId, { timeZone, workLocationId }) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const zone = timeZone === null || timeZone === undefined || timeZone === '' ? null : timeZone;
  if (zone !== null && !isTimeZone(zone)) throw new PayrollError(400, 'timeZone must be a time zone name such as America/Chicago');
  const location = workLocationId === null || workLocationId === undefined || workLocationId === '' ? null : Number(workLocationId);
  if (location !== null && !(Number.isInteger(location) && location > 0)) throw new PayrollError(400, 'workLocationId must be the number of an Everee work location');
  const { rows: [city] } = await db.query('SELECT 1 FROM city WHERE id = $1', [cityId]);
  if (!city) throw new PayrollError(404, 'city not found');
  await db.query(
    `INSERT INTO everee_city_settings (city_id, time_zone, work_location_id, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (city_id) DO UPDATE SET time_zone = EXCLUDED.time_zone, work_location_id = EXCLUDED.work_location_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [cityId, zone, location, admin.id]);
  return getCitySettings(db, admin, cityId);
};
