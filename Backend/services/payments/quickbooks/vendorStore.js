import { CONTACT_CHANGED_WHILE_LINKING, contactSnapshot, contactStillVerified } from '../contactSnapshot.js';
import { PayrollError, assertCityAllowed, isSuperAdmin } from '../../payroll/payRuns/payRunStore.js';
import logger from '../../../utils/logger.js';
import { normalizeEmail } from '../everee/workerRules.js';
import { withDriverLock } from '../everee/driverLock.js';
import { readQuickbooksConfig } from './quickbooksConfig.js';
import { createQuickbooksClient, QuickbooksError } from './quickbooksClient.js';
import { getAuth } from './connectionStore.js';

// Linking existing Desi drivers to their QuickBooks vendors. Super admin only. Same rules as the Everee links: look before linking; match only on the
// driver's exact email, never a name; no match or several matches leaves the driver unlinked; a link is saved only from one exact, unambiguous match, and
// a vendor already linked to another driver is never offered. These are existing vendors with a tax ID already in QuickBooks, so NASA stores no tax ID.

const MIN_UNLINK_REASON = 3;

const requireSuperAdmin = (admin) => {
  if (!isSuperAdmin(admin)) throw new PayrollError(403, 'only a super admin can link drivers to QuickBooks');
};

const requireConfigured = (env) => {
  const config = readQuickbooksConfig(env);
  if (!config.configured) throw new PayrollError(409, 'QuickBooks is not set up in the backend settings');
  return config;
};

// A QuickBooks problem becomes a clear answer with Intuit's transaction id for support; anything else is passed on.
const viaQuickbooks = async (call) => {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof QuickbooksError)) throw error;
    throw new PayrollError(error.status === null || error.status >= 500 ? 502 : 409, `${error.message}${error.requestId ? ` (QuickBooks request ${error.requestId})` : ''}`);
  }
};

const clientFor = (db, config, deps) => deps.client ?? createQuickbooksClient(config, () => getAuth(db, config, { fetchImpl: deps.fetchImpl }), deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});

const loadDesiDriver = async (db, cityId, driverId) => {
  const { rows } = await db.query(`SELECT id, name, email, phone_number, city_id, contact_changed_at FROM drivers WHERE id = $1 AND city_id = $2 AND driver_type = 'DESI'`, [driverId, cityId]);
  if (rows.length === 0) throw new PayrollError(404, 'Desi driver not found in this city');
  return rows[0];
};

const LINK_COLUMNS = 'id, driver_id, environment, realm_id, vendor_id, link_source, tax_id_supplied, vendor_1099, linked_at';
export const viewOfLink = (row) => (row ? {
  vendorId: row.vendor_id, source: row.link_source, taxIdSupplied: row.tax_id_supplied, vendor1099: row.vendor_1099, linkedAt: row.linked_at,
} : null);

// The Desi drivers of a city and where each stands (the database only; no call to QuickBooks). Linked rows count only for the connected company.
export const listCityVendors = async (db, admin, cityId, { env = process.env } = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = readQuickbooksConfig(env);
  const { rows } = await db.query(
    `SELECT d.id, d.name, d.email, d.phone_number, d.contact_changed_at, v.vendor_id, v.link_source, v.tax_id_supplied, v.vendor_1099, v.linked_at
       FROM drivers d
       LEFT JOIN quickbooks_connection c ON c.environment = $2
       LEFT JOIN quickbooks_vendors v ON v.driver_id = d.id AND v.environment = $2 AND v.realm_id = c.realm_id AND v.unlinked_at IS NULL
      WHERE d.city_id = $1 AND d.enabled AND d.driver_type = 'DESI'
      ORDER BY lower(d.name), d.id
      LIMIT 1000`, [cityId, config.environment]);
  const drivers = rows.map((d) => {
    const link = viewOfLink(d.vendor_id ? d : null);
    const issues = [...(normalizeEmail(d.email) ? [] : ['no_email']), ...(d.contact_changed_at && !link ? ['contact_changed'] : [])];
    return { driverId: d.id, name: d.name, issues, contactChangedAt: d.contact_changed_at, contact: d.contact_changed_at && !link ? { email: d.email, phone: d.phone_number } : null, link, status: link ? 'linked' : issues.length ? 'blocked' : 'unlinked' };
  });
  const count = (status) => drivers.filter((d) => d.status === status).length;
  return { environment: config.environment, configured: config.configured, problems: config.problems, cityId,
    summary: { drivers: drivers.length, linked: count('linked'), unlinked: count('unlinked'), blocked: count('blocked') }, drivers };
};

// Answers { lookup, realmId }: the lookup, and the QuickBooks company it was read from (null when it was blocked before asking).
const lookupInCompany = async (db, admin, { cityId, driverId }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = requireConfigured(deps.env ?? process.env);
  const driver = deps.driver ?? await loadDesiDriver(db, cityId, driverId); // a caller that will write a link passes the driver it loaded (one snapshot)
  const email = normalizeEmail(driver.email);
  if (!email) return { lookup: { result: 'blocked', reason: 'driver_data', issues: ['no_email'], matches: [] }, realmId: null };
  // The driver changed their own email and nobody has confirmed it yet: it is not used to find or link a vendor.
  if (driver.contact_changed_at) return { lookup: { result: 'blocked', reason: 'contact_changed', issues: [], matches: [] }, realmId: null };

  // The whole search is pinned to the company connected now; a reconnect to another company part way through makes it fail instead of mixing the two.
  const { rows: [conn] } = await db.query('SELECT realm_id FROM quickbooks_connection WHERE environment = $1', [config.environment]);
  if (!conn) throw new PayrollError(409, 'QuickBooks is not connected; connect it first');
  const client = clientFor(db, config, deps);
  const scanned = await viaQuickbooks(() => client.findVendorsByEmail(email, { realm: conn.realm_id }));
  const realmId = String(scanned.realmId ?? '');
  if (realmId !== String(conn.realm_id)) throw new PayrollError(409, 'QuickBooks answered for a different company than the one connected; look the driver up again');
  const vendors = scanned.filter((v) => v.Active !== false && normalizeEmail(v.PrimaryEmailAddr?.Address) === email);
  const matches = vendors.map((v) => ({ vendorId: String(v.Id), displayName: v.DisplayName, vendor1099: v.Vendor1099 === true }));
  const answer = (lookup) => ({ lookup, realmId });
  if (matches.length === 0) return answer({ result: 'no_match', reason: null, issues: [], matches });
  if (matches.length > 1) return answer({ result: 'ambiguous', reason: null, issues: [], matches });

  const { rows: taken } = await db.query(
    'SELECT driver_id FROM quickbooks_vendors WHERE environment = $1 AND realm_id = $3 AND vendor_id = $2 AND unlinked_at IS NULL',
    [config.environment, matches[0].vendorId, realmId]);
  const linkedTo = taken.length === 0 ? null : taken[0].driver_id === driver.id ? 'this_driver' : 'another_driver';
  if (linkedTo === 'another_driver') return answer({ result: 'blocked', reason: 'vendor_linked_to_another_driver', issues: [], matches: [{ ...matches[0], linkedTo }] });
  // A vendor not marked for 1099 tracking links fine but is called out: its payments would be left out of the 1099 report.
  return answer({ result: 'match', reason: null, issues: [], matches: [{ ...matches[0], linkedTo }], warnings: matches[0].vendor1099 ? [] : ['vendor_not_1099'] });
};

// Read-only: nothing is saved. result is match | no_match | ambiguous | blocked. `realmId` is the QuickBooks company the answer was read from (null when it was blocked
// before asking); the admin's Link must send it back, so a link can only ever be confirmed against the company the admin reviewed.
export const lookupVendor = async (db, admin, where, deps = {}) => {
  const { lookup, realmId } = await lookupInCompany(db, admin, where, deps);
  return { ...lookup, realmId };
};

const NOT_LINKABLE = {
  no_match: "no QuickBooks vendor has this driver's email; nothing was linked",
  ambiguous: 'more than one QuickBooks vendor has this driver\'s email; nothing was linked',
  blocked: 'this driver is blocked; nothing was linked',
};

export const linkVendor = async (db, admin, { cityId, driverId, vendorId, realmId: reviewedRealmId }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const driver = await loadDesiDriver(db, cityId, driverId); // one snapshot of the contact details (email AND phone): the lookup uses it and the link is saved only if it still holds
  // The company the admin reviewed in Look up. Without it, or if the fresh search was answered by another company (a reconnect between the two requests), nothing is linked.
  if (typeof reviewedRealmId !== 'string' || reviewedRealmId === '') throw new PayrollError(400, 'the QuickBooks company from the lookup is required; look the driver up again');
  const { lookup, realmId } = await lookupInCompany(db, admin, { cityId, driverId }, { ...deps, driver });
  if (realmId !== null && realmId !== reviewedRealmId) throw new PayrollError(409, 'the QuickBooks company changed since the lookup; look the driver up again');
  if (lookup.result !== 'match') throw new PayrollError(409, NOT_LINKABLE[lookup.result] ?? 'nothing was linked');
  const [match] = lookup.matches;
  if (String(vendorId) !== match.vendorId) throw new PayrollError(409, 'that is not the vendor found for this driver; look the driver up again');
  if (match.linkedTo === 'this_driver') throw new PayrollError(409, 'this driver is already linked to that vendor');

  const config = requireConfigured(deps.env ?? process.env);
  try {
    // Under the driver's lock (the same one the Everee links use), so a link and an unlink never interleave.
    const { rows } = await withDriverLock(db, driverId, async (tx) => {
      if (!(await contactStillVerified(tx, driverId, contactSnapshot(driver)))) throw new PayrollError(409, CONTACT_CHANGED_WHILE_LINKING);
      // The link is made in the company the vendor was found in, checked here, after the driver lock is held and in the same transaction as the insert. The connection
      // row is share-locked until the transaction ends: a reconnect that committed while this link waited for the driver lock is seen here and nothing is linked,
      // and a reconnect that starts now waits until this link is saved, so a link for the old company can never be written after the company changed.
      const { rows: [conn] } = await tx.query('SELECT realm_id FROM quickbooks_connection WHERE environment = $1 FOR SHARE', [config.environment]);
      if (!conn) throw new PayrollError(409, 'QuickBooks is not connected; connect it first');
      if (String(conn.realm_id) !== realmId) throw new PayrollError(409, 'the QuickBooks company changed since the lookup; look the driver up again');
      return tx.query(
        `INSERT INTO quickbooks_vendors (driver_id, environment, realm_id, vendor_id, link_source, tax_id_supplied, vendor_1099, linked_by)
         VALUES ($1, $2, $3, $4, 'existing_vendor', true, $5, $6) RETURNING ${LINK_COLUMNS}`,
        [driverId, config.environment, realmId, match.vendorId, match.vendor1099, admin.id]);
    });
    logger.info('Driver linked to a QuickBooks vendor', { driverId, environment: config.environment });
    return { link: viewOfLink(rows[0]), warnings: lookup.warnings ?? [] };
  } catch (error) {
    if (error.code === '23505') throw new PayrollError(409, 'this driver or this QuickBooks vendor is already linked');
    throw error;
  }
};

export const unlinkVendor = async (db, admin, { cityId, driverId, reason }, deps = {}) => {
  requireSuperAdmin(admin);
  await assertCityAllowed(db, admin, cityId);
  const config = requireConfigured(deps.env ?? process.env);
  await loadDesiDriver(db, cityId, driverId);
  const why = typeof reason === 'string' ? reason.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
  if (why.length < MIN_UNLINK_REASON) throw new PayrollError(400, 'give a reason for unlinking');
  const { rowCount } = await withDriverLock(db, driverId, (tx) => tx.query(
    `UPDATE quickbooks_vendors SET unlinked_by = $3, unlinked_at = now(), unlink_reason = $4 WHERE driver_id = $1 AND environment = $2 AND unlinked_at IS NULL`,
    [driverId, config.environment, admin.id, why]));
  if (rowCount === 0) throw new PayrollError(404, 'this driver is not linked to a QuickBooks vendor');
  logger.info('Driver unlinked from a QuickBooks vendor', { driverId, environment: config.environment });
  return { unlinked: true };
};
