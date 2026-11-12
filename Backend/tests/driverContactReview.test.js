import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getStatus as evereeStatus, startOnboarding as evereeStart } from '../services/payments/everee/driverOnboarding.js';
import { lookupDriver, linkDriver } from '../services/payments/everee/workerStore.js';
import { getStatus as quickbooksStatus, startOnboarding as quickbooksStart } from '../services/payments/quickbooks/driverOnboarding.js';
import { linkVendor, listCityVendors, lookupVendor } from '../services/payments/quickbooks/vendorStore.js';
import { onboardingReadiness } from '../services/payments/everee/onboardingReadiness.js';
import { confirmContact } from '../services/payments/contactReview.js';

// A driver who changes their own email or phone in the Profile page is held out of Everee and QuickBooks linking until a super admin confirms the
// new details. Needs a PostgreSQL copy (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything, the migration included,
// runs in one transaction that is always rolled back; Everee and QuickBooks are replaced by fakes that fail the test if they are called.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const EVEREE = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_DRIVER_ONBOARDING_ENABLED: 'true' };
const QUICKBOOKS = { QUICKBOOKS_ENABLED: 'true', QUICKBOOKS_ENVIRONMENT: 'sandbox', QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 's', QUICKBOOKS_REDIRECT_URI: 'https://nasa.example/cb', QUICKBOOKS_TOKEN_KEY: 'a'.repeat(64), QUICKBOOKS_DRIVER_ONBOARDING_ENABLED: 'true' };
const ADDRESS = { line1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701' };
const DESI_FORM = { legalName: 'Dee Test', addressLine1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701', taxId: '123-45-6789', certified: true };

test('a driver\'s changed email or phone is held out of Everee and QuickBooks until a super admin confirms it', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const touched = { everee: 0, quickbooks: 0 };
  const everee = { searchWorkers: async () => { touched.everee++; return { data: { items: [], totalItems: 0 } }; }, getWorker: async () => { touched.everee++; throw new Error('must not be called'); } };
  const quickbooks = { findVendorsByEmail: async () => { touched.quickbooks++; return []; }, createVendor: async () => { touched.quickbooks++; throw new Error('must not be called'); } };
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-143-pay-runs.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-06-issue-232-driver-type.sql', '2026-11-07-issue-242-everee-driver-onboarding.sql', '2026-11-10-quickbooks-connection.sql', '2026-11-11-driver-contact-review.sql']) await db.query(migration(m));
    const tag = randomUUID().slice(0, 8);
    const cityId = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Contact ${tag}`, `CR${tag.slice(0, 6)}`])).id;
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Contact ${tag}`, `cr${tag}@example.com`]);
    const plain = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id, role", [`Contact plain ${tag}`, `cp${tag}@example.com`]);
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [plain.id, cityId]);
    const [local, desi, linked, fresh] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 4')).rows.map((r) => r.id);
    const setUp = (id, type, n) => db.query(
      "UPDATE drivers SET driver_type = $2, agreement_signed = true, enabled = true, city_id = $3, name = $4, email = $5, phone_number = '5125550100', contact_changed_at = NULL, agreement_joining_date = current_date WHERE id = $1",
      [id, type, cityId, `Contact Driver ${n} ${tag}`, `cd${n}-${tag}@example.com`]);
    await setUp(local, 'LOCAL', 1); await setUp(desi, 'DESI', 2); await setUp(linked, 'LOCAL', 3); await setUp(fresh, 'LOCAL', 4);
    await db.query(
      "INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by, onboarding_complete) VALUES ($1, 'sandbox', '4321', $2, 'matched_email', $3, true)",
      [linked, `W-${tag}`, sup.id]);
    const held = (...ids) => db.query('UPDATE drivers SET contact_changed_at = now() WHERE id = ANY($1::int[])', [ids]);

    // nobody is held until a driver edits their contact
    assert.equal((await evereeStatus(db, local, { env: EVEREE })).state, 'not-started');
    assert.equal((await lookupDriver(db, sup, { cityId, driverId: local }, { env: EVEREE, client: everee })).result, 'no_match');
    assert.equal((await quickbooksStatus(db, desi, { env: QUICKBOOKS })).state, 'not-started');
    touched.everee = 0;

    await held(local, desi, linked);

    // Everee: the status says a super admin must confirm, the driver's own start writes and asks nothing, and the admin's lookup and link are refused
    const status = await evereeStatus(db, local, { env: EVEREE });
    assert.deepEqual([status.state, status.reason, status.canStart], ['needs-review', 'contact_changed', false]);
    const started = await evereeStart(db, local, { homeAddress: ADDRESS }, { client: everee, env: EVEREE });
    assert.deepEqual([started.started, started.state, started.reason], [false, 'needs-review', 'contact_changed']);
    assert.equal((await db.query('SELECT 1 FROM everee_onboarding WHERE driver_id = $1', [local])).rowCount, 0, 'nothing was recorded for the driver');
    const lookup = await lookupDriver(db, sup, { cityId, driverId: local }, { env: EVEREE, client: everee });
    assert.deepEqual([lookup.result, lookup.reason], ['blocked', 'contact_changed']);
    await assert.rejects(linkDriver(db, sup, { cityId, driverId: local, workerId: 'W-ANY' }, { env: EVEREE, client: everee }), (e) => e.status === 409);
    assert.equal(touched.everee, 0, 'Everee was never asked');

    // a driver who is already linked keeps their link: the hold only stops new links
    const linkedStatus = await evereeStatus(db, linked, { env: EVEREE });
    assert.deepEqual([linkedStatus.state, linkedStatus.reason], ['complete', null]);

    // QuickBooks: same for the Desi driver (self setup and the admin's lookup), and the list names the issue
    const qbStatus = await quickbooksStatus(db, desi, { env: QUICKBOOKS });
    assert.deepEqual([qbStatus.state, qbStatus.blockedBy, qbStatus.canStart], ['needs-review', 'contact_changed', false]);
    await assert.rejects(quickbooksStart(db, desi, DESI_FORM, { env: QUICKBOOKS, client: quickbooks }), (e) => e.status === 409 && e.code === 'needs_review' && e.review === 'contact_changed');
    const vendorLookup = await lookupVendor(db, sup, { cityId, driverId: desi }, { env: QUICKBOOKS, client: quickbooks });
    assert.deepEqual([vendorLookup.result, vendorLookup.reason], ['blocked', 'contact_changed']);
    const list = await listCityVendors(db, sup, cityId, { env: QUICKBOOKS });
    const listed = list.drivers.find((d) => d.driverId === desi);
    assert.deepEqual([listed.status, listed.issues], ['blocked', ['contact_changed']]);
    assert.ok(listed.contactChangedAt);
    assert.deepEqual(listed.contact, { email: `cd2-${tag}@example.com`, phone: '5125550100' });
    assert.equal(touched.quickbooks, 0, 'QuickBooks was never asked');

    // the readiness page shows the reason and the moment the admin is confirming
    const ready = await onboardingReadiness(db, sup, { cityId }, { env: EVEREE });
    const card = ready.drivers.find((d) => d.driverId === local);
    assert.deepEqual([card.state, card.reason], ['needs-review', 'contact_changed']);
    assert.ok(card.contactChangedAt);
    assert.deepEqual([card.contactEmail, card.contactPhone], [`cd1-${tag}@example.com`, '5125550100'], 'the admin sees the new details that the time belongs to');
    assert.equal(ready.drivers.find((d) => d.driverId === linked).state, 'complete');
    assert.equal(ready.drivers.find((d) => d.driverId === linked).contactChangedAt ?? null, null, 'a linked driver has nothing to confirm');
    assert.deepEqual([ready.drivers.find((d) => d.driverId === linked).contactEmail ?? null, ready.drivers.find((d) => d.driverId === fresh).contactPhone ?? null], [null, null], 'no one else has their contact shown');

    // confirming: only a super admin, only for a driver of that city, only for the details that were shown
    const shown = card.contactChangedAt;
    await assert.rejects(confirmContact(db, plain, { cityId, driverId: local, contactChangedAt: shown }), (e) => e.status === 403);
    await assert.rejects(confirmContact(db, sup, { cityId, driverId: local, contactChangedAt: 'not a date' }), (e) => e.status === 400);
    await assert.rejects(confirmContact(db, sup, { cityId, driverId: local }), (e) => e.status === 400);
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Contact other ${tag}`, `CO${tag.slice(0, 6)}`])).id;
    await assert.rejects(confirmContact(db, sup, { cityId: otherCity, driverId: local, contactChangedAt: shown }), (e) => e.status === 409, 'a driver of another city is not touched');
    await assert.rejects(confirmContact(db, sup, { cityId, driverId: local, contactChangedAt: new Date(new Date(shown).getTime() - 5000).toISOString() }), (e) => e.status === 409, 'details changed since they were shown');
    assert.notEqual((await one('SELECT contact_changed_at FROM drivers WHERE id = $1', [local])).contact_changed_at, null, 'nothing was cleared by the refusals');
    assert.deepEqual(await confirmContact(db, sup, { cityId, driverId: local, contactChangedAt: shown }), { confirmed: true });
    await assert.rejects(confirmContact(db, sup, { cityId, driverId: local, contactChangedAt: shown }), (e) => e.status === 409, 'confirming twice does nothing');

    // after the confirmation the driver is treated as before: the lookup asks Everee again and the status is back to not started
    assert.equal((await evereeStatus(db, local, { env: EVEREE })).state, 'not-started');
    assert.equal((await lookupDriver(db, sup, { cityId, driverId: local }, { env: EVEREE, client: everee })).result, 'no_match');
    assert.ok(touched.everee > 0);
    // the Desi driver is still held: confirming one driver never releases another
    assert.equal((await quickbooksStatus(db, desi, { env: QUICKBOOKS })).state, 'needs-review');
    assert.equal((await one('SELECT contact_changed_at FROM drivers WHERE id = $1', [fresh])).contact_changed_at, null);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release(); // the pool and Redis are closed by the last test of this file
  }
});

test('a contact change while a link is being made stops the link: nothing is written for details nobody confirmed', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const { EvereeError } = await import('../services/payments/everee/evereeClient.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-143-pay-runs.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-06-issue-232-driver-type.sql', '2026-11-07-issue-242-everee-driver-onboarding.sql', '2026-11-10-quickbooks-connection.sql', '2026-11-11-driver-contact-review.sql']) await db.query(migration(m));
    const tag = randomUUID().slice(0, 8);
    const cityId = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Racing ${tag}`, `RC${tag.slice(0, 6)}`])).id;
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Racing ${tag}`, `rc${tag}@example.com`]);
    await db.query(`INSERT INTO quickbooks_connection (environment, realm_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, connected_by)
      VALUES ('sandbox', '12345678', 'a', 'b', now() + interval '1 hour', now() + interval '1 day', $1) ON CONFLICT (environment) DO UPDATE SET realm_id = '12345678'`, [sup.id]);
    const [evAdmin, evSelf, qbAdmin, qbSelf] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 4')).rows.map((r) => r.id);
    const setUp = (id, type, n) => db.query(
      "UPDATE drivers SET driver_type = $2, agreement_signed = true, enabled = true, city_id = $3, name = $4, email = $5, phone_number = '5551230001', contact_changed_at = NULL, agreement_joining_date = current_date WHERE id = $1",
      [id, type, cityId, `Racing Driver ${n} ${tag}`, `rc${n}-${tag}@example.com`]);
    await setUp(evAdmin, 'LOCAL', 1); await setUp(evSelf, 'LOCAL', 2); await setUp(qbAdmin, 'DESI', 3); await setUp(qbSelf, 'DESI', 4);
    // the driver saves a new phone while the provider call is in flight (what the Profile page does)
    const changesContact = (id) => db.query("UPDATE drivers SET phone_number = '5559990000', contact_changed_at = now() WHERE id = $1", [id]);
    const links = async (table, id) => (await db.query(`SELECT 1 FROM ${table} WHERE driver_id = $1`, [id])).rowCount;
    const refused = (promise) => assert.rejects(promise, (e) => e.status === 409 && /changed while linking|confirm your new contact/.test(e.message));

    // Everee, admin link: the lookup finds the worker, the driver changes their phone while the worker is read, the link is refused
    const worker = { workerId: 'W-RACE', firstName: 'Race', lastName: 'One', email: `rc1-${tag}@example.com`, phoneNumber: '5551230001' };
    const everee = { searchWorkers: async () => ({ data: { items: [worker], totalItems: 1 } }), getWorker: async () => { await changesContact(evAdmin); return { data: { id: 'W-RACE', onboardingComplete: true, tinVerificationStatus: 'VERIFIED' } }; } };
    await refused(linkDriver(db, sup, { cityId, driverId: evAdmin, workerId: 'W-RACE' }, { env: EVEREE, client: everee }));
    assert.equal(await links('everee_workers', evAdmin), 0);

    // Everee, the driver's own Start: the worker is created, the driver changes their phone before the link is saved, nothing is linked and the lease is let go
    const created = new Map();
    const selfClient = {
      getWorker: async () => { throw new EvereeError('Everee did not find what was asked for', { status: 404 }); },
      searchWorkers: async (term) => {
        const items = [...created.values()].filter((w) => w.externalWorkerId === term).map((w) => ({ workerId: w.workerId, externalWorkerId: w.externalWorkerId, email: w.email, phoneNumber: w.phoneNumber }));
        return { data: { items, totalItems: items.length } };
      },
      createEmbeddedContractor: async (body) => {
        created.set(body.externalWorkerId, { workerId: `CAN-${body.externalWorkerId}`, externalWorkerId: body.externalWorkerId, email: body.email, phoneNumber: body.phoneNumber });
        await changesContact(evSelf);
        return { data: { id: body.externalWorkerId, onboardingComplete: false } };
      },
    };
    const started = await evereeStart(db, evSelf, { homeAddress: ADDRESS }, { client: selfClient, env: EVEREE });
    assert.deepEqual([started.started, started.state, started.reason], [false, 'needs-review', 'contact_changed']);
    assert.equal(await links('everee_workers', evSelf), 0);
    assert.equal((await one('SELECT lease_until FROM everee_onboarding WHERE driver_id = $1', [evSelf])).lease_until, null, 'the claim is let go');
    // once a super admin has confirmed, the next Start finds the worker made earlier by our own ID and links it
    await db.query('UPDATE drivers SET contact_changed_at = NULL WHERE id = $1', [evSelf]);
    const found = { ...selfClient, getWorker: async (id) => ({ data: { id, onboardingComplete: false } }) };
    const again = await evereeStart(db, evSelf, { homeAddress: ADDRESS }, { client: found, env: EVEREE });
    assert.equal(again.started, true);
    assert.equal(await links('everee_workers', evSelf), 1);

    // QuickBooks, admin link: same
    const vendor = { Id: '58', DisplayName: 'Racing Three', Active: true, Vendor1099: true, PrimaryEmailAddr: { Address: `rc3-${tag}@example.com` } };
    const qb = { findVendorsByEmail: async () => { await changesContact(qbAdmin); return Object.assign([vendor], { realmId: '12345678' }); } };
    await refused(linkVendor(db, sup, { cityId, driverId: qbAdmin, vendorId: '58' }, { env: QUICKBOOKS, client: qb }));
    assert.equal(await links('quickbooks_vendors', qbAdmin), 0);

    // QuickBooks, the driver's own setup: the vendor is created, the driver changes their phone before the link is saved, nothing is linked
    const selfQb = { findVendorsByEmail: async () => [], createVendor: async () => { await changesContact(qbSelf); return { Id: '77', Vendor1099: true }; } };
    await refused(quickbooksStart(db, qbSelf, DESI_FORM, { env: QUICKBOOKS, client: selfQb }));
    assert.equal(await links('quickbooks_vendors', qbSelf), 0);
    assert.equal((await quickbooksStatus(db, qbSelf, { env: QUICKBOOKS })).blockedBy, 'contact_changed');
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
    (await import('../config/redis.js')).default.quit().catch(() => {});
  }
});
