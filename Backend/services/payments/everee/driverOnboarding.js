import crypto from 'node:crypto';
import logger from '../../../utils/logger.js';
import { readEvereeConfig, driverOnboardingGate } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { inTransaction } from './batchSubmit.js';
import { LINK_COLUMNS, refreshLinkRow, stateOfWorker } from './workerStore.js';
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
export const EVENT_HANDLER_NAME = 'nasaEvereeEmbed';
export const LEASE_SECONDS = 60;
export const UNCERTAIN_COOLDOWN_MINUTES = 10;
export const SESSION_LIMIT = { count: 10, minutes: 10 };
const LOCK_NAMESPACE = 424242; // for pg_advisory_xact_lock(namespace, driverId)

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
    `SELECT id, name, email, phone_number, driver_type, enabled, agreement_signed, to_char(agreement_joining_date, 'YYYY-MM-DD') AS joining_date
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
export const stateOf = ({ driver, on, configured, link, row, tenantId }) => {
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
  const status = stateOf({ driver, on, configured: config.configured, link, row, tenantId: config.tenantId });
  return { ...status, driverType: driver.driver_type ?? null, agreementSigned: Boolean(driver.agreement_signed), needsFromDriver: status.canStart || status.state === STATES.NOT_STARTED ? profileGaps(driver) : [] };
};

// ---------- preconditions shared by the actions ----------

const requireLocalDriver = async (db, driverId, deps) => {
  const env = deps.env ?? process.env;
  const config = readEvereeConfig(env);
  const gate = driverOnboardingGate(config, env);
  if (!gate.enabled) throw new OnboardingError(409, 'onboarding_unavailable', gate.reason);
  const driver = await loadDriver(db, driverId);
  if (!driver.enabled) throw new OnboardingError(403, 'driver_disabled', 'this driver account is disabled');
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
  await tx.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NAMESPACE, driverId]);
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

const release = (db, rowId, fields = {}) => db.query(
  `UPDATE everee_onboarding SET lease_until = NULL, updated_at = now(),
     state = COALESCE($2, state), review_reason = $3, last_error = $4, post_uncertain_at = CASE WHEN $5::boolean THEN now() WHEN $6::boolean THEN NULL ELSE post_uncertain_at END
   WHERE id = $1`,
  [rowId, fields.state ?? null, fields.reason ?? null, fields.error ? String(fields.error).slice(0, 300) : null, false, Boolean(fields.clearUncertain)]);

// Saves the link for a worker that exists in Everee. The driver is the actor; the tenant is recorded with the link.
const saveLink = async (db, driver, config, row, worker) => {
  const state = stateOfWorker(worker);
  const workerId = String(worker.id ?? worker.workerId);
  try {
    await inTransaction(db, async (tx) => {
      await tx.query(
        `INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, external_worker_id, link_source, onboarding_complete, tin_status, terminated, last_checked_at, linked_by_driver_id)
         VALUES ($1, $2, $3, $4, $5, 'embedded_onboarding', $6, $7, $8, now(), $1)`,
        [driver.id, config.environment, config.tenantId, workerId, row.external_worker_id, state.onboardingComplete, state.tinStatus, state.terminated]);
      await tx.query(
        `UPDATE everee_onboarding SET state = $2, lease_until = NULL, post_uncertain_at = NULL, review_reason = NULL, last_error = NULL,
                verified_at = CASE WHEN $2 = 'complete' THEN now() ELSE verified_at END, updated_at = now() WHERE id = $1`,
        [row.id, state.onboardingComplete ? 'complete' : 'in_progress']);
    });
  } catch (error) {
    if (error.code !== '23505') throw error;
    // The driver or the worker was linked in the meantime (another tab, or an admin): nothing is created, the state is read again.
    await release(db, row.id, { state: 'needs_review', reason: 'worker_already_linked' });
  }
};

export const startOnboarding = async (db, driverId, input = {}, deps = {}) => {
  const { config, driver } = await requireLocalDriver(db, driverId, deps);
  if (!driver.agreement_signed) throw new OnboardingError(409, 'agreement_required', 'sign the NASA agreement first');
  if (await findLink(db, driverId, config)) return { ...(await getStatus(db, driverId, deps)), started: false };

  // The details are checked first, with no side effect: a missing field is answered before anything is written or asked of Everee.
  const profile = buildProfile(driver, input);
  const { row, mine } = await claim(db, driverId, config);
  // Another request holds the lease, or the record is waiting for a person to review it: say so, create nothing.
  if (!mine) return { ...(await getStatus(db, driverId, deps)), started: false };

  const client = deps.client ?? createEvereeClient(config);
  const external = row.external_worker_id;
  try {
    // 1. A worker with our stable ID may exist already (an earlier attempt whose answer was lost). Look it up by that exact ID.
    let worker = null;
    try {
      ({ data: worker } = await client.getWorker(external));
    } catch (error) {
      if (!(error instanceof EvereeError) || error.status !== 404) throw error;
    }
    if (worker?.id) {
      await saveLink(db, driver, config, row, worker);
      await record(db, driverId, 'worker_found', 'existing worker with our ID linked');
      return { ...(await getStatus(db, driverId, deps)), started: true };
    }

    // 2. No worker with our ID. A worker for this driver's own email or phone must be reviewed by a person, never created over or linked here.
    if (await existingWorkerFor(client, driver)) {
      await release(db, row.id, { state: 'needs_review', reason: 'possible_existing_worker' });
      await record(db, driverId, 'needs_review', 'possible existing worker');
      return { ...(await getStatus(db, driverId, deps)), started: false };
    }

    // 3. An earlier create got no clear answer a short while ago: wait, do not post again yet.
    const cooling = row.post_uncertain_at && Date.now() - new Date(row.post_uncertain_at).getTime() < UNCERTAIN_COOLDOWN_MINUTES * 60_000;
    if (cooling) {
      await release(db, row.id, {});
      return { ...(await getStatus(db, driverId, deps)), started: false };
    }

    // 4. Create it. The moment is recorded BEFORE the request, so a lost answer is recognised next time.
    await db.query('UPDATE everee_onboarding SET post_uncertain_at = now(), lease_until = now() + make_interval(secs => $2), updated_at = now() WHERE id = $1', [row.id, LEASE_SECONDS]);
    let created;
    try {
      ({ data: created } = await client.createEmbeddedContractor({ externalWorkerId: external, ...profile }));
    } catch (error) {
      if (isDefiniteRefusal(error)) {
        // Everee said no and created nothing: the intent is removed so the driver can correct the details and try again.
        await db.query('DELETE FROM everee_onboarding WHERE id = $1', [row.id]);
        throw new OnboardingError(422, 'everee_refused', error.message.slice(0, 200));
      }
      if (error instanceof EvereeError && [401, 403, 429].includes(error.status)) {
        await release(db, row.id, { clearUncertain: true, error: error.message });
        throw new OnboardingError(503, 'service_unavailable', 'Everee is not available right now; try again in a moment');
      }
      // No clear answer (timeout, network, 5xx): the worker may exist. It is looked for by its ID next time, and nothing is posted again before the cooldown.
      await release(db, row.id, { error: error?.message ?? 'no clear answer' });
      await record(db, driverId, 'create_uncertain', 'no clear answer from Everee');
      return { ...(await getStatus(db, driverId, deps)), started: true };
    }
    if (!created?.id) {
      await release(db, row.id, { error: 'Everee answered without a worker ID' });
      return { ...(await getStatus(db, driverId, deps)), started: true };
    }
    await saveLink(db, driver, config, row, created);
    await record(db, driverId, 'worker_created', null);
    logger.info('Everee onboarding worker created', { driverId, environment: config.environment });
    return { ...(await getStatus(db, driverId, deps)), started: true };
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    // Anything else (a read failing, a database problem) leaves nothing half-done: the lease is let go and the driver can try again.
    await release(db, row.id, { error: error?.message ?? 'failed' }).catch(() => {});
    if (error instanceof EvereeError) throw new OnboardingError(503, 'service_unavailable', 'Everee is not available right now; try again in a moment');
    throw error;
  }
};

// ---------- session (one Everee screen, opened by a button press) ----------

const EVEREE_HOST = /(^|\.)everee\.com$/i;

export const createSession = async (db, driverId, input = {}, deps = {}) => {
  const { config, driver } = await requireLocalDriver(db, driverId, deps);
  const experience = typeof input.experience === 'string' ? input.experience : '';
  const wanted = Object.hasOwn(EXPERIENCES, experience) ? EXPERIENCES[experience] : null;
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
      workerId: link.everee_worker_id, experience, experienceVersion: wanted.version, eventHandlerName: EVENT_HANDLER_NAME,
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
  return { url: url.toString(), origin: url.origin, expiresAt: expiresInMs ? new Date(Date.now() + expiresInMs).toISOString() : null, experience, eventHandlerName: EVENT_HANDLER_NAME };
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
