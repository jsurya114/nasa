import crypto from 'node:crypto';
import logger from '../../../utils/logger.js';
import { readEvereeConfig, driverOnboardingGate } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { inTransaction } from './batchSubmit.js';
import { lockDriver } from './driverLock.js';
import { LINK_COLUMNS, refreshLinkRow, stateOfWorker } from './workerStore.js';
import { enforcement } from './onboardingGate.js';
import { matchWorkers, MAX_SEARCH_RESULTS, normalizeEmail, normalizePhone, readyToPay, splitName } from './workerRules.js';

// A Local driver finishes Everee onboarding from inside NASA (issue #242, PR A). Everything here is about ONE driver, and that driver is always
// the one in the verified token: no function takes a worker ID, a driver ID or a type from the browser. Everee collects the tax and bank details
// itself in its embedded screens, so NASA never sees them. Nothing here pays anyone or blocks any work (that is a later PR).
//
// What is decided here, and why:
// - Only a LOCAL driver who has signed the NASA agreement can start. A driver without a type is never treated as Desi.
// - The intent is written to the database BEFORE Everee is asked to create anything, under a short lease, so a double click, a second tab or a
//   lost answer cannot create a second worker. After an answer that is not clear, the worker is looked for by its stable ID, never created blindly.
// - A worker that may already exist for the driver's email or phone is NOT linked here: it goes to review for a super admin (a driver cannot
//   prove ownership of an existing Everee record). Matching is by exact email or phone, never by name.
// - "Complete" is Everee's own onboardingComplete, read from Everee; a screen event or a browser flag never sets it.

export const EXTERNAL_PREFIX = 'nasa-driver-';
// The name Everee puts on every event of a session. On the web the page reads events from a private MessageChannel; in the phone app Everee's
// documented handler for a React Native WebView is `ReactNativeWebView`. The platform is chosen from this fixed list only.
export const EVENT_HANDLER_NAMES = Object.freeze({ web: 'nasaEvereeEmbed', native: 'ReactNativeWebView' });
export const EVENT_HANDLER_NAME = EVENT_HANDLER_NAMES.web;
export const LEASE_SECONDS = 60;
export const UNCERTAIN_COOLDOWN_MINUTES = 10;
export const SESSION_LIMIT = { count: 10, minutes: 10 };

// The screens a driver may open. Each has the version Everee documents for it, and the state a worker must be in.
export const EXPERIENCES = Object.freeze({
  ONBOARDING: { version: 'V2_0', needs: 'incomplete' },
  PAYMENT_HISTORY: { version: 'V1_0', needs: 'complete' },
  PAYMENT_DEPOSIT: { version: 'V1_0', needs: 'complete' },
});

export const STATES = Object.freeze({
  NOT_REQUIRED: 'not-required',
  CLASSIFICATION_REQUIRED: 'classification-required',
  NOT_STARTED: 'not-started',
  CREATING: 'creating',
  IN_PROGRESS: 'in-progress',
  VERIFYING: 'verifying',
  COMPLETE: 'complete',
  NEEDS_REVIEW: 'needs-review',
  SERVICE_UNAVAILABLE: 'service-unavailable',
});

export class OnboardingError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'OnboardingError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const switchedOn = (env) => String(env.EVEREE_DRIVER_ONBOARDING_ENABLED ?? '').trim().toLowerCase() === 'true';

const loadDriver = async (db, driverId) => {
  const { rows } = await db.query(
    `SELECT id, name, email, phone_number, driver_type, enabled, agreement_signed, contact_changed_at, to_char(agreement_joining_date, 'YYYY-MM-DD') AS joining_date
       FROM drivers WHERE id = $1`, [driverId]);
  if (rows.length === 0) throw new OnboardingError(404, 'driver_not_found', 'driver not found');
  return rows[0];
};

const findLink = async (db, driverId, config) => {
  const { rows } = await db.query(
    // tenant_id is read here, not in the shared column list, so the older worker and webhook code keeps working on a database that has not run the migration yet
    `SELECT ${LINK_COLUMNS}, tenant_id FROM everee_workers WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NULL`, [driverId, config.environment]);
  return rows[0] ?? null;
};

const findRow = async (db, driverId, config) => {
  const { rows } = await db.query(
    'SELECT * FROM everee_onboarding WHERE driver_id = $1 AND environment = $2 AND tenant_id = $3', [driverId, config.environment, config.tenantId]);
  return rows[0] ?? null;
};

// An admin unlinked this driver at some point in this environment. A driver can never undo that by starting again: the old worker may still exist in
// Everee, and finding it by its ID must not re-link it. A super admin links the driver again, on purpose, from the admin screen.
const wasUnlinked = async (db, driverId, config) => {
  const { rows } = await db.query(
    'SELECT 1 FROM everee_workers WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NOT NULL LIMIT 1', [driverId, config.environment]);
  return rows.length > 0;
};

const sendToReview = (db, driverId, config, reason) => db.query(
  `INSERT INTO everee_onboarding (driver_id, environment, tenant_id, external_worker_id, state, request_id, review_reason)
   VALUES ($1, $2, $3, $4, 'needs_review', $5, $6)
   ON CONFLICT (driver_id, environment, tenant_id) DO UPDATE SET state = 'needs_review', review_reason = EXCLUDED.review_reason, lease_until = NULL, updated_at = now()`,
  [driverId, config.environment, config.tenantId, `${EXTERNAL_PREFIX}${driverId}`, crypto.randomUUID(), reason]);

const record = (db, driverId, event, detail = null) => db.query(
  'INSERT INTO everee_onboarding_events (driver_id, event, detail) VALUES ($1, $2, $3)', [driverId, event, detail ? String(detail).slice(0, 200) : null]);

// ---------- the state of one driver (pure) ----------

// What the driver still has to give us before onboarding can start. The home address is never stored by NASA, so it is always asked for.
export const profileGaps = (driver) => {
  const gaps = [];
  if (!splitName(driver.name)) gaps.push('name');
  if (!normalizeEmail(driver.email)) gaps.push('email');
  if (!normalizePhone(driver.phone_number)) gaps.push('phone');
  if (!driver.joining_date) gaps.push('startDate');
  gaps.push('homeAddress');
  return gaps;
};

// Pure. link: the driver's live everee_workers row for this environment (or null); row: their everee_onboarding row (or null).
export const stateOf = ({ driver, on, configured, link, row, tenantId, unlinked = false }) => {
  const base = { required: false, canStart: false, blockedBy: null, paymentReady: false, verifiedAt: null, reason: null };
  if (!on) return { ...base, state: STATES.NOT_REQUIRED, reason: 'switched_off' };
  if (!driver.enabled) return { ...base, state: STATES.NOT_REQUIRED, reason: 'disabled' };
  if (!driver.driver_type) return { ...base, state: STATES.CLASSIFICATION_REQUIRED, reason: 'classification_required' };
  if (driver.driver_type !== 'LOCAL') return { ...base, state: STATES.NOT_REQUIRED, reason: 'not_local' };
  const mine = { ...base, required: true };
  if (!configured) return { ...mine, state: STATES.SERVICE_UNAVAILABLE, reason: 'everee_not_configured' };
  if (link) {
    // A link made before tenants were recorded (or for another tenant) is never assumed to belong to this one.
    if (link.tenant_id !== tenantId) return { ...mine, state: STATES.NEEDS_REVIEW, reason: 'link_not_verified_for_tenant' };
    const paymentReady = readyToPay({ onboardingComplete: link.onboarding_complete, tinStatus: link.tin_status, terminated: link.terminated });
    if (link.onboarding_complete) return { ...mine, required: false, state: STATES.COMPLETE, paymentReady, verifiedAt: row?.verified_at ?? link.last_checked_at ?? null };
    return { ...mine, state: STATES.IN_PROGRESS, canStart: false };
  }
  if (unlinked) return { ...mine, state: STATES.NEEDS_REVIEW, reason: 'previously_unlinked' };
  // The driver changed their own email or phone: a super admin confirms the new details before they are used to find or create a worker.
  if (driver.contact_changed_at) return { ...mine, state: STATES.NEEDS_REVIEW, reason: 'contact_changed' };
  if (row?.state === 'needs_review') return { ...mine, state: STATES.NEEDS_REVIEW, reason: row.review_reason ?? 'needs_review' };
  if (row?.state === 'creating') return { ...mine, state: STATES.CREATING };
  if (row?.state === 'verifying') return { ...mine, state: STATES.VERIFYING };
  if (!driver.agreement_signed) return { ...mine, state: STATES.NOT_STARTED, blockedBy: 'agreement' };
  return { ...mine, state: STATES.NOT_STARTED, canStart: true };
};

// ---------- status (the database only; never calls Everee) ----------

export const getStatus = async (db, driverId, deps = {}) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  const driver = await loadDriver(db, driverId);
  const on = switchedOn(env);
  const link = config.configured ? await findLink(db, driverId, config) : null;
  const row = config.configured ? await findRow(db, driverId, config) : null;
  const unlinked = config.configured && !link ? await wasUnlinked(db, driverId, config) : false;
  const status = stateOf({ driver, on, configured: config.configured, link, row, tenantId: config.tenantId, unlinked });
  // `enforced` tells the screens whether work and payments are really on hold, so they never say so when the hard gate is off.
  const verified = on && config.configured && driver.enabled && driver.agreement_signed && link?.tenant_id === config.tenantId && link?.onboarding_complete === true;
  return { ...status, canViewPaymentHistory: Boolean(verified), canManageBankDetails: Boolean(verified && driver.driver_type === 'LOCAL'), enforced: enforcement(env).enforced, driverType: driver.driver_type ?? null, agreementSigned: Boolean(driver.agreement_signed), needsFromDriver: status.canStart || status.state === STATES.NOT_STARTED ? profileGaps(driver) : [] };
};

// ---------- preconditions shared by the actions ----------

const requireEnabledDriver = async (db, driverId, deps) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  const gate = driverOnboardingGate(config, env);
  if (!gate.enabled) throw new OnboardingError(409, 'onboarding_unavailable', gate.reason);
  const driver = await loadDriver(db, driverId);
  if (!driver.enabled) throw new OnboardingError(403, 'driver_disabled', 'this driver account is disabled');
  return { config, driver };
};

const requireLocalDriver = async (db, driverId, deps) => {
  const { config, driver } = await requireEnabledDriver(db, driverId, deps);
  if (!driver.driver_type) throw new OnboardingError(409, 'classification_required', 'an admin must set your driver type first');
  if (driver.driver_type !== 'LOCAL') throw new OnboardingError(403, 'not_local', 'Everee onboarding is only for Local drivers');
  return { config, driver };
};

// ---------- start (create the worker once, or find the one made earlier) ----------

const ADDRESS_LIMITS = { line1: 100, line2: 100, city: 60 };

// The fields Everee needs, from the driver's own record and what they typed. Nothing is invented: a missing field is reported, never filled.
export const buildProfile = (driver, input = {}) => {
  const missing = [];
  const name = splitName(driver.name);
  if (!name) missing.push('name');
  const email = normalizeEmail(driver.email);
  if (!email) missing.push('email');
  const phone = normalizePhone(driver.phone_number);
  if (!phone) missing.push('phone');
  const startDate = typeof input.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) && !Number.isNaN(Date.parse(input.startDate)) ? input.startDate : driver.joining_date;
  if (!startDate) missing.push('startDate');
  const a = input.homeAddress && typeof input.homeAddress === 'object' ? input.homeAddress : {};
  const text = (value, max) => (typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null);
  const address = {
    line1: text(a.line1, ADDRESS_LIMITS.line1),
    city: text(a.city, ADDRESS_LIMITS.city),
    state: typeof a.state === 'string' && /^[A-Za-z]{2}$/.test(a.state.trim()) ? a.state.trim().toUpperCase() : null,
    postalCode: typeof a.postalCode === 'string' && /^\d{5}$/.test(a.postalCode.trim()) ? a.postalCode.trim() : null,
  };
  for (const key of ['line1', 'city', 'state', 'postalCode']) if (!address[key]) missing.push(`homeAddress.${key}`);
  const line2 = text(a.line2, ADDRESS_LIMITS.line2);
  if (missing.length > 0) throw new OnboardingError(422, 'missing_fields', 'some details are missing or not valid', { missing });
  return { firstName: name.firstName, lastName: name.lastName, email, phoneNumber: phone, startDate, homeAddress: { ...address, ...(line2 && { line2 }) } };
};

// Does an Everee worker already exist for this driver's own email or phone? (Looked up by exact contact, never by name.) Any hit means "do not create".
const existingWorkerFor = async (client, driver) => {
  const email = normalizeEmail(driver.email);
  const phone = normalizePhone(driver.phone_number);
  const found = [];
  let truncated = false;
  for (const term of [email, phone].filter(Boolean)) {
    const { data } = await client.searchWorkers(term);
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    found.push(...items);
    if (items.length >= MAX_SEARCH_RESULTS || Number(data?.totalItems) > items.length) truncated = true;
  }
  return matchWorkers({ email, phone }, found, { truncated }).result !== 'no_match';
};

const isDefiniteRefusal = (error) => error instanceof EvereeError && error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status);

// Takes the lease for this driver, writing the intent first. Returns { row, mine }: `mine` is true when this request may talk to Everee.
const claim = (db, driverId, config) => inTransaction(db, async (tx) => {
  await lockDriver(tx, driverId);
  const external = `${EXTERNAL_PREFIX}${driverId}`;
  const inserted = await tx.query(
    `INSERT INTO everee_onboarding (driver_id, environment, tenant_id, external_worker_id, state, request_id, attempts, lease_until)
     VALUES ($1, $2, $3, $4, 'creating', $5, 1, now() + make_interval(secs => $6)) ON CONFLICT (driver_id, environment, tenant_id) DO NOTHING RETURNING *`,
    [driverId, config.environment, config.tenantId, external, crypto.randomUUID(), LEASE_SECONDS]);
  if (inserted.rows[0]) return { row: inserted.rows[0], mine: true };
  const { rows: [current] } = await tx.query(
    'SELECT *, (lease_until IS NOT NULL AND lease_until > now()) AS leased FROM everee_onboarding WHERE driver_id = $1 AND environment = $2 AND tenant_id = $3 FOR UPDATE',
    [driverId, config.environment, config.tenantId]);
  if (current.state === 'needs_review' || current.leased) return { row: current, mine: false };
  const { rows: [taken] } = await tx.query(
    `UPDATE everee_onboarding SET lease_until = now() + make_interval(secs => $2), attempts = attempts + 1, updated_at = now() WHERE id = $1 RETURNING *`,
    [current.id, LEASE_SECONDS]);
  return { row: taken, mine: true };
});

// Every write to the onboarding row is fenced by `attempts`: only the attempt that took the lease can change it, so a request that was superseded (its
// lease ran out and another attempt took over) can never overwrite the newer attempt's state or let go of its lease.
const release = (db, row, fields = {}) => db.query(
  `UPDATE everee_onboarding SET lease_until = NULL, updated_at = now(),
     state = COALESCE($3, state), review_reason = $4, last_error = $5, post_uncertain_at = CASE WHEN $6::boolean THEN NULL ELSE post_uncertain_at END
   WHERE id = $1 AND attempts = $2`,
  [row.id, row.attempts, fields.state ?? null, fields.reason ?? null, fields.error ? String(fields.error).slice(0, 300) : null, Boolean(fields.clearUncertain)]);

// Everee's worker lookup by our stable ID returns an `id` that is that same alias, not Everee's own worker ID. The canonical ID is the `workerId` of the
// search result whose externalWorkerId is exactly ours. That ID is what is stored (it is what the session and the payment-status check compare with);
// the alias is kept separately as external_worker_id. Returns { workerId } or { unresolved: true } (not visible yet) or { ambiguous: true }.
const resolveWorkerId = async (client, external) => {
  const { data } = await client.searchWorkers(external);
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const ours = items.filter((w) => w.externalWorkerId === external && w.workerId !== undefined && w.workerId !== null);
  if (ours.length === 1) return { workerId: String(ours[0].workerId) };
  return ours.length > 1 ? { ambiguous: true } : { unresolved: true };
};

// Saves the link for a worker that exists in Everee. The driver is the actor; the tenant is recorded with the link. The provider calls are over by
// now; this one short transaction re-reads everything that decides whether the link may be written, under locks that serialise it with admin changes
// (the driver row, the driver's links, the onboarding row), and writes nothing if the situation changed while Everee was being asked:
//  - superseded: another attempt took over or the record went to review -> nothing is written;
//  - ineligible: the driver is no longer an enabled Local driver who signed the agreement -> review;
//  - revoked: an admin unlinked this driver in the meantime -> review (the admin's decision stands);
//  - already linked (an admin linked them meanwhile, or the worker belongs to someone else) -> nothing is written.
const saveLink = (db, driverId, config, row, worker, workerId) => inTransaction(db, async (tx) => {
  await lockDriver(tx, driverId);
  const { rows: [driver] } = await tx.query('SELECT id, driver_type, enabled, agreement_signed FROM drivers WHERE id = $1 FOR SHARE', [driverId]);
  const { rows: [mine] } = await tx.query('SELECT id, state, attempts FROM everee_onboarding WHERE id = $1 FOR UPDATE', [row.id]);
  if (!mine || mine.attempts !== row.attempts || mine.state === 'needs_review') return 'superseded';
  const { rows: links } = await tx.query(
    'SELECT id, unlinked_at FROM everee_workers WHERE driver_id = $1 AND environment = $2 ORDER BY id FOR SHARE', [driverId, config.environment]);
  const toReview = (reason) => tx.query(
    "UPDATE everee_onboarding SET state = 'needs_review', review_reason = $2, lease_until = NULL, updated_at = now() WHERE id = $1", [row.id, reason]);
  if (!driver || !driver.enabled || driver.driver_type !== 'LOCAL' || !driver.agreement_signed) { await toReview('no_longer_eligible'); return 'ineligible'; }
  if (links.some((l) => l.unlinked_at)) { await toReview('previously_unlinked'); return 'revoked'; }
  if (links.some((l) => !l.unlinked_at)) {
    await tx.query("UPDATE everee_onboarding SET lease_until = NULL, post_uncertain_at = NULL, updated_at = now() WHERE id = $1", [row.id]);
    return 'already_linked';
  }
  const state = stateOfWorker(worker);
  const { rowCount } = await tx.query(
    `INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, external_worker_id, link_source, onboarding_complete, tin_status, terminated, last_checked_at, linked_by_driver_id)
     VALUES ($1, $2, $3, $4, $5, 'embedded_onboarding', $6, $7, $8, now(), $1) ON CONFLICT DO NOTHING`,
    [driverId, config.environment, config.tenantId, workerId, row.external_worker_id, state.onboardingComplete, state.tinStatus, state.terminated]);
  if (rowCount === 0) { await toReview('worker_already_linked'); return 'already_linked'; }
  await tx.query(
    `UPDATE everee_onboarding SET state = $2, lease_until = NULL, post_uncertain_at = NULL, review_reason = NULL, last_error = NULL,
            verified_at = CASE WHEN $2 = 'complete' THEN now() ELSE verified_at END, updated_at = now() WHERE id = $1`,
    [row.id, state.onboardingComplete ? 'complete' : 'in_progress']);
  return 'linked';
});

export const startOnboarding = async (db, driverId, input = {}, deps = {}) => {
  const { config, driver } = await requireLocalDriver(db, driverId, deps);
  if (!driver.agreement_signed) throw new OnboardingError(409, 'agreement_required', 'sign the NASA agreement first');
  if (await findLink(db, driverId, config)) return { ...(await getStatus(db, driverId, deps)), started: false };
  if (await wasUnlinked(db, driverId, config)) {
    await sendToReview(db, driverId, config, 'previously_unlinked');
    await record(db, driverId, 'needs_review', 'previously unlinked by an admin');
    return { ...(await getStatus(db, driverId, deps)), started: false };
  }
  // Nothing is written or sent to Everee while the driver's new email or phone waits for a super admin (the status says so).
  if (driver.contact_changed_at) return { ...(await getStatus(db, driverId, deps)), started: false };

  // The details are checked first, with no side effect: a missing field is answered before anything is written or asked of Everee.
  const profile = buildProfile(driver, input);
  const { row, mine } = await claim(db, driverId, config);
  // Another request holds the lease, or the record is waiting for a person to review it: say so, create nothing.
  if (!mine) return { ...(await getStatus(db, driverId, deps)), started: false };

  const client = deps.client ?? createEvereeClient(config);
  const external = row.external_worker_id;
  // The worker exists but its Everee worker ID cannot be read yet (the search has not caught up, or is not unambiguous): nothing is linked, and the next
  // press reads it again. An ambiguous answer goes to a person.
  const unresolved = async (resolved) => {
    if (resolved.ambiguous) {
      await release(db, row, { state: 'needs_review', reason: 'ambiguous_worker_identity', clearUncertain: true });
      await record(db, driverId, 'needs_review', 'more than one worker with our ID');
    } else {
      await release(db, row, { error: 'the worker exists but its Everee ID is not visible yet', clearUncertain: true });
      await record(db, driverId, 'worker_id_unresolved', null);
    }
    return { ...(await getStatus(db, driverId, deps)), started: true };
  };
  try {
    // 1. A worker with our stable ID may exist already (an earlier attempt whose answer was lost). Look it up by that exact ID.
    let worker = null;
    try {
      ({ data: worker } = await client.getWorker(external));
    } catch (error) {
      if (!(error instanceof EvereeError) || error.status !== 404) throw error;
    }
    if (worker?.id) {
      const resolved = await resolveWorkerId(client, external);
      if (!resolved.workerId) return await unresolved(resolved);
      const outcome = await saveLink(db, driverId, config, row, worker, resolved.workerId);
      if (outcome === 'linked') await record(db, driverId, 'worker_found', 'existing worker with our ID linked');
      return { ...(await getStatus(db, driverId, deps)), started: outcome === 'linked' };
    }

    // 2. No worker with our ID. A worker for this driver's own email or phone must be reviewed by a person, never created over or linked here.
    if (await existingWorkerFor(client, driver)) {
      await release(db, row, { state: 'needs_review', reason: 'possible_existing_worker' });
      await record(db, driverId, 'needs_review', 'possible existing worker');
      return { ...(await getStatus(db, driverId, deps)), started: false };
    }

    // 3. An earlier create got no clear answer a short while ago: wait, do not post again yet.
    const cooling = row.post_uncertain_at && Date.now() - new Date(row.post_uncertain_at).getTime() < UNCERTAIN_COOLDOWN_MINUTES * 60_000;
    if (cooling) {
      await release(db, row, {});
      return { ...(await getStatus(db, driverId, deps)), started: false };
    }

    // 4. Create it. The moment is recorded BEFORE the request, so a lost answer is recognised next time.
    const fenced = await db.query('UPDATE everee_onboarding SET post_uncertain_at = now(), lease_until = now() + make_interval(secs => $3), updated_at = now() WHERE id = $1 AND attempts = $2', [row.id, row.attempts, LEASE_SECONDS]);
    if (fenced.rowCount === 0) return { ...(await getStatus(db, driverId, deps)), started: false }; // another attempt took over: do not create anything
    let created;
    try {
      ({ data: created } = await client.createEmbeddedContractor({ externalWorkerId: external, ...profile }));
    } catch (error) {
      if (isDefiniteRefusal(error)) {
        // Everee said no and created nothing: the intent is removed so the driver can correct the details and try again.
        await db.query('DELETE FROM everee_onboarding WHERE id = $1 AND attempts = $2', [row.id, row.attempts]);
        throw new OnboardingError(422, 'everee_refused', error.message.slice(0, 200));
      }
      if (error instanceof EvereeError && [401, 403, 429].includes(error.status)) {
        await release(db, row, { clearUncertain: true, error: error.message });
        throw new OnboardingError(503, 'service_unavailable', 'Everee is not available right now; try again in a moment');
      }
      // No clear answer (timeout, network, 5xx): the worker may exist. It is looked for by its ID next time, and nothing is posted again before the cooldown.
      await release(db, row, { error: error?.message ?? 'no clear answer' });
      await record(db, driverId, 'create_uncertain', 'no clear answer from Everee');
      return { ...(await getStatus(db, driverId, deps)), started: true };
    }
    if (!created) {
      await release(db, row, { error: 'Everee answered without a worker' });
      return { ...(await getStatus(db, driverId, deps)), started: true };
    }
    // The create worked. The canonical Everee worker ID comes from the search result for our exact external ID, never from the create answer's `id`.
    const resolved = await resolveWorkerId(client, external);
    if (!resolved.workerId) return await unresolved(resolved);
    const outcome = await saveLink(db, driverId, config, row, created, resolved.workerId);
    if (outcome === 'linked') {
      await record(db, driverId, 'worker_created', null);
      logger.info('Everee onboarding worker created', { driverId, environment: config.environment });
    }
    return { ...(await getStatus(db, driverId, deps)), started: outcome === 'linked' };
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    // Anything else (a read failing, a database problem) leaves nothing half-done: the lease is let go and the driver can try again.
    await release(db, row, { error: error?.message ?? 'failed' }).catch(() => {});
    if (error instanceof EvereeError) throw new OnboardingError(503, 'service_unavailable', 'Everee is not available right now; try again in a moment');
    throw error;
  }
};

// ---------- session (one Everee screen, opened by a button press) ----------

const EVEREE_HOST = /(^|\.)everee\.com$/i;

export const createSession = async (db, driverId, input = {}, deps = {}) => {
  // Reclassification never removes access to the driver's own historical statements. Only this read-only experience bypasses the Local-type rule;
  // identity, tenant, completed onboarding, agreement, enabled account and feature checks remain unchanged. Bank management remains Local-only.
  const { config, driver } = await (input.experience === 'PAYMENT_HISTORY' ? requireEnabledDriver : requireLocalDriver)(db, driverId, deps);
  const experience = typeof input.experience === 'string' ? input.experience : '';
  const wanted = Object.hasOwn(EXPERIENCES, experience) ? EXPERIENCES[experience] : null;
  const platform = input.platform === undefined ? 'web' : input.platform;
  if (!Object.hasOwn(EVENT_HANDLER_NAMES, platform)) throw new OnboardingError(400, 'platform_not_allowed', 'that platform is not supported');
  const eventHandlerName = EVENT_HANDLER_NAMES[platform];
  if (!wanted) throw new OnboardingError(400, 'experience_not_allowed', 'that screen is not available');
  if (!driver.agreement_signed) throw new OnboardingError(409, 'agreement_required', 'sign the NASA agreement first');
  const link = await findLink(db, driverId, config);
  if (!link) throw new OnboardingError(409, 'not_started', 'start your payment setup first');
  if (link.tenant_id !== config.tenantId) throw new OnboardingError(409, 'link_not_verified_for_tenant', 'your payment setup needs to be checked by an admin');
  if (wanted.needs === 'incomplete' && link.onboarding_complete) throw new OnboardingError(409, 'already_complete', 'your payment setup is already complete');
  if (wanted.needs === 'complete' && !link.onboarding_complete) throw new OnboardingError(409, 'not_complete', 'finish your payment setup first');

  const { rows: [recent] } = await db.query(
    `SELECT count(*)::int AS n FROM everee_onboarding_events WHERE driver_id = $1 AND event = 'session_issued' AND created_at > now() - make_interval(mins => $2)`,
    [driverId, SESSION_LIMIT.minutes]);
  if (recent.n >= SESSION_LIMIT.count) throw new OnboardingError(429, 'too_many_sessions', 'too many attempts; wait a few minutes');

  const client = deps.client ?? createEvereeClient(config);
  let answer;
  try {
    ({ data: answer } = await client.createEmbeddedSession({
      workerId: link.everee_worker_id, experience, experienceVersion: wanted.version, eventHandlerName,
    }));
  } catch (error) {
    if (error instanceof EvereeError) throw new OnboardingError(503, 'service_unavailable', 'Everee is not available right now; try again in a moment');
    throw error;
  }
  let url;
  try {
    url = new URL(String(answer?.url ?? ''));
  } catch {
    throw new OnboardingError(502, 'bad_session', 'Everee did not return a usable link');
  }
  if (url.protocol !== 'https:' || !EVEREE_HOST.test(url.hostname)) throw new OnboardingError(502, 'bad_session', 'Everee did not return a usable link');
  await record(db, driverId, 'session_issued', experience);
  const expiresInMs = Number.isFinite(Number(answer.expiresInMs)) ? Number(answer.expiresInMs) : null;
  // The link is a bearer credential: it is returned once, never logged and never stored.
  return { url: url.toString(), origin: url.origin, expiresAt: expiresInMs ? new Date(Date.now() + expiresInMs).toISOString() : null, experience, eventHandlerName };
};

// ---------- refresh (read the worker from Everee again) ----------

export const refreshStatus = async (db, driverId, deps = {}) => {
  const { config } = await requireLocalDriver(db, driverId, deps);
  const link = await findLink(db, driverId, config);
  if (!link) return { ...(await getStatus(db, driverId, deps)), refreshed: false };
  if (link.tenant_id !== config.tenantId) return { ...(await getStatus(db, driverId, deps)), refreshed: false };
  const client = deps.client ?? createEvereeClient(config);
  try {
    const view = await refreshLinkRow(db, link, client);
    if (view.onboardingComplete) {
      await db.query(`UPDATE everee_onboarding SET state = 'complete', verified_at = COALESCE(verified_at, now()), updated_at = now() WHERE driver_id = $1 AND environment = $2 AND tenant_id = $3`,
        [driverId, config.environment, config.tenantId]);
    }
    await record(db, driverId, 'refreshed', view.onboardingComplete ? 'complete' : 'incomplete');
    return { ...(await getStatus(db, driverId, deps)), refreshed: true };
  } catch (error) {
    if (!(error instanceof EvereeError)) throw error;
    // A timeout or an Everee error never erases what was verified before: the stored state is returned and marked as not refreshed.
    return { ...(await getStatus(db, driverId, deps)), refreshed: false, stale: true };
  }
};

// A link made before tenants were recorded has no tenant (migration of issue #242). It is not assumed to belong to the configured company, and no admin
// is asked either: Everee itself answers. The token is the company's own, so a worker it can read exists in THIS tenant; the worker found must also be
// the very one this row points to (same canonical ID). Only then is the tenant filled in, once (the guard trigger allows NULL -> value and nothing else).
// Everything else (not found, another worker, an outage) leaves the row exactly as it was, so the driver stays held and the next status read tries again.
const ADOPT_COOLDOWN_MS = 60_000;
const adoptTried = new Map();

export const adoptLegacyLink = async (db, driverId, deps = {}) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  if (!switchedOn(env) || !config.configured) return { adopted: false, reason: 'unavailable' };
  const driver = await loadDriver(db, driverId);
  if (!driver.enabled || driver.driver_type !== 'LOCAL') return { adopted: false, reason: 'not_local' };
  const link = await findLink(db, driverId, config);
  if (!link || link.tenant_id !== null) return { adopted: false, reason: 'nothing_to_verify' };
  const key = `${driverId}:${config.environment}:${config.tenantId}`;
  const now = Date.now();
  if (!deps.client && now - (adoptTried.get(key) ?? 0) < ADOPT_COOLDOWN_MS) return { adopted: false, reason: 'tried_recently' };
  adoptTried.set(key, now);
  const client = deps.client ?? createEvereeClient(config);
  try {
    let canonical;
    if (link.external_worker_id) {
      const resolved = await resolveWorkerId(client, link.external_worker_id);
      canonical = resolved.workerId;
    } else {
      const { data: worker } = await client.getWorker(link.everee_worker_id);
      canonical = worker?.workerId ?? worker?.id;
    }
    if (canonical === undefined || canonical === null || String(canonical) !== String(link.everee_worker_id)) return { adopted: false, reason: 'not_verified' };
    const { rowCount } = await db.query(
      'UPDATE everee_workers SET tenant_id = $2 WHERE id = $1 AND tenant_id IS NULL AND unlinked_at IS NULL', [link.id, config.tenantId]);
    if (rowCount === 1) await record(db, driverId, 'tenant_verified', 'checked against Everee');
    return { adopted: rowCount === 1 };
  } catch (error) {
    if (!(error instanceof EvereeError)) throw error;
    return { adopted: false, reason: 'everee_unavailable' };
  }
};

// Background recovery only reads Everee. In particular, a missing worker NEVER causes a create: only the driver's explicit Start action can do that.
export const recoverOnboarding = async (db, driverId, deps = {}) => {
  const { config, driver } = await requireLocalDriver(db, driverId, deps);
  if (!driver.agreement_signed) return { outcome: 'agreement_required' };
  const link = await findLink(db, driverId, config);
  if (link) {
    if (link.tenant_id !== config.tenantId) return { outcome: 'needs_review' };
    const result = await refreshStatus(db, driverId, deps);
    return { outcome: result.refreshed ? result.state : 'unavailable' };
  }
  if (await wasUnlinked(db, driverId, config)) return { outcome: 'needs_review' };
  const existing = await findRow(db, driverId, config);
  if (!existing || !['creating', 'verifying', 'in_progress'].includes(existing.state)) return { outcome: 'unchanged' };
  const { row, mine } = await claim(db, driverId, config);
  if (!mine) return { outcome: 'busy' };
  const client = deps.client ?? createEvereeClient(config);
  try {
    let worker;
    try { ({ data: worker } = await client.getWorker(row.external_worker_id)); }
    catch (error) {
      if (!(error instanceof EvereeError) || error.status !== 404) throw error;
      await release(db, row, { error: 'worker not visible yet; driver can retry setup' });
      return { outcome: 'not_found' };
    }
    if (!worker?.id) {
      await release(db, row, { error: 'worker details not visible yet' });
      return { outcome: 'verifying' };
    }
    const resolved = await resolveWorkerId(client, row.external_worker_id);
    if (!resolved.workerId) {
      await release(db, row, resolved.ambiguous ? { state: 'needs_review', reason: 'ambiguous_worker_identity' } : {});
      return { outcome: resolved.ambiguous ? 'needs_review' : 'verifying' };
    }
    const outcome = await saveLink(db, driverId, config, row, worker, resolved.workerId);
    await record(db, driverId, 'reconciled', outcome);
    return { outcome };
  } catch (error) {
    // Fixed wording only: provider errors can contain private profile details.
    await release(db, row, { error: 'background verification could not complete' });
    throw error;
  }
};
