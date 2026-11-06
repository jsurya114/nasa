import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EvereeError } from '../services/payments/everee/evereeClient.js';
import { lookupDriver, linkDriver } from '../services/payments/everee/workerStore.js';
import { createSession, getStatus, OnboardingError, refreshStatus, startOnboarding, UNCERTAIN_COOLDOWN_MINUTES } from '../services/payments/everee/driverOnboarding.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_* variables. Everything, the migrations
// included, runs in one transaction that is always rolled back. The drivers are real rows of the copy that get made-up details inside it, and Everee
// is replaced by a fake: no call leaves this machine and no money moves.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const ENV = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321', EVEREE_DRIVER_ONBOARDING_ENABLED: 'true' };
const ADDRESS = { line1: '1 Test Street', city: 'Austin', state: 'TX', postalCode: '78701' };

const makeEveree = () => {
  const state = { workers: new Map(), posts: [], sessions: [], searches: [], failPost: null, getFails: null, completeAfterCreate: false };
  const client = {
    // As the real Worker API does: looked up by our external ID it answers with that same alias as `id`. The canonical worker ID is only in the search result.
    getWorker: async (id) => {
      if (state.getFails) throw state.getFails;
      const worker = state.workers.get(id);
      if (!worker) throw new EvereeError('Everee did not find what was asked for', { status: 404 });
      return { data: { ...worker, id: worker.externalWorkerId ?? worker.id } };
    },
    searchWorkers: async (term) => {
      state.searches.push(term);
      if (state.searchHidesOurs && String(term).startsWith('nasa-driver-')) return { data: { items: [], totalItems: 0 } };
      const items = [...state.workers.values()].filter((w) => [w.email, w.phoneNumber, w.externalWorkerId].includes(term)).map((w) => ({ workerId: w.id, externalWorkerId: w.externalWorkerId, email: w.email, phoneNumber: w.phoneNumber }));
      return { data: { items, totalItems: items.length } };
    },
    createEmbeddedContractor: async (body) => {
      state.posts.push(body);
      if (state.failPost) { const error = state.failPost; state.failPost = null; if (error.after) state.workers.set(body.externalWorkerId, { id: `CAN-${body.externalWorkerId}`, externalWorkerId: body.externalWorkerId, onboardingComplete: false }); throw error.error; }
      const worker = { id: `CAN-${body.externalWorkerId}`, externalWorkerId: body.externalWorkerId, email: body.email, phoneNumber: body.phoneNumber, onboardingComplete: state.completeAfterCreate };
      // the create answer is the alias too, as with the lookup; the canonical id is what a search shows
      state.workers.set(body.externalWorkerId, worker);
      return { data: { ...worker, id: body.externalWorkerId } };
    },
    createEmbeddedSession: async (body) => { state.sessions.push(body); return { data: state.sessionAnswer ?? { url: 'https://embed.everee.com/s/abc', origin: 'https://embed.everee.com', expiresInMs: 60000 } }; },
  };
  return { client, state };
};

test('driver onboarding: intent first, one worker, self only', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  let sp = 0;
  const fails = async (sql, params, pattern, why) => { const name = `f${sp++}`; await db.query(`SAVEPOINT ${name}`); try { await assert.rejects(db.query(sql, params), pattern, why); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); } };
  const savepoint = async (fn) => { await db.query('SAVEPOINT s'); try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); } };
  try {
    await db.query('BEGIN');
    await db.query(migration('2026-11-04-issue-031-everee-workers.sql'));
    await db.query(migration('2026-11-07-issue-242-everee-driver-onboarding.sql'));
    await db.query(migration('2026-11-07-issue-242-everee-driver-onboarding.sql')); // safe to run twice
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Onboarding City', 'TSTONB', 'WEEKLY') RETURNING id")).id;
    const [a, b, c] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 3')).rows.map((r) => r.id);
    const person = (id, over = {}) => db.query(
      `UPDATE drivers SET name = $2, email = $3, phone_number = $4, city_id = $5, enabled = true, driver_type = $6, agreement_signed = $7, agreement_joining_date = '2026-10-01' WHERE id = $1`,
      [id, over.name ?? `Alice Rider${id}`, over.email ?? `alice${id}@example.com`, over.phone ?? `55512300${String(id).padStart(2, '0').slice(-2)}`, city, over.type === undefined ? 'LOCAL' : over.type, over.signed ?? true]);
    const withEveree = () => { const fake = makeEveree(); return { ...fake, deps: { client: fake.client, env: ENV } }; };
    const start = (fake, id, input = { homeAddress: ADDRESS }) => startOnboarding(db, id, input, fake.deps);
    const refused = async (promise, status, code) => assert.rejects(promise, (e) => e instanceof OnboardingError && e.status === status && e.code === code, `expected ${status} ${code}`);

    await t.test('the migration: one actor per link, the tenant fills in once, nothing else about a link can change', async () => {
      await person(a);
      await savepoint(async () => {
        const admin = (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id;
        await db.query("INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', 'W1', 'matched_email', $2)", [a, admin]);
        await fails("INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, linked_by, linked_by_driver_id) VALUES ($1, 'sandbox', 'W2', 'matched_email', $2, $1)", [b, admin], /everee_workers_one_actor_check/, 'two actors');
        await fails("INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source) VALUES ($1, 'sandbox', 'W3', 'embedded_onboarding')", [b], /everee_workers_one_actor_check/, 'no actor');
        await db.query("UPDATE everee_workers SET tenant_id = '4321' WHERE driver_id = $1", [a]); // NULL -> value, once
        await fails("UPDATE everee_workers SET tenant_id = '9999' WHERE driver_id = $1", [a], /tenant of a link cannot be changed/);
        await fails('UPDATE everee_workers SET linked_by_driver_id = $2 WHERE driver_id = $1', [a, b], /cannot be changed/);
      });
    });

    await t.test('who may start: only a Local driver who signed, with the switch on, and the answer is refused before Everee is asked', async () => {
      const fake = withEveree();
      await person(a, { type: null });
      await refused(start(fake, a), 409, 'classification_required');
      await person(a, { type: 'DESI' });
      await refused(start(fake, a), 403, 'not_local');
      await person(a, { signed: false });
      await refused(start(fake, a), 409, 'agreement_required');
      await person(a);
      await refused(startOnboarding(db, a, { homeAddress: ADDRESS }, { client: fake.client, env: { ...ENV, EVEREE_DRIVER_ONBOARDING_ENABLED: 'false' } }), 409, 'onboarding_unavailable');
      await db.query('UPDATE drivers SET enabled = false WHERE id = $1', [a]);
      await refused(start(fake, a), 403, 'driver_disabled');
      assert.equal(fake.state.posts.length, 0);
      assert.equal(fake.state.searches.length, 0);
      assert.equal((await one('SELECT count(*)::int AS n FROM everee_onboarding WHERE driver_id = $1', [a])).n, 0, 'nothing was written');
    });

    await t.test('missing details are answered before anything is written or asked of Everee', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await assert.rejects(start(fake, a, {}), (e) => e.status === 422 && e.missing.includes('homeAddress.line1'));
        assert.equal(fake.state.posts.length + fake.state.searches.length, 0);
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_onboarding WHERE driver_id = $1', [a])).n, 0);
      });
    });

    await t.test('a new Local driver is created once, linked with the driver as the actor and the tenant recorded', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        const first = await start(fake, a);
        assert.equal(first.state, 'in-progress');
        assert.equal(fake.state.posts.length, 1);
        assert.deepEqual(Object.keys(fake.state.posts[0]).sort(), ['email', 'externalWorkerId', 'firstName', 'homeAddress', 'lastName', 'phoneNumber', 'startDate']);
        assert.equal(fake.state.posts[0].externalWorkerId, `nasa-driver-${a}`);
        const link = await one('SELECT * FROM everee_workers WHERE driver_id = $1', [a]);
        assert.deepEqual([link.linked_by, link.linked_by_driver_id, link.link_source, link.tenant_id, link.environment], [null, a, 'embedded_onboarding', '4321', 'sandbox']);
        assert.deepEqual([link.everee_worker_id, link.external_worker_id], [`CAN-nasa-driver-${a}`, `nasa-driver-${a}`], 'the canonical Everee worker ID is stored, not the external alias the create answer carries; the alias is kept separately');
        const again = await start(fake, a);
        assert.deepEqual([again.started, fake.state.posts.length], [false, 1], 'starting again creates nothing');
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1', [a])).n, 1);
      });
    });

    await t.test('while another request holds the lease nothing is created; a person must review a possible existing worker', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await db.query("INSERT INTO everee_onboarding (driver_id, environment, tenant_id, external_worker_id, state, request_id, lease_until) VALUES ($1, 'sandbox', '4321', $2, 'creating', gen_random_uuid(), now() + interval '30 seconds')", [a, `nasa-driver-${a}`]);
        const waiting = await start(fake, a);
        assert.deepEqual([waiting.state, waiting.started, fake.state.posts.length, fake.state.searches.length], ['creating', false, 0, 0]);
      });
      await savepoint(async () => {
        await person(b, { email: 'bob.rider@example.com' });
        const fake = withEveree();
        fake.state.workers.set('someone-elses-id', { id: 'EXISTING-1', externalWorkerId: 'old-qb-id', email: 'bob.rider@example.com', phoneNumber: '5559998888' });
        const review = await start(fake, b);
        assert.deepEqual([review.state, review.reason, fake.state.posts.length], ['needs-review', 'possible_existing_worker', 0]);
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1', [b])).n, 0, 'an existing worker is never linked by the driver');
        const stuck = await start(fake, b);
        assert.equal(stuck.state, 'needs-review');
      });
    });

    await t.test('a driver an admin unlinked cannot link themselves again by starting; a super admin does that on purpose', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await start(fake, a);
        const admin = (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id;
        await db.query("UPDATE everee_workers SET unlinked_by = $2, unlinked_at = now(), unlink_reason = 'wrong person' WHERE driver_id = $1", [a, admin]);
        const posts = fake.state.posts.length;
        let reads = 0;
        const counting = { ...fake.client, getWorker: async (id) => { reads += 1; return fake.client.getWorker(id); } };
        const again = await startOnboarding(db, a, { homeAddress: ADDRESS }, { client: counting, env: ENV });
        assert.deepEqual([again.state, again.reason, again.started], ['needs-review', 'previously_unlinked', false]);
        assert.deepEqual([fake.state.posts.length, reads], [posts, 0], 'Everee was not asked anything, even though the old worker still exists there');
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [a])).n, 0, 'no new link');
        assert.equal((await getStatus(db, a, { env: ENV })).state, 'needs-review');
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, fake.deps), 409, 'not_started');
        // the admin links again on purpose (the admin flow inserts a live row): the driver is then simply in progress or complete
        await db.query("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', '4321', 'RELINKED', 'matched_email', $2)", [a, admin]);
        assert.equal((await getStatus(db, a, { env: ENV })).state, 'in-progress');
      });
    });

    await t.test('a worker with the same NAME but other contacts does not stop onboarding (names are never matched)', async () => {
      await savepoint(async () => {
        await person(a, { name: 'Alice Namesake', email: 'alice.new@example.com' });
        const fake = withEveree();
        fake.state.workers.set('x', { id: 'NAMESAKE', externalWorkerId: 'ns', firstName: 'Alice', lastName: 'Namesake', email: 'someone.else@example.com', phoneNumber: '5550001111' });
        assert.equal((await start(fake, a)).state, 'in-progress');
        assert.equal(fake.state.posts.length, 1);
      });
    });

    await t.test('a lost answer: the worker is found by its stable ID, never created twice; with no worker it waits, then tries again', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        fake.state.failPost = { error: new EvereeError('Everee did not answer in time'), after: true }; // the worker WAS created
        const lost = await start(fake, a);
        assert.equal(lost.state, 'creating');
        assert.ok((await one('SELECT post_uncertain_at FROM everee_onboarding WHERE driver_id = $1', [a])).post_uncertain_at);
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1', [a])).n, 0);
        await db.query('UPDATE everee_onboarding SET lease_until = NULL WHERE driver_id = $1', [a]);
        const found = await start(fake, a);
        assert.deepEqual([found.state, fake.state.posts.length], ['in-progress', 1], 'found by its ID, no second create');
        assert.deepEqual((await one('SELECT everee_worker_id, external_worker_id FROM everee_workers WHERE driver_id = $1', [a])), { everee_worker_id: `CAN-nasa-driver-${a}`, external_worker_id: `nasa-driver-${a}` }, 'recovery stores the canonical ID too');
      });
      await savepoint(async () => {
        await person(b);
        const fake = withEveree();
        fake.state.failPost = { error: new EvereeError('Everee could not be reached'), after: false }; // the worker was NOT created
        await start(fake, b);
        await db.query('UPDATE everee_onboarding SET lease_until = NULL WHERE driver_id = $1', [b]);
        const waiting = await start(fake, b);
        assert.deepEqual([waiting.state, fake.state.posts.length], ['creating', 1], 'inside the cooldown nothing is posted again');
        await db.query(`UPDATE everee_onboarding SET post_uncertain_at = now() - make_interval(mins => $2) WHERE driver_id = $1`, [b, UNCERTAIN_COOLDOWN_MINUTES + 1]);
        const retried = await start(fake, b);
        assert.deepEqual([retried.state, fake.state.posts.length], ['in-progress', 2], 'after the cooldown, with no worker found, one more create');
      });
    });

    await t.test('when the canonical worker ID cannot be read yet, nothing is linked; the next press links it with the right ID', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        fake.state.searchHidesOurs = true;
        const first = await start(fake, a);
        assert.deepEqual([first.state, fake.state.posts.length], ['creating', 1]);
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1', [a])).n, 0, 'no link with an alias as the worker ID');
        fake.state.searchHidesOurs = false;
        const second = await start(fake, a);
        assert.deepEqual([second.state, fake.state.posts.length], ['in-progress', 1], 'found by its ID, not created again');
        assert.equal((await one('SELECT everee_worker_id FROM everee_workers WHERE driver_id = $1', [a])).everee_worker_id, `CAN-nasa-driver-${a}`);
      });
    });

    await t.test('admin recovery through the real admin writers: a driver sent to review is linked by a super admin and then works (tenant recorded)', async () => {
      await savepoint(async () => {
        await person(a, { email: 'review.me@example.com', phone: '5557770001' });
        const admin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Review Admin ${a}`, `review${a}@example.com`]);
        const fake = withEveree();
        fake.state.workers.set('qb-1', { id: 'EXISTING-7', externalWorkerId: 'qb-1', email: 'review.me@example.com', phoneNumber: '5557770001', onboardingComplete: false });
        assert.equal((await start(fake, a)).state, 'needs-review');
        const found = await lookupDriver(db, admin, { cityId: city, driverId: a }, { client: fake.client, env: ENV });
        assert.equal(found.result, 'match');
        await linkDriver(db, admin, { cityId: city, driverId: a, workerId: found.matches[0].workerId }, { client: fake.client, env: ENV });
        assert.equal((await one('SELECT tenant_id FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [a])).tenant_id, '4321', 'the verified link records its tenant');
        assert.equal((await getStatus(db, a, { env: ENV })).state, 'in-progress', 'no longer link_not_verified_for_tenant');
        const session = await createSession(db, a, { experience: 'ONBOARDING' }, fake.deps);
        assert.equal(session.experience, 'ONBOARDING');
        assert.equal(fake.state.sessions.at(-1).workerId, 'EXISTING-7');
      });
    });

    await t.test('a decision made while Everee was being asked is not overwritten: revocation, classification, takeover and a link made meanwhile', async () => {
      const meanwhile = (fake, action) => { // runs `action` after Everee created the worker but before the link is saved
        const original = fake.client.createEmbeddedContractor;
        fake.client.createEmbeddedContractor = async (body) => { const answer = await original(body); await action(); return answer; };
      };
      const liveLinks = async (id) => (await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [id])).n;
      const admin = async () => (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id;
      await savepoint(async () => { // an admin links and then revokes
        await person(a);
        const fake = withEveree();
        meanwhile(fake, async () => {
          const id = await admin();
          await db.query("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by, unlinked_by, unlinked_at, unlink_reason) VALUES ($1, 'sandbox', '4321', 'OTHER', 'matched_email', $2, $2, now(), 'revoked')", [a, id]);
        });
        const out = await start(fake, a);
        assert.deepEqual([out.state, out.reason, await liveLinks(a)], ['needs-review', 'previously_unlinked', 0], 'the admin’s decision stands');
      });
      await savepoint(async () => { // the driver is reclassified
        await person(a);
        const fake = withEveree();
        meanwhile(fake, async () => { await db.query("UPDATE drivers SET driver_type = 'DESI' WHERE id = $1", [a]); });
        await start(fake, a);
        assert.equal(await liveLinks(a), 0);
        assert.equal((await one('SELECT review_reason FROM everee_onboarding WHERE driver_id = $1', [a])).review_reason, 'no_longer_eligible');
        await db.query("UPDATE drivers SET driver_type = 'LOCAL' WHERE id = $1", [a]);
      });
      await savepoint(async () => { // the agreement is no longer signed, or the account is disabled
        await person(a);
        const fake = withEveree();
        meanwhile(fake, async () => { await db.query('UPDATE drivers SET enabled = false WHERE id = $1', [a]); });
        await start(fake, a);
        assert.equal(await liveLinks(a), 0);
      });
      await savepoint(async () => { // another attempt took over (its lease ran out): this one is fenced out
        await person(a);
        const fake = withEveree();
        meanwhile(fake, async () => { await db.query('UPDATE everee_onboarding SET attempts = attempts + 1 WHERE driver_id = $1', [a]); });
        const out = await start(fake, a);
        assert.equal(await liveLinks(a), 0, 'a superseded attempt writes no link');
        assert.equal(out.started, false);
      });
      await savepoint(async () => { // an admin linked the driver meanwhile: that link stays, nothing is added
        await person(a);
        const fake = withEveree();
        meanwhile(fake, async () => {
          const id = await admin();
          await db.query("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', '4321', 'ADMIN-LINK', 'matched_email', $2)", [a, id]);
        });
        await start(fake, a);
        const links = (await db.query('SELECT everee_worker_id, linked_by FROM everee_workers WHERE driver_id = $1', [a])).rows;
        assert.deepEqual(links.map((l) => l.everee_worker_id), ['ADMIN-LINK']);
      });
    });

    await t.test('Everee refusing the details creates nothing and lets the driver correct and retry; an outage is only unavailable', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        fake.state.failPost = { error: new EvereeError('Everee answered 400: bad address', { status: 400 }) };
        await assert.rejects(start(fake, a), (e) => e.status === 422 && e.code === 'everee_refused');
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_onboarding WHERE driver_id = $1', [a])).n, 0);
        assert.equal((await start(fake, a)).state, 'in-progress');
      });
      await savepoint(async () => {
        await person(b);
        const fake = withEveree();
        fake.state.getFails = new EvereeError('Everee could not be reached');
        await assert.rejects(start(fake, b), (e) => e.status === 503 && e.code === 'service_unavailable');
        assert.equal(fake.state.posts.length, 0);
        assert.equal((await one('SELECT lease_until FROM everee_onboarding WHERE driver_id = $1', [b])).lease_until, null, 'the lease is let go');
      });
    });

    await t.test('sessions: only the allowlisted screens, only for the signed-in driver’s own verified worker, in the right state', async () => {
      await savepoint(async () => {
        await person(a);
        await person(b);
        const fake = withEveree();
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, fake.deps), 409, 'not_started');
        await start(fake, a);
        await start(fake, b);
        await refused(createSession(db, a, { experience: 'WORKER_HOME' }, fake.deps), 400, 'experience_not_allowed');
        await refused(createSession(db, a, { experience: '__proto__' }, fake.deps), 400, 'experience_not_allowed');
        await refused(createSession(db, a, { experience: 'ONBOARDING', platform: 'desktop' }, fake.deps), 400, 'platform_not_allowed');
        await refused(createSession(db, a, { experience: 'ONBOARDING', platform: '__proto__' }, fake.deps), 400, 'platform_not_allowed');
        await refused(createSession(db, a, { experience: 'PAYMENT_HISTORY' }, fake.deps), 409, 'not_complete');
        const session = await createSession(db, a, { experience: 'ONBOARDING', workerId: `CAN-nasa-driver-${b}`, driverId: b }, fake.deps);
        assert.equal(fake.state.sessions.length, 1);
        assert.deepEqual(fake.state.sessions[0], { workerId: `CAN-nasa-driver-${a}`, experience: 'ONBOARDING', experienceVersion: 'V2_0', eventHandlerName: 'nasaEvereeEmbed' }, 'a worker or driver ID in the request is ignored');
        assert.deepEqual([session.url.startsWith('https://embed.everee.com/'), session.experience], [true, 'ONBOARDING']);
        const phone = await createSession(db, a, { experience: 'ONBOARDING', platform: 'native' }, fake.deps);
        assert.deepEqual([phone.eventHandlerName, fake.state.sessions.at(-1).eventHandlerName], ['ReactNativeWebView', 'ReactNativeWebView'], 'the phone app uses Everee’s documented React Native handler');
        await db.query("UPDATE everee_workers SET onboarding_complete = true WHERE driver_id = $1", [a]);
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, fake.deps), 409, 'already_complete');
        assert.equal((await createSession(db, a, { experience: 'PAYMENT_HISTORY' }, fake.deps)).experience, 'PAYMENT_HISTORY');
        assert.equal(fake.state.sessions.at(-1).experienceVersion, 'V1_0');
        const events = (await db.query("SELECT event, detail FROM everee_onboarding_events WHERE driver_id = $1 AND event = 'session_issued'", [a])).rows;
        assert.equal(events.length, 3);
        assert.ok(events.every((e) => !String(e.detail).includes('http')), 'a link is never stored');
      });
    });

    await t.test('former Local drivers retain only their own verified history; bank changes and onboarding remain Local-only', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await start(fake, a);
        await db.query("UPDATE everee_workers SET onboarding_complete = true WHERE driver_id = $1", [a]);
        await db.query("UPDATE drivers SET driver_type = 'DESI' WHERE id = $1", [a]);
        const status = await getStatus(db, a, fake.deps);
        assert.equal(status.state, 'not-required');
        assert.equal(status.canViewPaymentHistory, true);
        assert.equal(status.canManageBankDetails, false);
        await createSession(db, a, {experience: 'PAYMENT_HISTORY', workerId: 'someone_else'}, fake.deps);
        assert.equal(fake.state.sessions.at(-1).workerId, `CAN-nasa-driver-${a}`);
        await refused(createSession(db, a, {experience: 'PAYMENT_DEPOSIT'}, fake.deps), 403, 'not_local');
        await refused(createSession(db, a, {experience: 'ONBOARDING'}, fake.deps), 403, 'not_local');
        const otherTenant = {...fake.deps, env: {...ENV, EVEREE_TENANT_ID: '9999'}};
        assert.equal((await getStatus(db, a, otherTenant)).canViewPaymentHistory, false);
        await refused(createSession(db, a, {experience: 'PAYMENT_HISTORY'}, otherTenant), 409, 'link_not_verified_for_tenant');
        await db.query('UPDATE drivers SET enabled = false WHERE id = $1', [a]);
        assert.equal((await getStatus(db, a, fake.deps)).canViewPaymentHistory, false);
        await refused(createSession(db, a, {experience: 'PAYMENT_HISTORY'}, fake.deps), 403, 'driver_disabled');
      });
    });

    await t.test('sessions: another tenant’s or an unverified link is refused, an unsafe link from Everee is never passed on, and the rate is limited', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await start(fake, a);
        fake.state.sessionAnswer = { url: 'https://evil.example.com/s', expiresInMs: 1000 };
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, fake.deps), 502, 'bad_session');
        fake.state.sessionAnswer = { url: 'http://embed.everee.com/s', expiresInMs: 1000 };
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, fake.deps), 502, 'bad_session');
        fake.state.sessionAnswer = undefined;
        await db.query("INSERT INTO everee_onboarding_events (driver_id, event) SELECT $1, 'session_issued' FROM generate_series(1, 10)", [a]);
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, fake.deps), 429, 'too_many_sessions');
        await db.query("DELETE FROM everee_onboarding_events WHERE driver_id = $1", [a]);
        await refused(createSession(db, a, { experience: 'ONBOARDING' }, { ...fake.deps, env: { ...ENV, EVEREE_TENANT_ID: '8888' } }), 409, 'link_not_verified_for_tenant');
        assert.equal(fake.state.sessions.length, 2, 'only the two unsafe answers were asked for; the rate limit and the tenant mismatch never reached Everee');
      });
      await savepoint(async () => {
        await person(b);
        const fake = withEveree();
        const admin = (await one('SELECT id FROM admin ORDER BY id LIMIT 1')).id;
        await db.query("INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, linked_by) VALUES ($1, 'sandbox', 'LEGACY', 'created_sandbox', $2)", [b, admin]);
        await refused(createSession(db, b, { experience: 'ONBOARDING' }, fake.deps), 409, 'link_not_verified_for_tenant');
        assert.equal((await getStatus(db, b, { env: ENV })).state, 'needs-review');
      });
    });

    await t.test('refresh: Everee decides completion; a timeout never erases what was verified', async () => {
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await start(fake, a);
        assert.equal((await refreshStatus(db, a, fake.deps)).state, 'in-progress');
        fake.state.workers.get(`nasa-driver-${a}`).onboardingComplete = true;
        const done = await refreshStatus(db, a, fake.deps);
        assert.deepEqual([done.state, done.refreshed, done.required], ['complete', true, false]);
        assert.ok(done.verifiedAt);
        fake.state.getFails = new EvereeError('Everee did not answer in time');
        const timeout = await refreshStatus(db, a, fake.deps);
        assert.deepEqual([timeout.state, timeout.refreshed, timeout.stale], ['complete', false, true]);
      });
    });

    await t.test('one driver can never read or act on another’s state', async () => {
      await savepoint(async () => {
        await person(a);
        await person(b);
        const fake = withEveree();
        await start(fake, a);
        assert.equal((await getStatus(db, a, { env: ENV })).state, 'in-progress');
        assert.equal((await getStatus(db, b, { env: ENV })).state, 'not-started');
        assert.equal((await getStatus(db, b, { env: ENV })).enforced, false, 'the screens are told the hard gate is off');
        assert.equal((await getStatus(db, b, { env: { ...ENV, EVEREE_ONBOARDING_ENFORCED: 'true' } })).enforced, true);
        assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1', [b])).n, 0);
      });
    });

    await t.test('no payment batch, payable or payout is ever produced by onboarding', async () => {
      const before = await one('SELECT (SELECT count(*) FROM everee_payment_batches) AS b, (SELECT count(*) FROM everee_payment_items) AS i');
      await savepoint(async () => {
        await person(a);
        const fake = withEveree();
        await start(fake, a);
        await createSession(db, a, { experience: 'ONBOARDING' }, fake.deps);
        await refreshStatus(db, a, fake.deps);
      });
      assert.deepEqual(await one('SELECT (SELECT count(*) FROM everee_payment_batches) AS b, (SELECT count(*) FROM everee_payment_items) AS i'), before);
    });
    void c;
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
