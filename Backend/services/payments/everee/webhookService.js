import logger from '../../../utils/logger.js';
import { readEvereeConfig } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from './webhookSignature.js';
import { markLinkTerminated, refreshLinkRow } from './workerStore.js';

// Receiving Everee's webhook events (issue #31, part 2). The route is public (Everee calls it), so the signature is checked first,
// before anything is read from the database. Then, in this order:
//   1. the signing key and Everee settings must exist (else 503, nothing is processed);
//   2. the signature and timestamp must be right (else 401);
//   3. the envelope must be well formed (else 400) and belong to OUR Everee company (else 403);
//   4. the event ID is recorded once per environment; an event already processed is answered "duplicate" and not processed again;
//   5. it is processed, and only then answered 200. If processing fails the answer is 500, so Everee delivers it again (it retries for
//      about 6.6 days); the stored event stays unprocessed and is processed on the next delivery.
// Worker events do not trust what the event says: the worker is read from Everee again, so an event can only trigger a refresh.
// Payment events are stored here and handled in the next part.

const WORKER_EVENTS = new Set([
  'worker.created', 'worker.profile-updated', 'worker.onboarding-completed', 'worker.tin-verification-status-changed', 'worker.terminated', 'worker.deleted',
]);
const ID_TEXT = /^[A-Za-z0-9_.:-]{1,200}$/;
const TYPE_TEXT = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const PROCESSING_TIMEOUT_MS = 8000; // Everee waits only a short while for our answer

const reply = (status, body) => ({ status, body });

// Only IDs and statuses are kept from an event; never names, emails, phones, amounts or bank details.
const trimData = (object) => {
  const o = object && typeof object === 'object' && !Array.isArray(object) ? object : {};
  const text = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);
  const out = {};
  for (const key of ['workerId', 'externalWorkerId', 'paymentId', 'paymentStatus', 'onboardingStatus', 'tinVerificationStatus', 'separationDate']) {
    const v = text(o[key]);
    if (v !== undefined) out[key] = v;
  }
  if (typeof o.onboardingComplete === 'boolean') out.onboardingComplete = o.onboardingComplete;
  if (typeof o.paymentErrorMessage === 'string') out.paymentErrorMessage = o.paymentErrorMessage.slice(0, 300);
  const ids = Array.isArray(o.payableExternalIds) ? o.payableExternalIds : Array.isArray(o.payables) ? o.payables.map((p) => p?.externalId) : [];
  const clean = ids.filter((id) => typeof id === 'string' && ID_TEXT.test(id)).slice(0, 500);
  if (clean.length > 0) out.payableExternalIds = clean;
  return out;
};

// Returns the envelope, or null when it is not one. Extra fields are allowed (Everee may add some).
const parseEnvelope = (rawBody) => {
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (typeof event.id !== 'string' || !ID_TEXT.test(event.id)) return null;
  if (typeof event.type !== 'string' || !TYPE_TEXT.test(event.type)) return null;
  if (!Number.isInteger(event.companyId)) return null;
  return {
    version: String(event.version ?? ''), id: event.id, type: event.type, companyId: event.companyId,
    timestamp: Number.isInteger(event.timestamp) ? event.timestamp : null, object: event.data?.object,
  };
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('processing took too long')), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

const applyWorkerEvent = async (db, event, config, client) => {
  const data = trimData(event.object);
  if (!data.workerId && !data.externalWorkerId) return 'no_worker_id';
  const { rows } = await db.query(
    `SELECT id, driver_id, everee_worker_id, external_worker_id FROM everee_workers
      WHERE environment = $1 AND unlinked_at IS NULL AND (everee_worker_id = $2 OR (external_worker_id IS NOT NULL AND external_worker_id = $3))`,
    [config.environment, data.workerId ?? null, data.externalWorkerId ?? null]
  );
  if (rows.length === 0) return 'no_link'; // a worker of ours that is not linked to a driver, or not ours
  if (rows.length > 1) return 'ambiguous_link'; // cannot happen (unique indexes); never guess if it does
  if (event.type === 'worker.deleted') {
    await markLinkTerminated(db, rows[0]);
    return 'applied';
  }
  try {
    await refreshLinkRow(db, rows[0], client);
  } catch (error) {
    if (error instanceof EvereeError && error.status === 404) {
      await markLinkTerminated(db, rows[0]);
      return 'applied_worker_not_found';
    }
    throw error;
  }
  return 'applied';
};

const processEvent = async (db, event, config, client) => {
  if (event.version !== '1') return 'unsupported_version';
  if (event.type === 'test-event.created') return 'test_ok';
  if (WORKER_EVENTS.has(event.type)) return applyWorkerEvent(db, event, config, client);
  return 'stored'; // payment events and the rest: kept for the next part
};

// headers: the request headers (lower-case names). Returns { status, body }.
export const receiveEvent = async (db, { rawBody, headers = {} }, deps = {}) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  const key = String(env.EVEREE_WEBHOOK_SIGNING_KEY ?? '').trim();
  if (!config.configured || !key) return reply(503, { message: 'the Everee webhook is not set up on this server' });

  const check = verifySignature({
    rawBody, signatureHeader: headers[SIGNATURE_HEADER], timestampHeader: headers[TIMESTAMP_HEADER], key, nowSeconds: deps.nowSeconds,
  });
  if (!check.ok) {
    logger.warn('Everee webhook refused', { reason: check.reason });
    return reply(401, { message: 'invalid signature' });
  }

  const event = parseEnvelope(rawBody);
  if (!event) return reply(400, { message: 'not an Everee event' });
  if (String(event.companyId) !== config.tenantId) {
    logger.warn('Everee webhook for another company refused', { eventId: event.id });
    return reply(403, { message: 'this event is for another company' });
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO everee_webhook_events (event_id, environment, event_type, company_id, event_timestamp, data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (event_id, environment) DO NOTHING RETURNING id`,
    [event.id, config.environment, event.type, event.companyId, event.timestamp, JSON.stringify(trimData(event.object))]
  );
  let rowId = inserted[0]?.id;
  if (!rowId) {
    const { rows } = await db.query(
      'UPDATE everee_webhook_events SET attempts = attempts + 1 WHERE event_id = $1 AND environment = $2 RETURNING id, processed_at', [event.id, config.environment]);
    if (rows[0].processed_at) return reply(200, { received: true, duplicate: true });
    rowId = rows[0].id; // an earlier delivery failed while processing: do it now
  }

  try {
    const client = deps.client ?? createEvereeClient(config, { timeoutMs: PROCESSING_TIMEOUT_MS });
    const outcome = await withTimeout(processEvent(db, event, config, client), PROCESSING_TIMEOUT_MS + 1000);
    await db.query('UPDATE everee_webhook_events SET processed_at = now(), outcome = $2 WHERE id = $1', [rowId, outcome]);
    logger.info('Everee webhook processed', { eventId: event.id, type: event.type, outcome });
    return reply(200, { received: true, outcome });
  } catch (error) {
    logger.error('Everee webhook processing failed; Everee will deliver it again', { eventId: event.id, type: event.type, message: error.message });
    return reply(500, { message: 'could not process the event; please deliver it again' });
  }
};
