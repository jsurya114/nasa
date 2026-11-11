import { CONTACT_CHANGED_WHILE_LINKING, contactSnapshot, contactStillVerified } from '../contactSnapshot.js';
import { PayrollError, assertCityAllowed, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import logger from '../../../utils/logger.js';
import { readEvereeConfig } from './evereeConfig.js';
import { createEvereeClient, EvereeError } from './evereeClient.js';
import { withDriverLock } from './driverLock.js';
import { driverIssues, linkSourceOf, matchWorkers, MAX_SEARCH_RESULTS, normalizeEmail, normalizePhone, readyToPay, splitName } from './workerRules.js';

// Linking NASA drivers to Everee workers (issue #31). Super admin only. Every action checks the city and the driver on the server.
// Rules (agreed on #31): look before creating; match only on an exact email or phone, never a name; no match or several matches
// means the driver stays unlinked and blocked; a link is saved only from one exact, unambiguous match. Test workers are created in the
// sandbox only, with made-up data, never with a real driver's details.

const SANDBOX_EXTERNAL_PREFIX = 'nasa-sandbox-driver-';
const MIN_UNLINK_REASON = 3;

const requireSuperAdmin = (admin) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can link drivers to Everee');
};

const requireConfigured = (env) => {
  const config = readEvereeConfig(env);
  if (!config.configured) throw new PayrollError(409, 'Everee is not set up in the backend settings');
  return config;
};

// An Everee problem becomes a clear answer with Everee's request ID for support; anything else is passed on.
const viaEveree = async (call) => {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof EvereeError)) throw error;
    throw new PayrollError(502, `${error.message}${error.requestId ? ` (Everee request ${error.requestId})` : ''}`);
  }
};

const loadDriver = async (db, cityId, driverId) => {
  const { rows } = await db.query('SELECT id, name, email, phone_number, city_id, contact_changed_at FROM drivers WHERE id = $1 AND city_id = $2', [driverId, cityId]);
  if (rows.length === 0) throw new PayrollError(404, 'driver not found in this city');
  return rows[0];
};

export const LINK_COLUMNS = `id, driver_id, environment, everee_worker_id, external_worker_id, link_source, onboarding_complete, tin_status, terminated,
  last_checked_at, linked_at`;

export const viewOfLink = (row) => (row ? {
  workerId: row.everee_worker_id,
  externalWorkerId: row.external_worker_id,
  source: row.link_source,
  onboardingComplete: row.onboarding_complete,
  tinStatus: row.tin_status,
  terminated: row.terminated,
  ready: readyToPay({ onboardingComplete: row.onboarding_complete, tinStatus: row.tin_status, terminated: row.terminated }),
  linkedAt: row.linked_at,
  lastCheckedAt: row.last_checked_at,
} : null);

export const stateOfWorker = (worker) => ({
  onboardingComplete: worker?.onboardingComplete === true,
  tinStatus: typeof worker?.tinVerificationStatus === 'string' ? worker.tinVerificationStatus : null,
  terminated: Boolean(worker?.terminationDate),
});

const searchItems = (data) => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);

// ---------- list (the database only, no call to Everee) ----------

export const listCityWorkers = async (db, admin, cityId, { env = process.env } = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = readEvereeConfig(env);
  const { rows } = await db.query(
    `SELECT d.id, d.name, d.email, d.phone_number,
            w.everee_worker_id, w.external_worker_id, w.link_source, w.onboarding_complete, w.tin_status, w.terminated, w.last_checked_at, w.linked_at
       FROM drivers d
       LEFT JOIN everee_workers w ON w.driver_id = d.id AND w.environment = $2 AND w.unlinked_at IS NULL
      WHERE d.city_id = $1 AND d.enabled
      ORDER BY lower(d.name), d.id
      LIMIT 1000`,
    [cityId, config.environment]
  );
  const drivers = rows.map((d) => {
    const link = viewOfLink(d.everee_worker_id ? d : null);
    const issues = driverIssues(d);
    const name = splitName(d.name);
    return {
      driverId: d.id, name: d.name, sendsAs: name, issues, link,
      status: link ? (link.ready ? 'ready' : 'linked') : issues.length ? 'blocked' : 'unlinked',
    };
  });
  const count = (status) => drivers.filter((d) => d.status === status).length;
  return {
    environment: config.environment, configured: config.configured, problems: config.problems, cityId,
    summary: { drivers: drivers.length, ready: count('ready'), linked: count('linked'), unlinked: count('unlinked'), blocked: count('blocked') },
    drivers,
  };
};

// ---------- look up (read-only: nothing is saved) ----------

export const lookupDriver = async (db, admin, { cityId, driverId }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = requireConfigured(deps.env ?? process.env);
  const driver = deps.driver ?? await loadDriver(db, cityId, driverId); // a caller that will write a link passes the driver it loaded, so lookup and link use one snapshot

  const issues = driverIssues(driver);
  if (issues.length > 0) return { result: 'blocked', reason: 'driver_data', issues, matches: [] };
  // The driver changed their own email or phone and nobody has confirmed the new details yet: they are not used to find or link a worker.
  if (driver.contact_changed_at) return { result: 'blocked', reason: 'contact_changed', issues: [], matches: [] };

  const client = deps.client ?? createEvereeClient(config);
  const email = normalizeEmail(driver.email);
  const phone = normalizePhone(driver.phone_number);
  const found = [];
  let truncated = false;
  for (const term of [email, phone].filter(Boolean)) {
    const { data } = await viaEveree(() => client.searchWorkers(term));
    const items = searchItems(data);
    found.push(...items);
    if (items.length >= MAX_SEARCH_RESULTS || Number(data?.totalItems) > items.length) truncated = true;
  }
  const { result, matches } = matchWorkers({ email, phone }, found, { truncated });

  // A worker already linked to a driver is never offered to another one.
  const { rows: links } = await db.query(
    'SELECT driver_id, everee_worker_id FROM everee_workers WHERE environment = $1 AND everee_worker_id = ANY($2::text[]) AND unlinked_at IS NULL',
    [config.environment, matches.map((m) => m.workerId)]
  );
  const annotated = matches.map((m) => {
    const link = links.find((l) => l.everee_worker_id === m.workerId);
    return { ...m, linkedTo: link ? (link.driver_id === driver.id ? 'this_driver' : 'another_driver') : null };
  });
  if (annotated.some((m) => m.linkedTo === 'another_driver')) return { result: 'blocked', reason: 'worker_linked_to_another_driver', issues: [], matches: annotated };
  return { result, reason: null, issues: [], matches: annotated, truncated };
};

// ---------- link (only from one exact, unambiguous match) ----------

const NOT_LINKABLE = {
  no_match: 'no existing Everee worker has this driver\'s email or phone; nothing was linked',
  ambiguous: 'more than one Everee worker matches this driver; nothing was linked',
  conflict: 'a worker matches on one of email or phone but the other is different; it needs to be confirmed with the client; nothing was linked',
  blocked: 'this driver is blocked; nothing was linked',
};

export const linkDriver = async (db, admin, { cityId, driverId, workerId }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const driver = await loadDriver(db, cityId, driverId); // one snapshot of the contact details: the lookup uses it and the link is saved only if it still holds
  const lookup = await lookupDriver(db, admin, { cityId, driverId }, { ...deps, driver });
  if (lookup.result !== 'match') throw new PayrollError(409, NOT_LINKABLE[lookup.result] ?? 'nothing was linked');
  const [match] = lookup.matches;
  if (String(workerId) !== match.workerId) throw new PayrollError(409, 'that is not the worker found for this driver; look the driver up again');
  if (match.linkedTo === 'this_driver') throw new PayrollError(409, 'this driver is already linked to that worker');

  const config = requireConfigured(deps.env ?? process.env);
  const client = deps.client ?? createEvereeClient(config);
  const { data: worker } = await viaEveree(() => client.getWorker(match.externalWorkerId ?? match.workerId));
  const state = stateOfWorker(worker);
  try {
    // The write holds the driver's lock (driverLock.js), so it cannot interleave with the driver's own onboarding save or with an unlink.
    const { rows } = await withDriverLock(db, driverId, async (tx) => {
      if (!(await contactStillVerified(tx, driverId, contactSnapshot(driver)))) throw new PayrollError(409, CONTACT_CHANGED_WHILE_LINKING);
      return tx.query(
        `INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, external_worker_id, link_source, onboarding_complete, tin_status, terminated, last_checked_at, linked_by)
         VALUES ($1, $2, $10, $3, $4, $5, $6, $7, $8, now(), $9) RETURNING ${LINK_COLUMNS}`,
        [driverId, config.environment, match.workerId, match.externalWorkerId, linkSourceOf(match.matchedOn), state.onboardingComplete, state.tinStatus, state.terminated, admin.id, config.tenantId]
      );
    });
    logger.info('Driver linked to an Everee worker', { driverId, source: rows[0].link_source, environment: config.environment });
    return { link: viewOfLink(rows[0]) };
  } catch (error) {
    if (error.code === '23505') throw new PayrollError(409, 'this driver or this Everee worker is already linked');
    throw error;
  }
};

// ---------- refresh what Everee says about a linked worker ----------

// Re-reads one linked worker from Everee and stores what it says. Used by the Refresh button and by the webhook (issue #31, part 2), so
// both do exactly the same. Throws the Everee error as it is; the callers decide how to answer.
export const refreshLinkRow = async (db, row, client) => {
  const { data: worker } = await client.getWorker(row.external_worker_id ?? row.everee_worker_id);
  const state = stateOfWorker(worker);
  const { rows } = await db.query(
    `UPDATE everee_workers SET onboarding_complete = $2, tin_status = $3, terminated = $4, last_checked_at = now() WHERE id = $1 RETURNING ${LINK_COLUMNS}`,
    [row.id, state.onboardingComplete, state.tinStatus, state.terminated]
  );
  return viewOfLink(rows[0]);
};

// A worker Everee says is gone can no longer be paid: they are marked as having left.
export const markLinkTerminated = async (db, row) => {
  const { rows } = await db.query(
    `UPDATE everee_workers SET terminated = true, last_checked_at = now() WHERE id = $1 RETURNING ${LINK_COLUMNS}`, [row.id]);
  return viewOfLink(rows[0]);
};

export const refreshWorker = async (db, admin, { cityId, driverId }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = requireConfigured(deps.env ?? process.env);
  await loadDriver(db, cityId, driverId);
  const { rows } = await db.query(
    `SELECT ${LINK_COLUMNS} FROM everee_workers WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NULL`, [driverId, config.environment]);
  if (rows.length === 0) throw new PayrollError(404, 'this driver is not linked to an Everee worker');
  const client = deps.client ?? createEvereeClient(config);
  return { link: await viaEveree(() => refreshLinkRow(db, rows[0], client)) };
};

// ---------- unlink (kept as history, with a reason) ----------

export const unlinkDriver = async (db, admin, { cityId, driverId, reason }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = requireConfigured(deps.env ?? process.env);
  await loadDriver(db, cityId, driverId);
  const why = typeof reason === 'string' ? reason.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
  if (why.length < MIN_UNLINK_REASON) throw new PayrollError(400, 'give a reason for unlinking');
  // Under the driver's lock (driverLock.js): an onboarding save that was waiting sees the revocation when it gets its turn.
  const { rowCount } = await withDriverLock(db, driverId, (tx) => tx.query(
    `UPDATE everee_workers SET unlinked_by = $3, unlinked_at = now(), unlink_reason = $4
      WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NULL`,
    [driverId, config.environment, admin.id, why]
  ));
  if (rowCount === 0) throw new PayrollError(404, 'this driver is not linked to an Everee worker');
  logger.info('Driver unlinked from an Everee worker', { driverId, environment: config.environment });
  return { unlinked: true };
};

// ---------- sandbox test worker (made-up data only) ----------

// Made-up values for a test worker. Sandbox accepts any 9-digit routing number and does not check tax ID formats, but it answers 500 to a tax ID
// starting with 9 (it looks like an ITIN) and refuses a tax ID already used by another worker, so each test worker gets its own. None of this is a real person: the phone, email, address, bank account and tax ID are invented.
const testWorkerBody = (driverId, hireDate) => {
  const id = String(driverId);
  return {
    externalWorkerId: `${SANDBOX_EXTERNAL_PREFIX}${id}`,
    firstName: 'Test',
    lastName: `Driver${id}`,
    phoneNumber: `55501${id.padStart(5, '0').slice(-5)}`,
    email: `nasa-sandbox-driver-${id}@example.com`,
    hireDate,
    dateOfBirth: '1990-01-01',
    homeAddress: { line1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701' },
    legalWorkAddress: { useHomeAddress: true }, // the sandbox refuses a record without it, although the reference page calls it optional
    bankAccount: { accountName: `Test Driver${id}`, accountType: 'CHECKING', routingNumber: '111000025', accountNumber: '000123456789' },
    w9FormResponse: { entityIndividualName: `Test Driver${id}`, taxClassification: 'INDIVIDUAL', socialSecurityNumber: `12345${id.padStart(4, '0').slice(-4)}` },
    onboardingComplete: true,
  };
};

export const createSandboxWorker = async (db, admin, { cityId, driverId }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = requireConfigured(deps.env ?? process.env);
  if (config.environment !== 'sandbox') throw new PayrollError(403, 'test workers can only be created in the Everee sandbox');
  const driver = await loadDriver(db, cityId, driverId);
  const { rows: existing } = await db.query('SELECT 1 FROM everee_workers WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NULL', [driverId, config.environment]);
  if (existing.length > 0) throw new PayrollError(409, 'this driver is already linked to an Everee worker');

  // Look before creating. If the driver's own email or phone already finds a worker, that one is linked instead (by a person, with Look up).
  if (driverIssues(driver).length === 0) {
    const lookup = await lookupDriver(db, admin, { cityId, driverId }, { ...deps, driver });
    // Only a clean "no match" allows a new worker, so any result added later is refused by default.
    if (lookup.result !== 'no_match') {
      throw new PayrollError(409, 'an Everee worker may already exist for this driver (or the lookup is blocked); resolve that instead of creating a test worker');
    }
  }

  const client = deps.client ?? createEvereeClient(config);
  const external = `${SANDBOX_EXTERNAL_PREFIX}${driverId}`;
  const find = async () => {
    const { data } = await viaEveree(() => client.searchWorkers(external));
    return searchItems(data).find((w) => w.externalWorkerId === external) ?? null;
  };
  // A test worker made earlier (for example when the answer was lost) is reused, never duplicated.
  let found = await find();
  let created = null;
  if (!found) {
    const hireDate = (deps.now ?? new Date()).toISOString().slice(0, 10);
    const { data } = await viaEveree(() => client.createContractor(testWorkerBody(driverId, hireDate)));
    created = data;
    found = await find();
    if (!found) throw new PayrollError(502, 'the test worker was created but could not be read back; try again (it will be reused, not duplicated)');
  }
  const { data: worker } = created ? { data: created } : await viaEveree(() => client.getWorker(external));
  const state = stateOfWorker(worker);
  try {
    const { rows } = await withDriverLock(db, driverId, async (tx) => {
      if (!(await contactStillVerified(tx, driverId, contactSnapshot(driver)))) throw new PayrollError(409, CONTACT_CHANGED_WHILE_LINKING);
      return tx.query(
        `INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, external_worker_id, link_source, onboarding_complete, tin_status, terminated, last_checked_at, linked_by)
         VALUES ($1, 'sandbox', $8, $2, $3, 'created_sandbox', $4, $5, $6, now(), $7) RETURNING ${LINK_COLUMNS}`,
        [driverId, String(found.workerId), external, state.onboardingComplete, state.tinStatus, state.terminated, admin.id, config.tenantId]
      );
    });
    logger.info('Sandbox test worker linked', { driverId, reused: !created });
    return { link: viewOfLink(rows[0]), reused: !created };
  } catch (error) {
    if (error.code === '23505') throw new PayrollError(409, 'this driver or this Everee worker is already linked');
    throw error;
  }
};
