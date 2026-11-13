import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuickbooksConfig } from '../services/payments/quickbooks/quickbooksConfig.js';
import { linkVendor, listCityVendors, lookupVendor, unlinkVendor } from '../services/payments/quickbooks/vendorStore.js';
import { checkQuickbooks, finishConnect, getQuickbooksStatus, startConnect } from '../services/payments/quickbooks/quickbooksService.js';
import { createConnectState } from '../services/payments/quickbooks/connectionStore.js';
import { QuickbooksError } from '../services/payments/quickbooks/quickbooksClient.js';

const env = { QUICKBOOKS_ENABLED: 'true', QUICKBOOKS_ENVIRONMENT: 'sandbox', QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 's', QUICKBOOKS_REDIRECT_URI: 'https://nasa.example/admin/payroll/quickbooks/callback', QUICKBOOKS_TOKEN_KEY: 'a'.repeat(64) };
const superAdmin = { id: 1, role: 'superadmin' };
const plainAdmin = { id: 2, role: 'admin' };
const vendor = (over = {}) => ({ Id: '58', DisplayName: 'Desi One', Active: true, Vendor1099: true, PrimaryEmailAddr: { Address: 'desi@example.com' }, ...over });

// An in-memory stand-in for the queries the store makes.
const fakeDb = ({ driver = { id: 7, name: 'Desi One', email: 'Desi@Example.com', city_id: 1 }, taken = [], insertError = null, atLink = {}, reconnectAtLock = null } = {}) => { // atLink: how the driver's row looks when the link is saved; reconnectAtLock: QuickBooks is reconnected to this company while the link waits for the driver lock
  const log = [];
  let realm = '12345678';
  return { log, query: async (sql, p = []) => {
    log.push({ sql, p });
    if (/pg_advisory_xact_lock/.test(sql) && reconnectAtLock) realm = reconnectAtLock;
    if (/FROM drivers WHERE id = \$1 AND city_id = \$2 AND driver_type = 'DESI'/.test(sql)) return { rows: driver && p[0] === driver.id && p[1] === driver.city_id ? [driver] : [] };
    if (/SELECT email, phone_number, contact_changed_at FROM drivers WHERE id = \$1 FOR SHARE/.test(sql)) return { rows: [{ email: driver.email, phone_number: driver.phone_number ?? null, contact_changed_at: null, ...atLink }] };
    if (/SELECT driver_id FROM quickbooks_vendors/.test(sql)) return { rows: taken };
    if (/SELECT realm_id FROM quickbooks_connection/.test(sql)) return { rows: [{ realm_id: realm }] };
    if (/SAVEPOINT|pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/INSERT INTO quickbooks_vendors/.test(sql)) { if (insertError) throw insertError; return { rows: [{ id: 1, driver_id: p[0], vendor_id: p[3], link_source: 'existing_vendor', tax_id_supplied: true, vendor_1099: p[4], linked_at: 'now' }] }; }
    if (/UPDATE quickbooks_vendors/.test(sql)) return { rowCount: 1, rows: [] };
    if (/FROM drivers d/.test(sql)) return { rows: [
      { id: 7, name: 'Desi One', email: 'desi@example.com', vendor_id: '58', link_source: 'existing_vendor', tax_id_supplied: true, vendor_1099: true },
      { id: 8, name: 'Desi Two', email: 'two@example.com', vendor_id: null },
      { id: 9, name: 'Desi Three', email: '', vendor_id: null }] };
    throw new Error(`unexpected query ${sql}`);
  } };
};
const clientOf = (vendors, realmId = '12345678') => ({ findVendorsByEmail: async (email) => { clientOf.asked = email; return Object.assign([...vendors], { realmId }); } });
const deps = (vendors, realmId) => ({ env, client: clientOf(vendors, realmId) });
const where = { cityId: 1, driverId: 7 };

test('only a super admin may look up, link, unlink or list', async () => {
  for (const call of [() => lookupVendor(fakeDb(), plainAdmin, where, deps([])), () => linkVendor(fakeDb(), plainAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([])),
    () => unlinkVendor(fakeDb(), plainAdmin, { ...where, reason: 'left' }, deps([])), () => listCityVendors(fakeDb(), plainAdmin, 1, { env })]) {
    await assert.rejects(call, (e) => e.status === 403);
  }
});

test('a link is refused, and nothing is written, when the driver\'s email or phone changed or is held by the time it is saved', async () => {
  for (const atLink of [{ email: 'new@example.com' }, { phone_number: '5551110000' }, { contact_changed_at: new Date() }]) {
    const db = fakeDb({ atLink });
    await assert.rejects(linkVendor(db, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()])), (e) => e.status === 409 && /changed while linking/.test(e.message));
    assert.ok(!db.log.some((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)));
  }
});

test('a driver with a phone number can be linked: the contact snapshot reads the phone as well as the email', async () => {
  const db = fakeDb({ driver: { id: 7, name: 'Desi One', email: 'desi@example.com', phone_number: '5125550100', city_id: 1 } });
  const { link } = await linkVendor(db, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()]));
  assert.equal(link.vendorId, '58');
  assert.ok(db.log.some((entry) => /FROM drivers WHERE id = \$1 AND city_id = \$2 AND driver_type = 'DESI'/.test(entry.sql) && /phone_number/.test(entry.sql)), 'the driver is loaded with the phone the link is checked against');
});

test('lookup matches on the driver email only and names the one vendor found', async () => {
  const result = await lookupVendor(fakeDb(), superAdmin, where, deps([vendor()]));
  assert.equal(result.result, 'match');
  assert.equal(clientOf.asked, 'desi@example.com');
  assert.deepEqual(result.matches[0], { vendorId: '58', displayName: 'Desi One', vendor1099: true, linkedTo: null });
  assert.deepEqual(result.warnings, []);
});

test('no vendor, several vendors, an inactive vendor or a different email are never a match', async () => {
  assert.equal((await lookupVendor(fakeDb(), superAdmin, where, deps([]))).result, 'no_match');
  assert.equal((await lookupVendor(fakeDb(), superAdmin, where, deps([vendor(), vendor({ Id: '59' })]))).result, 'ambiguous');
  assert.equal((await lookupVendor(fakeDb(), superAdmin, where, deps([vendor({ Active: false })]))).result, 'no_match');
  assert.equal((await lookupVendor(fakeDb(), superAdmin, where, deps([vendor({ PrimaryEmailAddr: { Address: 'other@example.com' } })]))).result, 'no_match');
});

test('a vendor already linked to another driver is blocked; to this driver is flagged; a non-1099 vendor is warned about', async () => {
  const other = await lookupVendor(fakeDb({ taken: [{ driver_id: 99 }] }), superAdmin, where, deps([vendor()]));
  assert.equal(other.result, 'blocked');
  assert.equal(other.reason, 'vendor_linked_to_another_driver');
  assert.equal((await lookupVendor(fakeDb({ taken: [{ driver_id: 7 }] }), superAdmin, where, deps([vendor()]))).matches[0].linkedTo, 'this_driver');
  assert.deepEqual((await lookupVendor(fakeDb(), superAdmin, where, deps([vendor({ Vendor1099: false })]))).warnings, ['vendor_not_1099']);
});

test('a search answered for another company than the connected one is refused, and a link is only ever made in the company it was found in', async () => {
  const other = fakeDb();
  await assert.rejects(lookupVendor(other, superAdmin, where, deps([vendor()], '99999999')), (e) => e.status === 409 && /different company/.test(e.message));
  const db = fakeDb();
  await assert.rejects(linkVendor(db, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()], '99999999')), (e) => e.status === 409);
  assert.ok(!db.log.some((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)));
  const ok = fakeDb();
  await linkVendor(ok, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()]));
  assert.equal(ok.log.find((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)).p[2], '12345678');
});

test('the lookup names the company it was read from, and a link must send that company back', async () => {
  assert.equal((await lookupVendor(fakeDb(), superAdmin, where, deps([vendor()]))).realmId, '12345678');
  assert.equal((await lookupVendor(fakeDb({ driver: { id: 7, name: 'x', email: '', city_id: 1 } }), superAdmin, where, deps([vendor()]))).realmId, null, 'blocked before asking: no company');
  for (const realmId of [undefined, '', 12345678]) {
    const db = fakeDb();
    await assert.rejects(linkVendor(db, superAdmin, { ...where, vendorId: '58', realmId }, deps([vendor()])), (e) => e.status === 400 && /company from the lookup/.test(e.message));
    assert.ok(!db.log.some((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)));
  }
});

test('a link confirmed for another company than the fresh search used is refused after a reconnect, and nothing is written', async () => {
  // The admin reviewed vendor 58 in company 11111111; QuickBooks is connected to 12345678 now, and a vendor with the same ID is found there.
  const db = fakeDb();
  await assert.rejects(linkVendor(db, superAdmin, { ...where, vendorId: '58', realmId: '11111111' }, deps([vendor()])), (e) => e.status === 409 && /company changed since the lookup/.test(e.message));
  assert.ok(!db.log.some((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)));
  const ok = fakeDb();
  await linkVendor(ok, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()]));
  assert.equal(ok.log.find((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)).p[2], '12345678');
});

test('the company is re-checked under the driver lock, in the transaction that inserts the link, and a reconnect while the link waits refuses it', async () => {
  // Reconnected to another company after the lookup and the fresh search, while the link was waiting for the driver lock: nothing is written.
  const raced = fakeDb({ reconnectAtLock: '99999999' });
  await assert.rejects(linkVendor(raced, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()])), (e) => e.status === 409 && /company changed since the lookup/.test(e.message));
  assert.ok(!raced.log.some((entry) => /INSERT INTO quickbooks_vendors/.test(entry.sql)), 'no link for the old company');
  // Normal link: the driver lock, then the connection row share-lock, then the insert, in that order, so the check and the write are in one transaction.
  const ok = fakeDb();
  await linkVendor(ok, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()]));
  const at = (re) => ok.log.findIndex((entry) => re.test(entry.sql));
  const [lock, share, insert] = [at(/pg_advisory_xact_lock/), at(/FROM quickbooks_connection WHERE environment = \$1 FOR SHARE/), at(/INSERT INTO quickbooks_vendors/)];
  assert.ok(lock >= 0 && share > lock && insert > share, `lock ${lock}, share ${share}, insert ${insert}`);
});

test('a driver with no email is blocked without asking QuickBooks, and a Local driver is not found at all', async () => {
  const result = await lookupVendor(fakeDb({ driver: { id: 7, name: 'x', email: '', city_id: 1 } }), superAdmin, where, { env, client: { findVendorsByEmail: () => { throw new Error('must not be called'); } } });
  assert.equal(result.result, 'blocked');
  await assert.rejects(() => lookupVendor(fakeDb({ driver: null }), superAdmin, where, deps([vendor()])), (e) => e.status === 404);
});

test('linking saves the vendor of the exact match with the connected company and no tax ID', async () => {
  const db = fakeDb();
  const { link } = await linkVendor(db, superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()]));
  assert.equal(link.vendorId, '58');
  const insert = db.log.find((q) => /INSERT INTO quickbooks_vendors/.test(q.sql));
  assert.deepEqual(insert.p, [7, 'sandbox', '12345678', '58', true, 1]);
  assert.ok(!/tax_identifier|ssn|tin\b/i.test(insert.sql.replace('tax_id_supplied', '')));
});

test('linking refuses a different vendor than the one found, a non-match, and a double link', async () => {
  await assert.rejects(() => linkVendor(fakeDb(), superAdmin, { ...where, vendorId: '999', realmId: '12345678' }, deps([vendor()])), (e) => e.status === 409 && /not the vendor found/.test(e.message));
  await assert.rejects(() => linkVendor(fakeDb(), superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([])), (e) => e.status === 409);
  await assert.rejects(() => linkVendor(fakeDb({ insertError: Object.assign(new Error('dup'), { code: '23505' }) }), superAdmin, { ...where, vendorId: '58', realmId: '12345678' }, deps([vendor()])), (e) => e.status === 409 && /already linked/.test(e.message));
});

test('unlinking needs a reason and keeps history', async () => {
  await assert.rejects(() => unlinkVendor(fakeDb(), superAdmin, { ...where, reason: ' ' }, { env }), (e) => e.status === 400);
  assert.deepEqual(await unlinkVendor(fakeDb(), superAdmin, { ...where, reason: 'left the company' }, { env }), { unlinked: true });
});

test('the list shows linked, unlinked and blocked Desi drivers with counts', async () => {
  const list = await listCityVendors(fakeDb(), superAdmin, 1, { env });
  assert.deepEqual(list.summary, { drivers: 3, linked: 1, unlinked: 1, blocked: 1 });
  assert.equal(list.drivers[2].issues[0], 'no_email');
});

// ---- the connection service ----
const stateDb = ({ activeOwners = new Set([1]) } = {}) => {
  const states = new Map();
  const saved = [];
  return { states, saved, query: async (sql, p = []) => {
    if (/DELETE FROM quickbooks_connect_state WHERE expires_at/.test(sql)) return { rows: [] };
    if (/INSERT INTO quickbooks_connect_state/.test(sql)) { states.set(p[0], { admin_id: p[1], environment: p[2], expires_at: p[3] }); return { rows: [] }; }
    if (/DELETE FROM quickbooks_connect_state WHERE state_hash/.test(sql)) { const r = states.get(p[0]); states.delete(p[0]); return { rows: r ? [r] : [] }; }
    if (/FROM admin WHERE id = \$1 AND role = 'superadmin' AND is_active IS TRUE/.test(sql)) return { rows: activeOwners.has(p[0]) ? [{ id: p[0] }] : [] };
    if (/INSERT INTO quickbooks_connection/.test(sql)) { saved.push(p); return { rows: [] }; }
    if (/FROM quickbooks_connection/.test(sql)) return { rows: [] };
    throw new Error(`unexpected query ${sql}`);
  } };
};

test('the status never shows secrets, and connecting needs the switch on and a super admin', async () => {
  const status = await getQuickbooksStatus(stateDb(), superAdmin, { env });
  assert.equal(status.enabled, true);
  assert.ok(!JSON.stringify(status).includes('a'.repeat(64)));
  await assert.rejects(() => getQuickbooksStatus(stateDb(), plainAdmin, { env }), (e) => e.status === 403);
  await assert.rejects(() => startConnect(stateDb(), superAdmin, { env: { ...env, QUICKBOOKS_ENABLED: 'false' } }), (e) => e.status === 409);
  const { url } = await startConnect(stateDb(), superAdmin, { env });
  assert.match(url, /^https:\/\/appcenter\.intuit\.com\/connect\/oauth2\?/);
});

test('the sign-in return must carry a fresh state made by the same admin, and works once', async () => {
  const config = readQuickbooksConfig(env);
  const db = stateDb();
  const ok = async (status) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8640000 }) });
  const state = await createConnectState(db, { adminId: 1, environment: config.environment });
  await assert.rejects(() => finishConnect(db, { id: 5, role: 'superadmin' }, { code: 'c', state, realmId: '12345678' }, { env, fetchImpl: ok }), (e) => e.status === 400); // another admin; state is spent
  const state2 = await createConnectState(db, { adminId: 1, environment: config.environment });
  assert.deepEqual(await finishConnect(db, superAdmin, { code: 'c', state: state2, realmId: '12345678' }, { env, fetchImpl: ok }), { environment: 'sandbox', realmId: '12345678' });
  await assert.rejects(() => finishConnect(db, superAdmin, { code: 'c', state: state2, realmId: '12345678' }, { env, fetchImpl: ok }), (e) => e.status === 400); // used twice
  await assert.rejects(() => finishConnect(db, superAdmin, { code: 'c', state: 'nope', realmId: '12345678' }, { env, fetchImpl: ok }), (e) => e.status === 400);
});

test('the sign-in return has no login header: the admin comes from the single-use state and must still be an active super admin', async () => {
  const config = readQuickbooksConfig(env);
  const ok = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, x_refresh_token_expires_in: 8640000 }) });
  const db = stateDb();
  const state = await createConnectState(db, { adminId: 1, environment: config.environment });
  assert.deepEqual(await finishConnect(db, null, { code: 'c', state, realmId: '12345678' }, { env, fetchImpl: ok }), { environment: 'sandbox', realmId: '12345678' });
  assert.equal(db.saved.at(-1).at(-1), 1, 'the connection is recorded for the admin who started it');
  await assert.rejects(() => finishConnect(db, null, { code: 'c', state, realmId: '12345678' }, { env, fetchImpl: ok }), (e) => e.status === 400); // used twice
  await assert.rejects(() => finishConnect(db, null, { code: 'c', state: 'nope', realmId: '12345678' }, { env, fetchImpl: ok }), (e) => e.status === 400);

  // An admin demoted or deactivated after starting is refused, and nothing is stored.
  const demoted = stateDb({ activeOwners: new Set() });
  const state2 = await createConnectState(demoted, { adminId: 1, environment: config.environment });
  await assert.rejects(() => finishConnect(demoted, null, { code: 'c', state: state2, realmId: '12345678' }, { env, fetchImpl: ok }), (e) => e.status === 403);
  assert.equal(demoted.saved.length, 0);
  // Switched off: refused before the state is touched.
  const off = stateDb();
  const state3 = await createConnectState(off, { adminId: 1, environment: config.environment });
  await assert.rejects(() => finishConnect(off, null, { code: 'c', state: state3, realmId: '12345678' }, { env: { ...env, QUICKBOOKS_ENABLED: 'false' }, fetchImpl: ok }), (e) => e.status === 409);
  assert.equal(off.states.size, 1);
});

test('the check says what went wrong instead of throwing', async () => {
  const notConfigured = await checkQuickbooks(stateDb(), superAdmin, { env: {} });
  assert.equal(notConfigured.ok, false);
  const notConnected = await checkQuickbooks(stateDb(), superAdmin, { env });
  assert.equal(notConnected.ok, false);
  assert.match(notConnected.reason, /not connected/);
  assert.ok(QuickbooksError);
});

// ---- the accounts a payment is booked to ----
import { getPaymentSettings, savePaymentSettings } from '../services/payments/quickbooks/quickbooksPayments.js';

test('the accounts come from QuickBooks, only a listed account may be saved, and only a super admin may', async () => {
  const written = [];
  const db = { query: async (sql, p = []) => {
    if (/FROM quickbooks_settings/.test(sql)) return { rows: [] };
    if (/FROM quickbooks_connection/.test(sql)) return { rows: [{ realm_id: '12345678' }] };
    if (/INSERT INTO quickbooks_settings/.test(sql)) { written.push(p); return { rows: [] }; }
    throw new Error(`unexpected query ${sql}`);
  } };
  const client = { listAccounts: async (type) => (type === 'Expense' ? [{ Id: '61', Name: 'Contract labor' }] : [{ Id: '35', Name: 'Checking' }]) };
  const settings = await getPaymentSettings(db, superAdmin, { env, client });
  assert.deepEqual([settings.expenseAccounts, settings.bankAccounts], [[{ id: '61', name: 'Contract labor' }], [{ id: '35', name: 'Checking' }]]);
  await assert.rejects(() => getPaymentSettings(db, plainAdmin, { env, client }), (e) => e.status === 403);
  await assert.rejects(() => savePaymentSettings(db, superAdmin, { expenseAccountId: '99', bankAccountId: '35' }, { env, client }), (e) => e.status === 400);
  await assert.rejects(() => savePaymentSettings(db, superAdmin, { expenseAccountId: '61', bankAccountId: '36' }, { env, client }), (e) => e.status === 400);
  assert.deepEqual(await savePaymentSettings(db, superAdmin, { expenseAccountId: '61', bankAccountId: '35' }, { env, client }), { saved: { expenseAccountId: '61', bankAccountId: '35' } });
  assert.deepEqual(written, [['sandbox', '61', '35', 1, '12345678']]);
});
