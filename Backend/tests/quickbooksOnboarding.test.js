import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDetails, vendorBody } from '../services/payments/quickbooks/onboardingRules.js';
import { getStatus, OnboardingError, startOnboarding } from '../services/payments/quickbooks/driverOnboarding.js';
import { QuickbooksError } from '../services/payments/quickbooks/quickbooksClient.js';
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

test('desi onboarding and the hold, against a database copy', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-143-pay-runs.sql', '2026-11-06-issue-232-driver-type.sql', '2026-11-10-quickbooks-connection.sql']) await db.query(migration(m));
    const tag = randomUUID();
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id", [`Test ${tag}`, `s${tag}@example.com`]);
    const [dNew, dTwo, dLocal, dNone, dUnsigned] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 5')).rows.map((r) => r.id);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = true, email = 'dee@example.com', phone_number = '5125550100', name = 'Dee Test' WHERE id = ANY($1::int[])", [[dNew]]);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = true, email = 'two@example.com' WHERE id = $1", [dTwo]);
    await db.query("UPDATE drivers SET driver_type = 'LOCAL', agreement_signed = true WHERE id = $1", [dLocal]);
    await db.query('UPDATE drivers SET driver_type = NULL WHERE id = $1', [dNone]);
    await db.query("UPDATE drivers SET driver_type = 'DESI', agreement_signed = false, email = 'u@example.com' WHERE id = $1", [dUnsigned]);
    await db.query('DELETE FROM quickbooks_vendors WHERE driver_id = ANY($1::int[])', [[dNew, dTwo, dLocal, dNone, dUnsigned]]);
    await db.query(`INSERT INTO quickbooks_connection (environment, realm_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, connected_by)
      VALUES ('sandbox', '12345678', 'x', 'x', now() + interval '1 hour', now() + interval '90 days', $1) ON CONFLICT (environment) DO UPDATE SET realm_id = '12345678'`, [sup.id]);

    const made = [];
    const fake = ({ existing = [], createError = null, answer = null } = {}) => ({
      findVendorsByEmail: async () => existing,
      createVendor: async (body, requestId) => { made.push({ body, requestId }); if (createError) throw createError; return answer ?? { Id: '501', Vendor1099: true }; },
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
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
  }
});
