import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createSandboxWorker, linkDriver, listCityWorkers, lookupDriver, refreshWorker, unlinkDriver,
} from '../services/payments/everee/workerStore.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything, the
// migration included, runs in one transaction that is always rolled back. The drivers, admins and city are made up inside it, and Everee
// is replaced by a fake: no call leaves this machine.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const PRODUCTION = { EVEREE_API_TOKEN: 'tsk_prod_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_ENVIRONMENT: 'production' };

// Everee's search is loose: it looks for the term in names, email, phone and IDs. The fake does the same, so a worker with the same
// NAME as a driver is returned too, and the code must still ignore it.
const makeEveree = (initial, extras = {}) => { // extras: a term -> worker IDs a loose search also returns (near misses)
  const workers = initial.map((w) => ({ externalWorkerId: null, ...w }));
  const state = { searches: [], created: [], details: {} };
  const client = {
    searchWorkers: async (term) => {
      state.searches.push(term);
      const t = term.toLowerCase();
      const items = workers.filter((w) => [w.firstName, w.lastName, w.email, w.phoneNumber, w.externalWorkerId, w.workerId].some((f) => String(f ?? '').toLowerCase().includes(t))
        || (extras[t] ?? []).includes(w.workerId));
      return { data: { items, totalItems: items.length, pageNumber: 0, pageSize: 10 }, requestId: 'req-search' };
    },
    getWorker: async (id) => ({ data: state.details[id] ?? { id, onboardingComplete: true, tinVerificationStatus: 'VERIFIED' }, requestId: 'req-get' }),
    createContractor: async (body) => {
      state.created.push(body);
      workers.push({ workerId: `E${workers.length + 100}`, externalWorkerId: body.externalWorkerId, firstName: body.firstName, lastName: body.lastName, email: body.email, phoneNumber: body.phoneNumber });
      return { data: { id: body.externalWorkerId, onboardingComplete: true, tinVerificationStatus: 'NEEDS_VERIFICATION' }, requestId: 'req-create' };
    },
  };
  return { client, state, workers };
};

test('everee workers: lookup by email or phone only, link only from one exact match, sandbox test workers', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT s');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await db.query('BEGIN');
    await db.query(migration('2026-11-04-issue-031-everee-workers.sql'));
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Workers City', 'TSTWRK', 'WEEKLY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Other City', 'TSTOTC', 'WEEKLY') RETURNING id")).id;
    const ids = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 7')).rows.map((r) => r.id);
    const [match, oneWord, noPhone, ambiguous, nameOnly, sharesPhone, elsewhere] = ids;
    const person = (id, name, email, phone, cityId = city) => db.query('UPDATE drivers SET name = $2, email = $3, phone_number = $4, city_id = $5, enabled = true WHERE id = $1', [id, name, email, phone, cityId]);
    await person(match, 'Alice Rider', 'alice.rider@example.com', '5551230001');
    await person(oneWord, 'Bobby', 'bobby@example.com', '5551230002');
    await person(noPhone, 'Carol Lane', 'carol@example.com', null);
    await person(ambiguous, 'Dan Moss', 'dan.moss@example.com', '5551230004');
    await person(nameOnly, 'Eve Stone', 'eve.stone@example.com', '5551230005');
    await person(sharesPhone, 'Frank Dole', 'frank.dole@example.com', '5551230001'); // the same phone as Alice
    await person(elsewhere, 'Gina Park', 'gina.park@example.com', '5551230007', otherCity);
    const admin = async (role) => {
      const tag = Math.random().toString(36).slice(2);
      return one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test Admin ${tag}`, `w${tag}@example.com`, role]);
    };
    const superAdmin = await admin('superadmin');
    const cityAdmin = await admin('admin');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, city]);

    const initial = [
      { workerId: 'W-ALICE', firstName: 'Alice', lastName: 'Rider', email: 'ALICE.RIDER@example.com', phoneNumber: '5551230001' },
      { workerId: 'W-DAN-1', firstName: 'Dan', lastName: 'Moss', email: 'dan.moss@example.com', phoneNumber: '5559990000' },
      { workerId: 'W-DAN-2', firstName: 'Danny', lastName: 'Moss', email: 'danny@example.com', phoneNumber: '5551230004' },
      { workerId: 'W-EVE-OTHER', firstName: 'Eve', lastName: 'Stone', email: 'someone@else.example.com', phoneNumber: '5550000000' }, // same NAME, other contact
    ];
    // Searching for Eve's email also brings back a worker with the same NAME but other contact details, as a loose search can.
    let everee = makeEveree(initial, { 'eve.stone@example.com': ['W-EVE-OTHER'] });
    const deps = (extra = {}) => ({ env: SANDBOX, client: everee.client, ...extra });
    const ask = (who, id) => lookupDriver(db, who, { cityId: city, driverId: id }, deps());
    // Only this test's own drivers: the table may already hold real sandbox links made by hand.
    const linkRows = async () => (await db.query('SELECT driver_id, environment, link_source FROM everee_workers WHERE driver_id = ANY($1::int[]) ORDER BY id', [ids])).rows;

    await t.test('the list shows the city\'s drivers, who is blocked and why, and what each would be sent as; only a super admin may see it', async () => {
      const result = await listCityWorkers(db, superAdmin, city, { env: SANDBOX });
      assert.equal(result.environment, 'sandbox');
      const by = (id) => result.drivers.find((d) => d.driverId === id);
      assert.equal(by(match).status, 'unlinked');
      assert.deepEqual(by(match).sendsAs, { firstName: 'Alice', lastName: 'Rider' });
      assert.deepEqual(by(oneWord).issues.map((i) => i.code), ['name_needs_first_and_last']);
      assert.equal(by(oneWord).status, 'blocked');
      assert.deepEqual(by(noPhone).issues.map((i) => i.code), ['no_valid_phone']);
      assert.ok(!result.drivers.some((d) => d.driverId === elsewhere), 'another city\'s driver is not listed');
      assert.equal(result.summary.drivers, 6);
      assert.ok(!JSON.stringify(result).includes('alice.rider@example.com') && !JSON.stringify(result).includes('5551230001'), 'no email or phone is returned');
      await assert.rejects(listCityWorkers(db, cityAdmin, city, { env: SANDBOX }), { status: 403 });
    });

    await t.test('a lookup uses only the driver\'s email and phone, never the name, and saves nothing', async () => {
      everee.state.searches.length = 0;
      const found = await ask(superAdmin, match);
      assert.equal(found.result, 'match');
      assert.equal(found.matches[0].workerId, 'W-ALICE');
      assert.deepEqual(found.matches[0].matchedOn, ['email', 'phone']);
      assert.deepEqual(everee.state.searches, ['alice.rider@example.com', '5551230001'], 'only the email and the phone were searched');
      assert.deepEqual(await linkRows(), []);
    });

    await t.test('a worker with the same name but other contact details is not a match', async () => {
      const result = await ask(superAdmin, nameOnly);
      assert.equal(result.result, 'no_match');
      assert.deepEqual(result.matches, []);
    });

    await t.test('two workers matching one driver is ambiguous; a blocked driver is not even looked up', async () => {
      const amb = await ask(superAdmin, ambiguous);
      assert.equal(amb.result, 'ambiguous');
      assert.deepEqual(amb.matches.map((m) => m.workerId).sort(), ['W-DAN-1', 'W-DAN-2']);
      everee.state.searches.length = 0;
      for (const id of [oneWord, noPhone]) {
        const blocked = await ask(superAdmin, id);
        assert.equal(blocked.result, 'blocked');
        assert.equal(blocked.reason, 'driver_data');
      }
      assert.deepEqual(everee.state.searches, [], 'no call to Everee for a driver with a data problem');
    });

    await t.test('a worker that matches on the phone but has another email is a conflict: shown, never linked', async () => {
      const result = await ask(superAdmin, sharesPhone); // Frank has Alice's phone but his own email
      assert.equal(result.result, 'conflict');
      assert.deepEqual([result.matches[0].workerId, result.matches[0].matchedOn, result.matches[0].conflicts], ['W-ALICE', ['phone'], ['email']]);
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: sharesPhone, workerId: 'W-ALICE' }, deps()), { status: 409, message: /needs to be confirmed/ });
      assert.deepEqual(await linkRows(), []);
      // A conflict is not "no worker": no test worker is created for it either.
      await assert.rejects(createSandboxWorker(db, superAdmin, { cityId: city, driverId: sharesPhone }, deps()), { status: 409, message: /may already exist/ });
      assert.deepEqual(everee.state.created, []);
      assert.deepEqual(await linkRows(), []);
    });

    await t.test('a link is saved only from one exact match with the worker\'s ID, by a super admin', async () => {
      await assert.rejects(linkDriver(db, cityAdmin, { cityId: city, driverId: match, workerId: 'W-ALICE' }, deps()), { status: 403 });
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: match, workerId: 'W-DAN-1' }, deps()), { status: 409, message: /not the worker found/ });
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: ambiguous, workerId: 'W-DAN-1' }, deps()), { status: 409, message: /more than one/ });
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: nameOnly, workerId: 'W-EVE-OTHER' }, deps()), { status: 409, message: /no existing Everee worker/ });
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: oneWord, workerId: 'W-ALICE' }, deps()), { status: 409 });
      assert.deepEqual(await linkRows(), [], 'nothing was saved by any of those');
      const { link } = await linkDriver(db, superAdmin, { cityId: city, driverId: match, workerId: 'W-ALICE' }, deps());
      assert.deepEqual([link.workerId, link.source, link.ready], ['W-ALICE', 'matched_email_and_phone', true]);
      assert.deepEqual(await linkRows(), [{ driver_id: match, environment: 'sandbox', link_source: 'matched_email_and_phone' }]);
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: match, workerId: 'W-ALICE' }, deps()), { status: 409, message: /already linked/ });
    });

    await t.test('a worker already linked to one driver is never offered to another, and another city is refused', async () => {
      const result = await ask(superAdmin, sharesPhone);
      assert.equal(result.result, 'blocked');
      assert.equal(result.reason, 'worker_linked_to_another_driver');
      await assert.rejects(linkDriver(db, superAdmin, { cityId: city, driverId: sharesPhone, workerId: 'W-ALICE' }, deps()), { status: 409 });
      await assert.rejects(lookupDriver(db, superAdmin, { cityId: city, driverId: elsewhere }, deps()), { status: 404 }); // not a driver of this city
    });

    await t.test('refresh reads what Everee says now; a worker who is not onboarded, failed the tax check or left is not ready', async () => {
      everee.state.details['W-ALICE'] = { id: 'W-ALICE', onboardingComplete: false, tinVerificationStatus: 'SENT_FOR_VERIFICATION' };
      let { link } = await refreshWorker(db, superAdmin, { cityId: city, driverId: match }, deps());
      assert.deepEqual([link.onboardingComplete, link.ready], [false, false]);
      everee.state.details['W-ALICE'] = { id: 'W-ALICE', onboardingComplete: true, tinVerificationStatus: 'VERIFICATION_FAILED' };
      ({ link } = await refreshWorker(db, superAdmin, { cityId: city, driverId: match }, deps()));
      assert.deepEqual([link.tinStatus, link.ready], ['VERIFICATION_FAILED', false]);
      everee.state.details['W-ALICE'] = { id: 'W-ALICE', onboardingComplete: true, tinVerificationStatus: 'VERIFIED', terminationDate: '2026-11-01' };
      ({ link } = await refreshWorker(db, superAdmin, { cityId: city, driverId: match }, deps()));
      assert.deepEqual([link.terminated, link.ready], [true, false]);
      delete everee.state.details['W-ALICE'];
      ({ link } = await refreshWorker(db, superAdmin, { cityId: city, driverId: match }, deps()));
      assert.equal(link.ready, true);
      await assert.rejects(refreshWorker(db, superAdmin, { cityId: city, driverId: nameOnly }, deps()), { status: 404 });
    });

    await t.test('a link can be undone with a reason, is kept as history, and the same driver can be linked again', async () => {
      await assert.rejects(unlinkDriver(db, superAdmin, { cityId: city, driverId: match, reason: ' ' }, deps()), { status: 400 });
      await assert.rejects(unlinkDriver(db, cityAdmin, { cityId: city, driverId: match, reason: 'Wrong person' }, deps()), { status: 403 });
      await unlinkDriver(db, superAdmin, { cityId: city, driverId: match, reason: 'Wrong person' }, deps());
      assert.equal((await listCityWorkers(db, superAdmin, city, { env: SANDBOX })).drivers.find((d) => d.driverId === match).status, 'unlinked');
      await assert.rejects(unlinkDriver(db, superAdmin, { cityId: city, driverId: match, reason: 'Again' }, deps()), { status: 404 });
      await linkDriver(db, superAdmin, { cityId: city, driverId: match, workerId: 'W-ALICE' }, deps());
      assert.equal((await db.query('SELECT count(*)::int n FROM everee_workers WHERE driver_id = $1', [match])).rows[0].n, 2, 'the undone link is still there as history');
    });

    await t.test('a link is per environment: the sandbox link is not a production link', async () => {
      const result = await listCityWorkers(db, superAdmin, city, { env: PRODUCTION });
      assert.equal(result.environment, 'production');
      assert.equal(result.drivers.find((d) => d.driverId === match).status, 'unlinked');
    });

    await t.test('the database refuses to delete a link or change who is linked to whom', async () => {
      await savepoint(() => assert.rejects(db.query('DELETE FROM everee_workers WHERE driver_id = $1', [match]), /cannot be deleted/));
      await savepoint(() => assert.rejects(db.query('UPDATE everee_workers SET driver_id = $1 WHERE driver_id = $2', [nameOnly, match]), /cannot be changed/));
      await savepoint(() => assert.rejects(db.query("UPDATE everee_workers SET everee_worker_id = 'X' WHERE driver_id = $1", [match]), /cannot be changed/));
      await savepoint(() => assert.rejects(db.query("UPDATE everee_workers SET unlinked_at = now(), unlinked_by = $1 WHERE unlinked_at IS NULL AND driver_id = $2", [superAdmin.id, match]), /unlink_reason|check constraint/));
      await savepoint(() => assert.rejects(db.query('UPDATE everee_workers SET unlinked_at = NULL, unlinked_by = NULL WHERE unlinked_at IS NOT NULL AND driver_id = $1', [match]), /stays unlinked/));
      // the one live link per driver and per worker
      await savepoint(() => assert.rejects(db.query(
        "INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', 'W-ALICE', 'matched_phone', $2)", [sharesPhone, superAdmin.id]), /uq_everee_workers_worker|duplicate key/));
    });

    await t.test('a sandbox test worker is made-up data, looked for before it is created, reused and never duplicated, and refused outside the sandbox', async () => {
      await assert.rejects(createSandboxWorker(db, superAdmin, { cityId: city, driverId: nameOnly }, deps({ env: PRODUCTION })), { status: 403 });
      await assert.rejects(createSandboxWorker(db, cityAdmin, { cityId: city, driverId: nameOnly }, deps()), { status: 403 });
      await assert.rejects(createSandboxWorker(db, superAdmin, { cityId: city, driverId: match }, deps()), { status: 409, message: /already linked/ });
      await assert.rejects(createSandboxWorker(db, superAdmin, { cityId: city, driverId: ambiguous }, deps()), { status: 409, message: /may already exist/ }, 'workers already match this driver');
      assert.deepEqual(everee.state.created, []);

      const made = await createSandboxWorker(db, superAdmin, { cityId: city, driverId: nameOnly }, deps());
      assert.equal(made.reused, false);
      assert.equal(made.link.source, 'created_sandbox');
      assert.equal(everee.state.created.length, 1);
      const body = JSON.stringify(everee.state.created[0]);
      for (const real of ['Eve', 'Stone', 'eve.stone@example.com', '5551230005']) assert.ok(!body.includes(real), `a real driver's detail (${real}) was not sent`);
      assert.match(everee.state.created[0].email, /@example\.com$/);
      assert.deepEqual(everee.state.created[0].legalWorkAddress, { useHomeAddress: true });
      assert.match(everee.state.created[0].w9FormResponse.socialSecurityNumber, /^1\d{8}$/, 'a made-up tax ID that does not start with 9');
      assert.notEqual(everee.state.created[0].w9FormResponse.socialSecurityNumber, `12345${String(match).padStart(4, '0').slice(-4)}`, 'and is different for each driver');
      assert.equal(everee.state.created[0].externalWorkerId, `nasa-sandbox-driver-${nameOnly}`);

      await unlinkDriver(db, superAdmin, { cityId: city, driverId: nameOnly, reason: 'Test redo' }, deps());
      const again = await createSandboxWorker(db, superAdmin, { cityId: city, driverId: nameOnly }, deps());
      assert.equal(again.reused, true, 'the worker made before is linked again');
      assert.equal(everee.state.created.length, 1, 'no second worker was created in Everee');
    });

    await t.test('Everee problems become clear answers with the request ID, and without settings nothing is done', async () => {
      const { EvereeError } = await import('../services/payments/everee/evereeClient.js');
      const broken = { ...everee.client, searchWorkers: async () => { throw new EvereeError('Everee refused the token', { status: 401, requestId: 'req-401' }); } };
      await assert.rejects(lookupDriver(db, superAdmin, { cityId: city, driverId: match }, { env: SANDBOX, client: broken }), { status: 502, message: /req-401/ });
      await assert.rejects(lookupDriver(db, superAdmin, { cityId: city, driverId: match }, { env: {}, client: everee.client }), { status: 409, message: /not set up/ });
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
