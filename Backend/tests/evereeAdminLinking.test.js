import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { linkDriver, lookupDriver, unlinkDriver } from '../services/payments/everee/workerStore.js';
import { findSimilarDrivers } from '../services/admin/driverName.js';

// Moving an Everee link from an old, disabled driver record to the active record of the same person (the controls on Driver payment setup). Needs a
// PostgreSQL copy (never production): PAYROLL_TEST_DB=1 and the DB_* variables. Everything runs in one transaction that is rolled back; Everee is a fake.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const EVEREE = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };

test('an old disabled record holds the link: Look up names it, Unlink needs a reason, then the active record links the same worker', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-143-pay-runs.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-04-issue-031-everee-payments.sql', '2026-11-04-issue-031-everee-payment-status.sql', '2026-11-06-issue-232-driver-type.sql', '2026-11-07-issue-242-everee-driver-onboarding.sql', '2026-11-11-driver-contact-review.sql']) await db.query(migration(m));
    const tag = randomUUID().slice(0, 8);
    const cityId = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'WEEKLY') RETURNING id", [`Linking ${tag}`, `LK${tag.slice(0, 6)}`])).id;
    const sup = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Linking ${tag}`, `lk${tag}@example.com`]);
    const plain = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id, role", [`Linking plain ${tag}`, `lp${tag}@example.com`]);
    const [oldId, newId] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 2')).rows.map((r) => r.id);
    const setUp = (id, n, enabled) => db.query(
      "UPDATE drivers SET driver_type = 'LOCAL', agreement_signed = true, enabled = $6, city_id = $2, name = $3, email = $4, phone_number = $5, driver_code = $7, contact_changed_at = NULL WHERE id = $1",
      [id, cityId, `Same Person ${n} ${tag}`, `person-${tag}@example.com`.replace('person', n === 'old' ? 'old' : 'person'), '5551230001', enabled, n === 'old' ? 391331000 + (id % 1000) : 475406000 + (id % 1000)]);
    await setUp(oldId, 'old', false);
    await setUp(newId, 'new', true);
    // after the admin has reconciled the contact details with the driver, the active record has the worker's email and phone
    await db.query('UPDATE drivers SET email = $2 WHERE id = $1', [newId, `worker-${tag}@example.com`]);
    await db.query('UPDATE drivers SET email = $2 WHERE id = $1', [oldId, `worker-old-${tag}@example.com`]);
    const worker = { workerId: 'W-SAME', firstName: 'Same', lastName: 'Person', email: `worker-${tag}@example.com`, phoneNumber: '5551230001' };
    const everee = { searchWorkers: async () => ({ data: { items: [worker], totalItems: 1 } }), getWorker: async () => ({ data: { id: 'W-SAME', onboardingComplete: true, tinVerificationStatus: 'VERIFIED' } }) };
    await db.query(
      "INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by, onboarding_complete) VALUES ($1, 'sandbox', '4321', 'W-SAME', 'matched_email', $2, true)",
      [oldId, sup.id]);
    const deps = { env: EVEREE, client: everee };
    const where = { cityId, driverId: newId };

    // Look up on the active record: the worker is found, but the old disabled record holds it, and the admin is told which one
    const blocked = await lookupDriver(db, sup, where, deps);
    assert.deepEqual([blocked.result, blocked.reason], ['blocked', 'worker_linked_to_another_driver']);
    const [candidate] = blocked.matches;
    assert.deepEqual([candidate.firstName, candidate.lastName, candidate.maskedEmail, candidate.maskedPhone], ['Same', 'Person', 'w***@example.com', '***0001'], 'the candidate is shown masked');
    const oldLinkId = Number((await one('SELECT id FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [oldId])).id);
    assert.deepEqual(candidate.linkedDriver, { driverId: oldId, name: `Same Person old ${tag}`, driverCode: 391331000 + (oldId % 1000), enabled: false, cityId, outstandingPayments: false, linkId: oldLinkId }, 'the exact link reviewed is returned');
    await assert.rejects(linkDriver(db, sup, { ...where, workerId: 'W-SAME' }, deps), (e) => e.status === 409, 'it cannot be linked while the old record holds it');

    // Anything but ONE clean match stays read-only: the holder is shown, but no link is offered for removal (no linkId) and the result is not rewritten to "blocked"
    const viaWorkers = (items) => ({ ...everee, searchWorkers: async () => ({ data: { items, totalItems: items.length } }) });
    const filler = Array.from({ length: 9 }, (_, i) => ({ workerId: `W-FILL-${i}`, firstName: 'Fill', lastName: `${i}`, email: `fill${i}-${tag}@example.com`, phoneNumber: `555000000${i}` }));
    const readOnly = {
      conflict: [{ ...worker, email: `other-${tag}@example.com` }], // the phone matches, the email differs
      ambiguous: [worker, { ...worker, workerId: 'W-TWO', email: `two-${tag}@example.com` }], // two workers match
      truncated: [worker, ...filler], // Everee's search returned the most it gives, so the list may be incomplete
    };
    const expected = { conflict: 'conflict', ambiguous: 'ambiguous', truncated: 'ambiguous' };
    for (const [name, items] of Object.entries(readOnly)) {
      const result = await lookupDriver(db, sup, where, { env: EVEREE, client: viaWorkers(items) });
      assert.deepEqual([result.result, result.reason], [expected[name], null], `${name}: the result is not rewritten`);
      const held = result.matches.find((m) => m.workerId === 'W-SAME');
      assert.equal(held.linkedTo, 'another_driver', `${name}: the holder is still shown`);
      assert.ok(!('linkId' in held.linkedDriver), `${name}: no link is offered for removal`);
      await assert.rejects(linkDriver(db, sup, { ...where, workerId: 'W-SAME' }, { env: EVEREE, client: viaWorkers(items) }), (e) => e.status === 409, `${name}: cannot be linked`);
    }
    assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [oldId])).n, 1, 'the old record is still linked');

    // Unlink: super admin only, with a reason; unsettled payments need a confirmation
    await assert.rejects(unlinkDriver(db, plain, { cityId, driverId: oldId, linkId: oldLinkId, reason: 'moved' }, deps), (e) => e.status === 403);
    await assert.rejects(unlinkDriver(db, sup, { cityId, driverId: oldId, linkId: oldLinkId, reason: ' ' }, deps), (e) => e.status === 400);
    await assert.rejects(unlinkDriver(db, sup, { cityId, driverId: oldId, linkId: oldLinkId, reason: '' }, deps), (e) => e.status === 400);
    const withPending = { query: (sql, params) => (/AS outstanding/.test(sql) ? { rows: [{ outstanding: true }] } : db.query(sql, params)), connect: undefined };
    await assert.rejects(unlinkDriver(withPending, sup, { cityId, driverId: oldId, linkId: oldLinkId, reason: 'moved to the active record' }, deps), (e) => e.status === 409 && /not settled/.test(e.message));
    assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL', [oldId])).n, 1, 'still linked after the refusals');

    // a stale selection: someone replaced the old record's link after the lookup, so the link that was reviewed is no longer the active one and nothing is removed
    await db.query('SAVEPOINT stale');
    await db.query('UPDATE everee_workers SET unlinked_at = now(), unlinked_by = $2, unlink_reason = $3 WHERE id = $1', [oldLinkId, sup.id, 'replaced by another admin']);
    await db.query("INSERT INTO everee_workers (driver_id, environment, tenant_id, everee_worker_id, link_source, linked_by, onboarding_complete) VALUES ($1, 'sandbox', '4321', 'W-REPLACEMENT', 'matched_email', $2, true)", [oldId, sup.id]);
    await assert.rejects(unlinkDriver(db, sup, { cityId, driverId: oldId, linkId: oldLinkId, reason: 'moved to the active record' }, deps), (e) => e.status === 409 && /Look up again/.test(e.message));
    assert.equal((await one("SELECT everee_worker_id FROM everee_workers WHERE driver_id = $1 AND unlinked_at IS NULL", [oldId])).everee_worker_id, 'W-REPLACEMENT', 'the replacement link was not removed');
    await assert.rejects(unlinkDriver(db, sup, { cityId, driverId: oldId, reason: 'no link given' }, deps), (e) => e.status === 400);
    await db.query('ROLLBACK TO SAVEPOINT stale');

    assert.deepEqual(await unlinkDriver(db, sup, { cityId, driverId: oldId, linkId: oldLinkId, reason: 'moved to the active record 475406', acknowledgeOutstanding: false }, deps), { unlinked: true });
    const history = await one('SELECT unlink_reason, unlinked_by, unlinked_at FROM everee_workers WHERE driver_id = $1', [oldId]);
    assert.deepEqual([history.unlink_reason, history.unlinked_by, history.unlinked_at !== null], ['moved to the active record 475406', sup.id, true], 'the old link is kept as history with who, when and why');

    // Look up again: now the same worker is a clean match, and the link is made
    const again = await lookupDriver(db, sup, where, deps);
    assert.deepEqual([again.result, again.matches[0].linkedTo, again.matches[0].linkedDriver], ['match', null, null]);
    const linked = await linkDriver(db, sup, { ...where, workerId: 'W-SAME' }, deps);
    assert.equal(linked.link.workerId, 'W-SAME');
    assert.equal((await one('SELECT count(*)::int AS n FROM everee_workers WHERE driver_id = $1', [oldId])).n, 1, 'the old record keeps its history row');

    // A near-duplicate name (only punctuation differs) is found, an unrelated name is not
    const similar = await findSimilarDrivers(db, `Same Person new ${tag}..`);
    assert.deepEqual(similar.map((d) => d.id), [newId]);
    assert.deepEqual(await findSimilarDrivers(db, `Somebody Else ${tag}`), []);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await pool.end();
    (await import('../config/redis.js')).default.quit().catch(() => {});
  }
});
