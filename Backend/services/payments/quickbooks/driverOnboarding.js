import logger from '../../../utils/logger.js';
import { normalizeEmail, normalizePhone } from '../everee/workerRules.js';
import { withDriverLock } from '../everee/driverLock.js';
import { contactSnapshot, contactStillVerified } from '../contactSnapshot.js';
import { quickbooksDriverOnboardingGate, quickbooksOnboardingEnforced, readQuickbooksConfig } from './quickbooksConfig.js';
import { createQuickbooksClient, QuickbooksError } from './quickbooksClient.js';
import { getAuth } from './connectionStore.js';
import { parseDetails, STATES, vendorBody } from './onboardingRules.js';

// A new Desi driver sets up their QuickBooks vendor from the driver portal (the Desi counterpart of the Everee onboarding). Everything here is about ONE driver, and that
// driver is always the one in the verified token: nothing the browser sends can name another driver or a vendor. The driver's email comes from NASA's own record.
//
// Rules, and why:
// - Only a DESI driver who has signed the NASA agreement can start. A driver without a type is never treated as Desi.
// - Existing Desi drivers are already vendors in QuickBooks and are linked by an admin. So before creating anything, QuickBooks is asked for a vendor with the driver's
//   email; if one exists the driver is NOT given a second vendor and nothing is linked: it goes to review for an admin (a driver cannot prove ownership of an existing record).
// - A vendor whose name already exists also goes to review (QuickBooks refuses duplicate names), never to a made-up different name.
// - The tax ID goes to QuickBooks once, with the 1099 flag on, and is not kept: NASA stores only that it was supplied and when the driver certified it.
// - "Complete" is a live vendor link for the connected company, made by this process; a screen never sets it.

export class OnboardingError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'OnboardingError';
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const loadDriver = async (db, driverId) => {
  const { rows } = await db.query('SELECT id, name, email, phone_number, driver_type, agreement_signed, contact_changed_at FROM drivers WHERE id = $1', [driverId]);
  return rows[0] ?? null;
};

const liveLink = async (db, driverId, config) => {
  const { rows } = await db.query(
    `SELECT v.vendor_id FROM quickbooks_vendors v JOIN quickbooks_connection c ON c.environment = v.environment AND c.realm_id = v.realm_id
      WHERE v.driver_id = $1 AND v.environment = $2 AND v.unlinked_at IS NULL`, [driverId, config.environment]);
  return rows[0] ?? null;
};

// What the portal needs to know. Makes no call to QuickBooks.
export const getStatus = async (db, driverId, { env = process.env, driver: loaded = null } = {}) => {
  const driver = loaded ?? await loadDriver(db, driverId); // startOnboarding passes the driver it loaded, so the status describes the details it sends
  if (!driver) throw new OnboardingError(404, 'driver_not_found', 'driver not found');
  const config = readQuickbooksConfig(env);
  const gate = quickbooksDriverOnboardingGate(config, env);
  const base = { driverType: driver.driver_type, agreementSigned: driver.agreement_signed === true, enforced: quickbooksOnboardingEnforced(env) };
  if (driver.driver_type !== 'DESI' || !gate.enabled) return { ...base, state: STATES.NOT_REQUIRED, required: false, canStart: false, blockedBy: null, needsFromDriver: [] };
  if (await liveLink(db, driverId, config)) return { ...base, state: STATES.COMPLETE, required: false, canStart: false, blockedBy: null, needsFromDriver: [] };
  // The driver changed their own email or phone: a super admin confirms the new details before they are used to look for or create a vendor.
  if (driver.contact_changed_at) return { ...base, state: STATES.NEEDS_REVIEW, required: true, canStart: false, blockedBy: 'contact_changed', needsFromDriver: [] };
  const blockedBy = !base.agreementSigned ? 'agreement' : !normalizeEmail(driver.email) ? 'email' : null;
  return { ...base, state: STATES.NOT_STARTED, required: true, canStart: blockedBy === null, blockedBy, needsFromDriver: ['legalName', 'address', 'taxId', 'certified'] };
};

const unavailable = () => new OnboardingError(503, 'service_unavailable', 'QuickBooks is not available right now; try again later');

// Creates the driver's vendor and links it. Throws OnboardingError for everything the driver can act on.
export const startOnboarding = async (db, driverId, body, deps = {}) => {
  const env = deps.env ?? process.env;
  // One snapshot of the driver: the status, the provider calls and the final check before the link all use these email and phone details.
  const driver = await loadDriver(db, driverId);
  if (!driver) throw new OnboardingError(404, 'driver_not_found', 'driver not found');
  const status = await getStatus(db, driverId, { env, driver });
  if (status.state === STATES.COMPLETE) throw new OnboardingError(409, 'already_complete', 'your QuickBooks setup is already complete');
  if (!status.required) throw new OnboardingError(409, 'not_required', 'QuickBooks setup is not needed for this driver');
  if (status.blockedBy === 'contact_changed') throw new OnboardingError(409, 'needs_review', 'your admin needs to confirm your new contact details before you can continue', { review: 'contact_changed' });
  if (status.blockedBy === 'agreement') throw new OnboardingError(409, 'agreement_required', 'sign the NASA agreement first');
  if (status.blockedBy === 'email') throw new OnboardingError(409, 'email_required', 'your account has no valid email address; ask your admin to add it');

  const { details, missing } = parseDetails(body);
  if (missing.length > 0) throw new OnboardingError(400, 'missing_fields', 'some details are missing or not valid', { missing });

  const config = readQuickbooksConfig(env);
  const email = normalizeEmail(driver.email);
  const phone = normalizePhone(driver.phone_number);
  const { rows: [conn] } = await db.query('SELECT realm_id FROM quickbooks_connection WHERE environment = $1', [config.environment]);
  if (!conn) throw unavailable();
  const client = deps.client ?? createQuickbooksClient(config, () => getAuth(db, config, { fetchImpl: deps.fetchImpl }), deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});

  let vendor;
  try {
    // Look before creating: the existing Desi drivers are already in QuickBooks, and a second vendor would split their 1099 total.
    const existing = await client.findVendorsByEmail(email, { realm: conn.realm_id });
    if (existing.length > 0) throw new OnboardingError(409, 'needs_review', 'we found you in QuickBooks already; your admin needs to confirm it before you can continue', { review: 'existing_vendor' });
    vendor = await client.createVendor(vendorBody({ details, email, phone }), `nasa-vendor-${driverId}`, { realm: conn.realm_id });
  } catch (error) {
    if (error instanceof OnboardingError) throw error;
    if (!(error instanceof QuickbooksError)) throw error;
    // Never the provider's wording to the driver (it can echo what was sent). Only the code and request ID are kept for support.
    logger.warn('QuickBooks vendor setup was not completed', { driverId, status: error.status, code: error.code, requestId: error.requestId });
    if (error.code === '6240') throw new OnboardingError(409, 'needs_review', 'a vendor with this name already exists in QuickBooks; your admin needs to confirm it before you can continue', { review: 'duplicate_name' });
    if (error.status !== null && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) throw new OnboardingError(422, 'quickbooks_refused', 'QuickBooks did not accept these details; check them and try again');
    throw unavailable();
  }
  if (!vendor?.Id || vendor.Vendor1099 !== true) {
    logger.error('QuickBooks answered with an unexpected vendor', { driverId, hasId: Boolean(vendor?.Id) });
    throw new OnboardingError(502, 'unexpected_answer', 'QuickBooks answered in a way we did not expect; your admin has been told to check it', { review: 'unexpected' });
  }

  try {
    // Under the driver's lock (the same one the Everee and admin links use): the link cannot interleave with an admin's unlink.
    await withDriverLock(db, driverId, async (tx) => {
      // The driver may have changed their email or phone while QuickBooks was working: then nothing is linked (a super admin confirms the new details first).
      if (!(await contactStillVerified(tx, driverId, contactSnapshot(driver)))) throw new OnboardingError(409, 'needs_review', 'your admin needs to confirm your new contact details before you can continue', { review: 'contact_changed' });
      return tx.query(
        `INSERT INTO quickbooks_vendors (driver_id, environment, realm_id, vendor_id, link_source, tax_id_supplied, vendor_1099, w9_certified_at, linked_by)
         VALUES ($1, $2, $3, $4, 'created_by_onboarding', true, true, now(), NULL)`,
        [driverId, config.environment, conn.realm_id, String(vendor.Id)]);
    });
  } catch (error) {
    if (error instanceof OnboardingError) {
      logger.warn('QuickBooks vendor created but not linked because the contact details changed', { driverId, vendorId: String(vendor.Id) });
      throw error;
    }
    if (error.code !== '23505') throw error; // already linked (a second tab): the answer below says complete
  }
  logger.info('Desi driver set up in QuickBooks', { driverId, environment: config.environment });
  return getStatus(db, driverId, { env });
};
