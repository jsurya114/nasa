import logger from '../../../utils/logger.js';
import { fromCents, toCents } from '../../payroll/payRuns/payCalculator.js';
import { PayrollError, assertCityAllowed, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import { lockCityPayroll } from '../../payroll/claims/claimsStore.js';
import { invalidWork, lockApprovedEarnings, settlePaidStatements } from '../../payroll/payRuns/paymentRecords.js';
import { readEvereeConfig } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { DEFAULT_TIME_ZONE } from './payableRules.js';
import { clip, defaultSleep, inTransaction, recordPayableStatus, withRateLimitRetry } from './batchSubmit.js';
import { isPaymentId, readPayable, readPayoutState } from './paymentState.js';

// Reading payments back from Everee (issue #31, part 5). The only place where an Everee item becomes "paid", and it happens only when
// Everee's Payment Data API says EVERY payout of the payment is PAID (money deposited), never because we sent something or an event said so.
// Events (webhooks) are only a prompt to look again: what they say is not trusted, Everee is asked.
//
//  - A payable's status moves a blocked item to "unconfirmed" and an item Everee is processing back to "submitted" (recordPayableStatus).
//  - A payment Everee has not processed yet is 404: wait. PENDING: wait. Some payout FAILED (a bank returned the deposit): flag it, never paid.
//  - All PAID: ONE transaction with the same locks as manual recording (run, city, statement, source rows) marks the statement paid through the
//    shared settlePaidStatements. Frozen amounts, deductions and debt are never recalculated.
//  - A deposit returned after "paid" cannot un-pay history: the item is flagged for a person; the flag clears when the retry settles.
//  - A payout total that is readable and differs from what we sent is NOT paid: it is left for a person to look at.

const OPEN = ['submitted', 'unconfirmed'];
const CHECK_INTERVAL_MINUTES = 15; // how often the scheduled check looks again at an item (and the age before it does)
const MAX_PER_SCAN = 40;
const MAX_PER_EVENT = 10; // Everee waits only a short while for the answer to a webhook; the scheduled check does the rest
const THROTTLE_MS = 120;
// An item that Everee has not been asked to pay out may still be on its way (a batch is being sent right now). Only after this long is the silence
// treated as "the answer was lost" and looked into, so a scan never races the send that is still running.
const UNCERTAIN_AFTER_MINUTES = 5;
// Items worth looking at: waiting or returned ones that either have a payment to read or were asked for payout, or whose answer has been missing a while.
// Placeholders: $2 is the list of waiting statuses.
const DUE_SQL = `(i.status = ANY($2::text[]) OR (i.status = 'paid' AND i.deposit_returned))
  AND (i.everee_payment_id IS NOT NULL OR i.payout_requested_at IS NOT NULL
       OR (COALESCE(i.last_attempt_at, i.created_at) < now() - make_interval(mins => ${UNCERTAIN_AFTER_MINUTES}) AND COALESCE(i.send_lease_until, 'epoch') < now()))`;

const note = (tx, itemId, text, extra = '') => tx.query(
  `UPDATE everee_payment_items SET check_note = $2, last_checked_at = now(), updated_at = now() ${extra} WHERE id = $1`, [itemId, text ? clip(text).slice(0, 300) : null]);

const loadItem = async (db, itemId) => (await db.query(
  `SELECT i.id, i.status, i.pay_statement_id, i.external_id, i.everee_worker_id, i.everee_payment_id, i.payment_link, i.everee_payable_status, i.deposit_returned, i.amount::text AS amount,
          i.payout_requested_at, i.external_worker_id, b.pay_run_id, b.city_id, b.environment, s.time_zone,
          (SELECT count(*) FROM everee_payment_attempts a WHERE a.item_id = i.id AND a.outcome = 'accepted')::int AS accepted_attempts,
          (i.payout_requested_at IS NULL AND (COALESCE(i.last_attempt_at, i.created_at) >= now() - make_interval(mins => ${UNCERTAIN_AFTER_MINUTES}) OR COALESCE(i.send_lease_until, 'epoch') >= now())) AS may_be_sending
     FROM everee_payment_items i JOIN everee_payment_batches b ON b.id = i.batch_id LEFT JOIN everee_city_settings s ON s.city_id = b.city_id WHERE i.id = $1`, [itemId])).rows[0];

// Marks the statement and item paid in one transaction. Returns what happened.
const completePaid = (db, item, paymentId, payDate) => inTransaction(db, async (tx) => {
  await tx.query('SELECT id FROM pay_runs WHERE id = $1 FOR UPDATE', [item.pay_run_id]); // run, then city, then statements: as manual recording
  await lockCityPayroll(tx, item.city_id);
  const { rows: [fresh] } = await tx.query(
    `SELECT i.status AS item_status, s.id, s.driver_id, s.payout_status,
            (SELECT count(*) FROM pay_statement_lines l WHERE l.statement_id = s.id AND l.active AND l.line_type = 'earning')::int AS earning_lines
       FROM everee_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id WHERE i.id = $1 FOR UPDATE OF i, s`, [item.id]);
  if (fresh.item_status === 'paid') return 'already_paid';
  if (!OPEN.includes(fresh.item_status) || !OPEN.includes(fresh.payout_status)) return 'not_completable';
  const earnings = await lockApprovedEarnings(tx, [fresh.id]);
  const changed = invalidWork([fresh], earnings).size > 0;
  const zone = item.time_zone ?? DEFAULT_TIME_ZONE; // the pay date is a date in the city's time zone, not the server's
  const paidOn = payDate ?? (await tx.query("SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d", [zone])).rows[0].d;
  await settlePaidStatements(tx, { statementIds: [fresh.id], earnings: changed ? [] : earnings, paidOn, reference: clip(`everee:${paymentId}`).slice(0, 200) });
  await tx.query(
    `UPDATE everee_payment_items SET status = 'paid', paid_at = now(), everee_payment_id = $2, everee_pay_date = $3, deposit_returned = false, error_message = NULL,
            check_note = $4, last_checked_at = now(), updated_at = now() WHERE id = $1`,
    [item.id, paymentId, paidOn, changed ? 'Paid in Everee. Some included earnings changed after approval, so their rows were left as they were: review this run.' : null]);
  return changed ? 'paid_review' : 'paid';
});

// Everee has no record of a payable whose create call got no answer, so it was never created: the item and statement become `failed`, which is
// what "Retry what failed" takes. The same external ID is used again, so Everee cannot create a second payable. Same lock order as manual recording.
const markNeverCreated = (db, item) => inTransaction(db, async (tx) => {
  await tx.query('SELECT id FROM pay_runs WHERE id = $1 FOR UPDATE', [item.pay_run_id]);
  await lockCityPayroll(tx, item.city_id);
  const { rows: [fresh] } = await tx.query(
    `SELECT i.status AS item_status, i.payout_requested_at, s.payout_status,
            (COALESCE(i.last_attempt_at, i.created_at) >= now() - make_interval(mins => ${UNCERTAIN_AFTER_MINUTES}) OR COALESCE(i.send_lease_until, 'epoch') >= now()) AS owned,
            EXISTS (SELECT 1 FROM everee_payment_attempts a WHERE a.item_id = i.id AND a.outcome = 'accepted') AS accepted
       FROM everee_payment_items i JOIN pay_statements s ON s.id = i.pay_statement_id WHERE i.id = $1 FOR UPDATE OF i, s`, [item.id]);
  // Checked again under the locks: a sender may have taken the item since it was read, and then it is not ours to release.
  if (!OPEN.includes(fresh.item_status) || !OPEN.includes(fresh.payout_status) || fresh.payout_requested_at || fresh.owned || fresh.accepted) return 'not_failable';
  await tx.query(
    `UPDATE everee_payment_items SET status = 'failed', error_message = $2, check_note = NULL, last_checked_at = now(), updated_at = now() WHERE id = $1`,
    [item.id, 'Everee has no record of this payable, so it was never created. It can be sent again with "Retry what failed".']);
  await tx.query("UPDATE pay_statements SET payout_status = 'failed' WHERE id = $1 AND payout_status = ANY($2::text[])", [item.pay_statement_id, OPEN]);
  return 'never_created';
});

// Looks again at one item. Never throws for an Everee problem: it is written as a note and the item keeps its status.
// `deps.environment` is the environment the Everee client belongs to; an item of another environment is never looked at with it.
export const reconcileItem = async (db, itemId, deps = {}, client) => {
  const item = await loadItem(db, itemId);
  if (!item) return 'unknown_item';
  if (!OPEN.includes(item.status) && !(item.status === 'paid' && item.everee_payment_id)) return 'skipped';
  const environment = deps.environment ?? readEvereeConfig(deps.env ?? process.env).environment;
  if (item.environment !== environment) {
    logger.warn('Everee item belongs to another environment, not looked at', { itemId: item.id, itemEnvironment: item.environment });
    return 'wrong_environment';
  }

  let paymentId = item.everee_payment_id;
  if (!paymentId) {
    if (item.may_be_sending) return 'too_recent'; // a send may still be running; it is looked at again later
    try {
      const { data } = await withRateLimitRetry(() => client.getPayable(item.external_id), deps);
      const payable = readPayable(data);
      await inTransaction(db, (tx) => recordPayableStatus(tx, item, payable.paymentStatus));
      paymentId = payable.paymentId;
      if (paymentId) {
        await db.query("UPDATE everee_payment_items SET everee_payment_id = $2, payment_link = 'payable', updated_at = now() WHERE id = $1 AND everee_payment_id IS NULL", [item.id, paymentId]);
        item.payment_link = item.payment_link ?? 'payable';
      }
    } catch (error) {
      // 404: Everee never created it. Only when no create call was ever accepted and no payout was asked for; otherwise it is a puzzle for a person.
      if (error instanceof EvereeError && error.status === 404 && OPEN.includes(item.status) && item.accepted_attempts === 0 && !item.payout_requested_at) {
        const outcome = await markNeverCreated(db, item);
        if (outcome === 'never_created') logger.info('Everee has no record of the payable; marked failed so it can be retried', { itemId: item.id });
        return outcome;
      }
      const why = error instanceof EvereeError ? (error.status ?? 'no answer') : 'error';
      logger.warn('Everee payable could not be read', { itemId: item.id, reason: why });
      await note(db, item.id, `Everee's payable could not be read (${why}); it is looked at again later. Nothing was changed.`);
      return 'unreadable';
    }
  }
  if (!paymentId) {
    await note(db, item.id, 'Everee has not put this payable in a payment yet.');
    return 'waiting';
  }

  let body;
  try {
    ({ data: body } = await withRateLimitRetry(() => client.getPaymentHistoryItem(paymentId), deps));
  } catch (error) {
    if (error instanceof EvereeError && error.status === 404) {
      await note(db, item.id, 'Everee has not processed this payment for deposit yet.');
      return 'not_processed';
    }
    const why = error instanceof EvereeError ? (error.status ?? 'no answer') : 'error';
    logger.warn('Everee payment could not be read', { itemId: item.id, reason: why });
    await note(db, item.id, `Everee's payment could not be read (${why}); it is looked at again later. Nothing was changed.`);
    return 'unreadable';
  }

  const payout = readPayoutState(body);
  if (payout.state === 'unknown') {
    await note(db, item.id, "Everee's answer for this payment was not understood, so it is not marked paid. Check it in Everee.");
    return 'unknown';
  }
  if (payout.state === 'pending') {
    await note(db, item.id, 'Everee has the payment; the deposit is not complete yet.');
    return 'pending';
  }
  if (payout.state === 'returned') {
    await note(db, item.id, "A bank returned this deposit. It is not paid until the driver's bank details are fixed and Everee's retry settles.", ', deposit_returned = true');
    return 'returned';
  }
  // The payment must be this item's worker's, when the answer says whose it is.
  if (payout.workerId !== null && payout.workerId !== String(item.everee_worker_id)) {
    await note(db, item.id, "Everee's payment belongs to a different worker than this payment was made for, so it is not marked paid. Check it in Everee.");
    return 'unknown';
  }
  // Landed. An answer without its amount is not enough in production (the real answer shape is not proven yet), nor for a payment found only
  // through an event: it stays "unknown" until the amount can be read and matches.
  if (payout.netCents === null && (item.environment === 'production' || item.payment_link === 'event')) {
    await note(db, item.id, "Everee's answer for this payment did not state the amount, so it is not marked paid. Check it in Everee.");
    return 'unknown';
  }
  // The amount, when Everee states it, must be exactly what this item froze (a worker's payment may hold only our item or several).
  if (payout.netCents !== null && payout.netCents !== toCents(item.amount)) {
    const { rows: [sum] } = await db.query('SELECT COALESCE(SUM(amount), 0)::text AS total FROM everee_payment_items WHERE everee_payment_id = $1', [paymentId]);
    if (payout.netCents !== toCents(sum.total)) {
      await note(db, item.id, `Everee paid ${fromCents(payout.netCents)} for this payment but ${sum.total} was sent. It is not marked paid; check it in Everee.`);
      return 'amount_differs';
    }
  }
  if (item.status === 'paid') { // already paid: the only change is a returned deposit that has since settled
    if (!item.deposit_returned) return 'unchanged';
    await db.query("UPDATE everee_payment_items SET deposit_returned = false, check_note = 'The returned deposit was retried and has settled.', last_checked_at = now(), updated_at = now() WHERE id = $1", [item.id]);
    return 'retry_settled';
  }
  const done = await completePaid(db, item, paymentId, payout.payDate);
  logger.info('Everee payment confirmed as landed', { itemId: item.id, outcome: done });
  return done;
};

// Looks at several items, one after another, gently (Everee allows 100 operations per 5 seconds per token).
export const reconcileItems = async (db, itemIds, deps = {}, client) => {
  const sleep = deps.sleep ?? defaultSleep;
  const results = {};
  let first = true;
  for (const id of itemIds) {
    if (!first) await sleep(deps.throttleMs ?? THROTTLE_MS);
    first = false;
    let outcome;
    try {
      outcome = await reconcileItem(db, id, deps, client);
    } catch (error) {
      logger.error('Everee reconciliation of an item failed', { itemId: id, message: error.message });
      outcome = 'error';
    }
    results[outcome] = (results[outcome] ?? 0) + 1;
  }
  return results;
};

// The scheduled check: items still waiting, or returned and not settled, that were not looked at in the last interval.
export const checkOpenItems = async (db, deps = {}) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  if (!config.configured || String(env.EVEREE_PAYMENTS_ENABLED ?? '').toLowerCase() !== 'true') return { skipped: true };
  const { rows } = await db.query(
    `SELECT i.id FROM everee_payment_items i JOIN everee_payment_batches b ON b.id = i.batch_id
      WHERE b.environment = $1 AND ${DUE_SQL}
        AND (i.last_checked_at IS NULL OR i.last_checked_at < now() - make_interval(mins => $3))
      ORDER BY i.last_checked_at NULLS FIRST, i.id LIMIT $4`, [config.environment, OPEN, CHECK_INTERVAL_MINUTES, MAX_PER_SCAN]);
  if (rows.length === 0) return { checked: 0 };
  const client = deps.client ?? createEvereeClient(config);
  return { checked: rows.length, results: await reconcileItems(db, rows.map((r) => r.id), { ...deps, environment: config.environment }, client) };
};

// A payment event from the webhook: which items it may concern. What it says is not trusted; it only picks what to look at again.
export const itemsForPaymentEvent = async (db, data, environment) => {
  const external = (data.payableExternalIds ?? []).filter((id) => /^nasa-stmt-[0-9]+$/.test(id));
  const { rows } = await db.query(
    `SELECT i.id FROM everee_payment_items i JOIN everee_payment_batches b ON b.id = i.batch_id
      WHERE b.environment = $1 AND (i.status = ANY($2::text[]) OR (i.status = 'paid' AND (i.deposit_returned OR i.everee_payment_id = $4)))
        AND (i.external_id = ANY($3::text[]) OR i.everee_payment_id = $4 OR (i.everee_worker_id = $5 OR (i.external_worker_id IS NOT NULL AND i.external_worker_id = $6)))
      ORDER BY i.id LIMIT 200`,
    [environment, OPEN, external, data.paymentId ?? null, data.workerId ?? null, data.externalWorkerId ?? null]);
  return rows.map((r) => r.id);
};

// The event names a payment and the payables in it. When an item has no payment yet, that link is kept (so a payable Everee will not let us read
// still gets its payment looked at) but only when it is exact: the item's own external ID is named, the payment ID is well formed, and a worker the
// event names is the item's worker (at least one worker identifier must be present and every one present must match). Keeping the link is not paying: the payment is still read from Everee and its amount and payouts verified.
const rememberPaymentLink = async (db, data, environment) => {
  if (!isPaymentId(data.paymentId)) return;
  const external = (data.payableExternalIds ?? []).filter((id) => typeof id === 'string' && /^nasa-stmt-[0-9]+$/.test(id));
  if (external.length === 0) return;
  if (!data.workerId && !data.externalWorkerId) return; // without a worker to compare, the link is not kept
  await db.query(
    `UPDATE everee_payment_items i SET everee_payment_id = $1, payment_link = 'event', updated_at = now()
      FROM everee_payment_batches b
      WHERE b.id = i.batch_id AND b.environment = $2 AND i.external_id = ANY($3::text[]) AND i.everee_payment_id IS NULL AND i.status = ANY($4::text[])
        AND ($5::text IS NULL OR i.everee_worker_id = $5) AND ($6::text IS NULL OR i.external_worker_id = $6)`,
    [data.paymentId, environment, external, OPEN, data.workerId ?? null, data.externalWorkerId ?? null]);
};

export const applyPaymentEvent = async (db, data, config, client, deps = {}) => {
  if (!data.paymentId && !data.workerId && !data.externalWorkerId && !(data.payableExternalIds ?? []).length) return 'no_payment_id';
  await rememberPaymentLink(db, data, config.environment);
  const ids = await itemsForPaymentEvent(db, data, config.environment);
  if (ids.length === 0) return 'no_item'; // a payment that is not one of ours
  const results = await reconcileItems(db, ids.slice(0, MAX_PER_EVENT), { ...deps, throttleMs: 0, environment: config.environment }, client);
  if (results.error) throw new Error('an item could not be checked; Everee will deliver the event again');
  return ids.length > MAX_PER_EVENT ? 'applied_rest_scheduled' : 'applied';
};

// "Check now" for one batch, by a super admin of the batch's city.
export const checkBatch = async (db, admin, batchId, deps = {}) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can pay through Everee');
  const { rows: [batch] } = await db.query('SELECT id, city_id, environment FROM everee_payment_batches WHERE id = $1', [batchId]);
  if (!batch) throw new PayrollError(404, 'payment batch not found');
  await assertCityAllowed(db, admin, batch.city_id);
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  if (!config.configured) throw new PayrollError(409, 'Everee is not set up on this server');
  // Before any request: another environment's evidence must never decide whether this batch is paid.
  if (config.environment !== batch.environment) throw new PayrollError(409, `this batch was made in ${batch.environment}; the server is set up for ${config.environment}`);
  const { rows } = await db.query(
    `SELECT i.id FROM everee_payment_items i WHERE i.batch_id = $1 AND ${DUE_SQL} ORDER BY i.id LIMIT $3`, [batchId, OPEN, MAX_PER_SCAN]);
  const client = deps.client ?? createEvereeClient(config);
  return { checked: rows.length, results: await reconcileItems(db, rows.map((r) => r.id), { ...deps, environment: config.environment }, client) };
};
