import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDetails, vendorBody } from '../services/payments/quickbooks/onboardingRules.js';
import { getStatus, OnboardingError, startOnboarding } from '../services/payments/quickbooks/driverOnboarding.js';
import { createQuickbooksClient, QuickbooksError } from '../services/payments/quickbooks/quickbooksClient.js';
import { readQuickbooksConfig } from '../services/payments/quickbooks/quickbooksConfig.js';
import { linkVendor, lookupVendor } from '../services/payments/quickbooks/vendorStore.js';
import { blockedDriverIds } from '../services/payments/everee/onboardingGate.js';

const BASE = { QUICKBOOKS_ENABLED: 'true', QUICKBOOKS_ENVIRONMENT: 'sandbox', QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 's', QUICKBOOKS_REDIRECT_URI: 'https://nasa.example/cb', QUICKBOOKS_TOKEN_KEY: 'a'.repeat(64) };
const ON = { ...BASE, QUICKBOOKS_DRIVER_ONBOARDING_ENABLED: 'true' };
const ENFORCED = { ...ON, QUICKBOOKS_ONBOARDING_ENFORCED: 'true' };
const TAX = '123-45-6789';
const good = { legalName: 'Dee Test', addressLine1: '1 Test Street', city: 'Austin', state: 'tx', postalCode: '78701', taxId: TAX, certified: true };

test('the form rules name what is missing without echoing the tax ID, and the vendor is a 1099 contractor with the driver\'s own email', () => {
  const { details, missing } = parseDetails(good);
  assert.deepEqual(missing, []);
  assert.equal(details.taxId, '123456789');
  assert.equal(details.state, 'TX');
  const bad = parseDetails({ ...good, taxId: '111-11-1111', state: 'Texas', postalCode: 'abc', legalName: 'x', certified: false });
  assert.deepEqual(bad.missing.sort(), ['certified', 'legalName', 'postalCode', 'state', 'taxId']);
  assert.ok(!JSON.stringify(bad.missing).includes('1111'));
  for (const taxId of ['12345678', '000-12-3456', '1234567890', 'abcdefghi']) assert.ok(parseDetails({ ...good, taxId }).missing.includes('taxId'));
  const body = vendorBody({ details, email: 'dee@example.com', phone: '5125550100' });
  assert.deepEqual([body.Vendor1099, body.TaxIdentifier, body.PrimaryEmailAddr.Address, body.GivenName, body.FamilyName], [true, '123456789', 'dee@example.com', 'Dee', 'Test']);
});

const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

// A stand-in for ONE QuickBooks company, spoken to through the real client: it answers the query language like QuickBooks does (a vendor query that filters on the
// email is refused, which is what happened in production), keeps the vendors that are created (the same request id gives the first answer back, a repeated name is
// refused), and treats anything that is not a vendor read or create as forbidden, so a payout of any kind would show up in `forbidden`.
const quickbooksCompany = ({ vendors = [], lostAnswerOnce = false } = {}) => {
  const book = { vendors: vendors.map((v) => ({ Active: true, Vendor1099: true, ...v })), created: [], forbidden: [], byRequestId: new Map(), lost: lostAnswerOnce };
  const reply = (status, body) => ({ ok: status < 400, status, headers: { get: (n) => (n === 'intuit_tid' ? 'tid-1' : null) }, json: async () => body });
  const fetchImpl = async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace(/^\/v3\/company\/\d+/, '');
    if (options.method === 'GET' && path === '/query') {
      const sql = searchParams.get('query');
      if (/where[^]*PrimaryEmailAddr/i.test(sql.replace(/select [^]*? from/i, ''))) return reply(400, { Fault: { Error: [{ Message: 'QueryValidationError', Detail: "QueryValidationError: property 'PrimaryEmailAddr' is not queryable", code: '4000' }] } });
      if (/select count\(\*\) from Vendor/.test(sql)) return reply(200, { QueryResponse: { totalCount: book.vendors.filter((v) => v.Active).length } });
      const start = Number(/startposition (\d+)/.exec(sql)[1]);
      const rows = book.vendors.filter((v) => v.Active).slice(start - 1, start - 1 + 1000);
      return reply(200, { QueryResponse: rows.length ? { Vendor: rows, startPosition: start } : {} });
    }
    if (options.method === 'POST' && path === '/vendor') {
      const requestId = searchParams.get('requestid');
      const body = JSON.parse(options.body);
      if (book.byRequestId.has(requestId)) return reply(200, { Vendor: book.byRequestId.get(requestId) });
      if (book.vendors.some((v) => v.DisplayName?.toLowerCase() === body.DisplayName.toLowerCase())) return reply(400, { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } });
      const made = { Id: String(700 + book.vendors.length), Active: true, DisplayName: body.DisplayName, Vendor1099: body.Vendor1099, PrimaryEmailAddr: body.PrimaryEmailAddr };
      book.vendors.push(made);
      book.created.push({ body, requestId });
      book.byRequestId.set(requestId, made);
      if (book.lost) { book.lost = false; throw new TypeError('the answer was lost'); } // QuickBooks made the vendor, but NASA never heard back
      return reply(200, { Vendor: made });
    }
    book.forbidden.push(`${options.method} ${path}`);
    return reply(500, {});
  };
  const config = readQuickbooksConfig(ON);
  book.client = createQuickbooksClient(config, async () => ({ accessToken: 'AT', realmId: '12345678' }), { fetchImpl });
  return book;
};

test('desi onboarding and the hold, against a database copy', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-143-pay-runs.sql', '2026-11-06-issue-232-driver-type.sql', '2026-11-10-quickbooks-connection.sql']) await db.query(migration(m));
    const tag = randomUUID();
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id", [`Test ${tag}`, `s${tag}@example.com`]);
    const [dNew, dTwo, dLocal, dNone, dUnsigned, dFresh, dExisting, dAmbiguous, dLost] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 9')).rows.map((r) => r.id);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = true, email = 'dee@example.com', phone_number = '5125550100', name = 'Dee Test' WHERE id = ANY($1::int[])", [[dNew]]);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = true, email = 'two@example.com' WHERE id = $1", [dTwo]);
    await db.query("UPDATE drivers SET driver_type = 'LOCAL', agreement_signed = true WHERE id = $1", [dLocal]);
    await db.query('UPDATE drivers SET driver_type = NULL WHERE id = $1', [dNone]);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = false, email = 'u@example.com' WHERE id = $1", [dUnsigned]);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = true, contact_changed_at = NULL, email = e.email, name = e.name, phone_number = '5125550111' FROM (VALUES ($1::int, 'fresh@example.com', 'Fresh Desi'), ($2::int, 'known@example.com', 'Known Desi'), ($3::int, 'twice@example.com', 'Twice Desi'), ($4::int, 'lost@example.com', 'Lost Desi')) AS e(id, email, name) WHERE drivers.id = e.id", [dFresh, dExisting, dAmbiguous, dLost]);
    await db.query('DELETE FROM quickbooks_vendors WHERE driver_id = ANY($1::int[])', [[dNew, dTwo, dLocal, dNone, dUnsigned, dFresh, dExisting, dAmbiguous, dLost]]);
    await db.query(`INSERT INTO quickbooks_connection (environment, realm_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, connected_by)
      VALUES ('sandbox', '12345678', 'x', 'x', now() + interval '1 hour', now() + interval '90 days', $1) ON CONFLICT (environment) DO UPDATE SET realm_id = '12345678'`, [sup.id]);

    const made = [];
    const asked = [];
    const fake = ({ existing = [], createError = null, answer = null } = {}) => ({
      findVendorsByEmail: async (email, opts) => { asked.push(opts); return existing; },
      createVendor: async (body, requestId, opts) => { made.push({ body, requestId, opts }); if (createError) throw createError; return answer ?? { Id: '501', Vendor1099: true }; },
    });
    const start = (driver, client, body = good, env = ON) => startOnboarding(db, driver, body, { env, client });
    const code = (promise) => promise.then(() => null, (e) => (e instanceof OnboardingError ? e.code : `other:${e.message}`));

    await t.test('who needs it: only a Desi driver, only when the switch is on; the agreement comes first', async () => {
      assert.equal((await getStatus(db, dNew, { env: BASE })).required, false, 'switch off');
      for (const id of [dLocal, dNone]) assert.deepEqual([(await getStatus(db, id, { env: ON })).state, (await getStatus(db, id, { env: ON })).required], ['not-required', false]);
      assert.deepEqual(await getStatus(db, dNew, { env: ON }), { driverType: 'DESI', agreementSigned: true, enforced: false, state: 'not-started', required: true, canStart: true, blockedBy: null, needsFromDriver: ['legalName', 'address', 'taxId', 'certified'] });
      const unsigned = await getStatus(db, dUnsigned, { env: ON });
      assert.deepEqual([unsigned.canStart, unsigned.blockedBy], [false, 'agreement']);
      assert.equal(await code(start(dUnsigned, fake())), 'agreement_required');
      assert.equal(await code(start(dLocal, fake())), 'not_required');
      assert.deepEqual(made, []);
    });

    await t.test('missing details are refused with the field names and nothing is sent to QuickBooks', async () => {
      await assert.rejects(start(dNew, fake(), { ...good, certified: false, taxId: '12' }), (e) => e.status === 400 && e.missing.includes('certified') && e.missing.includes('taxId') && !JSON.stringify(e).includes('12-'));
      assert.deepEqual(made, []);
    });

    await t.test('a vendor that already has the driver\'s email, or the same name, goes to review and nothing is made or linked', async () => {
      assert.equal(await code(start(dNew, fake({ existing: [{ Id: '9' }] }))), 'needs_review');
      assert.deepEqual(made, []);
      assert.equal(await code(start(dNew, fake({ createError: new QuickbooksError('QuickBooks answered 400: Duplicate Name Exists Error', { status: 400, code: '6240' }) }))), 'needs_review');
      assert.equal((await one('SELECT count(*)::int n FROM quickbooks_vendors WHERE driver_id = $1', [dNew])).n, 0);
    });

    await t.test('QuickBooks being down is "try later", a refusal is "check the details", and neither echoes the provider text', async () => {
      assert.equal(await code(start(dNew, fake({ createError: new QuickbooksError('QuickBooks did not answer in time') }))), 'service_unavailable');
      assert.equal(await code(start(dNew, fake({ createError: new QuickbooksError('QuickBooks answered 500', { status: 500 }) }))), 'service_unavailable');
      await assert.rejects(start(dNew, fake({ createError: new QuickbooksError('QuickBooks answered 400: bad TIN 123456789', { status: 400, code: '2020' }) })), (e) => e.code === 'quickbooks_refused' && !e.message.includes('123456789'));
      assert.equal(await code(start(dNew, fake({ answer: { Id: '7', Vendor1099: false } }))), 'unexpected_answer');
    });

    await t.test('a good setup creates a 1099 vendor with NASA\'s email and the tax ID once, links it, and stores no tax ID', async () => {
      made.length = 0;
      const status = await start(dNew, fake());
      assert.deepEqual([status.state, status.required], ['complete', false]);
      assert.equal(made.length, 1);
      assert.equal(made[0].requestId, `nasa-vendor-${dNew}`);
      assert.equal(made[0].opts.realm, '12345678', 'the vendor is made in the company the search was pinned to');
      assert.deepEqual([made[0].body.Vendor1099, made[0].body.TaxIdentifier, made[0].body.PrimaryEmailAddr.Address], [true, '123456789', 'dee@example.com']);
      const link = await one('SELECT * FROM quickbooks_vendors WHERE driver_id = $1', [dNew]);
      assert.deepEqual([link.vendor_id, link.link_source, link.tax_id_supplied, link.vendor_1099, link.linked_by, link.realm_id], ['501', 'created_by_onboarding', true, true, null, '12345678']);
      assert.ok(link.w9_certified_at);
      assert.ok(!JSON.stringify(link).includes('123456789'), 'no tax ID is stored');
      assert.equal(await code(start(dNew, fake())), 'already_complete');
      assert.equal(made.length, 1);
    });

    await t.test('the hold: with enforcement on, a Desi driver without a vendor is held; one with a vendor is not; Local and untyped drivers are unaffected', async () => {
      assert.deepEqual([...await blockedDriverIds(db, [dNew, dTwo], { env: ON })], [], 'not enforced');
      assert.deepEqual([...await blockedDriverIds(db, [dNew, dTwo, dLocal, dNone], { env: ENFORCED })], [dTwo]);
      assert.deepEqual([...await blockedDriverIds(db, [dTwo], { env: ENFORCED, lock: true })], [dTwo]);
      await db.query("UPDATE quickbooks_connection SET realm_id = '99999999' WHERE environment = 'sandbox'");
      assert.deepEqual([...await blockedDriverIds(db, [dNew], { env: ENFORCED })], [dNew], 'a link to another company does not count');
      await db.query("UPDATE quickbooks_connection SET realm_id = '12345678' WHERE environment = 'sandbox'");
    });

    // The whole path through the real client and a stateful QuickBooks company: the driver's setup (Jasil's review of #283), then the admin's Look up and Link.
    const admin = { id: sup.id, role: 'superadmin' };
    const cityOf = async (id) => (await one('SELECT city_id FROM drivers WHERE id = $1', [id])).city_id;
    const setupWith = (driver, company, body = good) => startOnboarding(db, driver, body, { env: ON, client: company.client });
    const linkRows = async (id) => (await db.query('SELECT vendor_id, link_source, realm_id FROM quickbooks_vendors WHERE driver_id = $1 AND unlinked_at IS NULL', [id])).rows;
    const noMoney = async (company) => {
      assert.deepEqual(company.forbidden, [], 'setup and lookup only read and create vendors: no bill, no payment, nothing else was sent to QuickBooks');
      for (const table of ['quickbooks_payment_attempts', 'quickbooks_bills']) {
        if ((await db.query('SELECT to_regclass($1) AS t', [table])).rows[0].t) assert.equal((await one(`SELECT count(*)::int n FROM ${table}`)).n, 0, `${table} stays empty`);
      }
    };

    await t.test('a new Desi driver finishes setup alone: one 1099 vendor, linked, no bank details asked for, no payout started', async () => {
      const company = quickbooksCompany({ vendors: [{ Id: '1', DisplayName: 'Someone Else', PrimaryEmailAddr: { Address: 'else@example.com' } }] });
      assert.deepEqual((await getStatus(db, dFresh, { env: ON })).needsFromDriver, ['legalName', 'address', 'taxId', 'certified'], 'the form asks for name, address, tax ID and the certification only');
      const status = await setupWith(dFresh, company);
      assert.deepEqual([status.state, status.required], ['complete', false]);
      assert.equal(company.created.length, 1);
      assert.deepEqual([company.created[0].body.PrimaryEmailAddr.Address, company.created[0].body.Vendor1099], ['fresh@example.com', true]);
      assert.ok(!JSON.stringify(company.created[0].body).match(/bank|routing|AcctNum/i), 'no bank account or routing detail is sent');
      assert.deepEqual((await linkRows(dFresh)).map((r) => [r.link_source, r.realm_id]), [['created_by_onboarding', '12345678']]);
      assert.equal(await code(setupWith(dFresh, company)), 'already_complete', 'a second try is refused');
      assert.equal(company.vendors.length, 2);
      await noMoney(company);
    });

    await t.test('a driver who already has a QuickBooks vendor is not given a second one: the admin reviews, the lookup finds that vendor, and the link completes setup', async () => {
      const company = quickbooksCompany({ vendors: [{ Id: '58', DisplayName: 'Known Desi', PrimaryEmailAddr: { Address: 'Known@Example.com' } }] });
      for (let tries = 0; tries < 2; tries += 1) assert.equal(await code(setupWith(dExisting, company)), 'needs_review', 'every retry goes to review');
      assert.deepEqual([company.created.length, company.vendors.length, (await linkRows(dExisting)).length], [0, 1, 0], 'nothing created, nothing linked by the driver');
      const where = { cityId: await cityOf(dExisting), driverId: dExisting };
      const found = await lookupVendor(db, admin, where, { env: ON, client: company.client });
      assert.deepEqual([found.result, found.matches[0].vendorId, found.matches[0].linkedTo], ['match', '58', null]);
      await linkVendor(db, admin, { ...where, vendorId: '58' }, { env: ON, client: company.client });
      assert.deepEqual((await linkRows(dExisting)).map((r) => [r.vendor_id, r.link_source]), [['58', 'existing_vendor']]);
      assert.equal((await getStatus(db, dExisting, { env: ON })).state, 'complete');
      assert.equal(await code(setupWith(dExisting, company)), 'already_complete');
      assert.equal(company.vendors.length, 1, 'still one vendor');
      await noMoney(company);
    });

    await t.test('two vendors with the driver\'s email are unclear: the driver goes to review, nothing is created, and the admin lookup says ambiguous and links nothing', async () => {
      const company = quickbooksCompany({ vendors: [{ Id: '1', DisplayName: 'Twice A', PrimaryEmailAddr: { Address: 'twice@example.com' } }, { Id: '2', DisplayName: 'Twice B', PrimaryEmailAddr: { Address: 'twice@example.com' } }] });
      assert.equal(await code(setupWith(dAmbiguous, company)), 'needs_review');
      const where = { cityId: await cityOf(dAmbiguous), driverId: dAmbiguous };
      assert.equal((await lookupVendor(db, admin, where, { env: ON, client: company.client })).result, 'ambiguous');
      await assert.rejects(linkVendor(db, admin, { ...where, vendorId: '1' }, { env: ON, client: company.client }), (e) => e.status === 409);
      assert.deepEqual([company.created.length, (await linkRows(dAmbiguous)).length], [0, 0]);
      await noMoney(company);
    });

    await t.test('retrying after QuickBooks made the vendor but the answer was lost does not make a second vendor', async () => {
      const company = quickbooksCompany({ lostAnswerOnce: true });
      assert.equal(await code(setupWith(dLost, company)), 'service_unavailable', 'the driver is told to try later');
      assert.equal(company.vendors.length, 1, 'QuickBooks did make the vendor');
      assert.equal((await linkRows(dLost)).length, 0, 'but NASA never linked it');
      assert.equal(await code(setupWith(dLost, company)), 'needs_review', 'the retry finds that vendor by email and does not create another');
      assert.equal(company.created.length, 1, 'only one create call ever reached QuickBooks that held a new vendor');
      const where = { cityId: await cityOf(dLost), driverId: dLost };
      const found = await lookupVendor(db, admin, where, { env: ON, client: company.client });
      assert.deepEqual([found.result, found.matches[0].vendorId], ['match', company.vendors[0].Id]);
      await linkVendor(db, admin, { ...where, vendorId: company.vendors[0].Id }, { env: ON, client: company.client });
      assert.equal((await getStatus(db, dLost, { env: ON })).state, 'complete');
      assert.equal(company.vendors.length, 1);
      await noMoney(company);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});
