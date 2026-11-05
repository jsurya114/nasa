import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { previewEvereeBatch } from '../services/payments/everee/batchPreview.js';
import { finalizeRun, generateRun } from '../services/payroll/payRuns/payRunStore.js';

// Needs a PostgreSQL copy with the app's tables (never production): PAYROLL_TEST_DB=1 and the DB_* variables. One transaction, always
// rolled back. Everything is made up. The preview calls nothing at Everee, so there is no fake Everee here either.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');
const SANDBOX = { EVEREE_API_TOKEN: 'tsk_test_ABCDEF123456', EVEREE_TENANT_ID: '4321' };
const ARMED = { ...SANDBOX, EVEREE_PAYMENTS_ENABLED: 'true' };
const codes = (list) => list.map((b) => b.code);

test('everee batch preview: who can be paid and why not, one hash for what would be paid, read-only', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql',
      '2026-11-03-issue-166-ledger-settlements.sql', '2026-11-04-approved-run-payment-records.sql', '2026-11-04-issue-031-everee-workers.sql', '2026-11-04-issue-031-everee-payments.sql']) await db.query(migration(m));

    const mkCity = async (tag) => {
      const job = `Test Preview ${tag}`;
      const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [job, `TP${tag}`])).id;
      const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3) RETURNING id`, [`TP ${tag}`, job, `TP-${tag}`])).id;
      return { city, route };
    };
    const draftCity = await mkCity('D');
    const mainCity = await mkCity('M');
    const ids = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 9')).rows.map((r) => r.id);
    const [dA, dB, dC, dD, dF, dG, dH, dN1, dN2] = ids;
    const tag = randomUUID();
    const admin = async (role, n) => one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${n} ${tag}`, `${n}${tag}@example.com`, role]);
    const sup1 = await admin('superadmin', 'one');
    const sup2 = await admin('superadmin', 'two');
    const cityAdmin = await admin('admin', 'city');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, mainCity.city]);

    let seq = 9800;
    const earn = async (c, driver, date, gross, insurance) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, c.route, seq, seq + 9, date])).id;
      seq += 10;
      await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1', [dd, gross, insurance]);
    };
    const setPerson = (id, name, phone) => db.query('UPDATE drivers SET name = $2, phone_number = $3 WHERE id = $1', [id, name, phone]);
    await setPerson(dD, `Solo${Math.floor(Math.random() * 1e9)}`, '5551230004'); // a one-word name: cannot be linked until fixed
    await setPerson(dC, `Cora Link ${Math.floor(Math.random() * 1e9)}`, '5551230003');
    const link = (driver, workerId, { onboarding = true, tin = 'VERIFIED', terminated = false, environment = 'sandbox' } = {}) => db.query(
      `INSERT INTO everee_workers (driver_id, environment, everee_worker_id, link_source, onboarding_complete, tin_status, terminated, linked_by)
       VALUES ($1, $2, $3, 'created_sandbox', $4, $5, $6, $7)`, [driver, environment, workerId, onboarding, tin, terminated, sup1.id]);

    // A draft run: one good driver, one whose insurance is more than the pay.
    await earn(draftCity, dN1, '2026-11-02', '100.00', '0.00');
    await earn(draftCity, dN2, '2026-11-02', '1.00', '1.92');
    const draft = (await generateRun(db, sup1, { requestId: randomUUID(), cityId: draftCity.city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' })).run;

    // A finalized run with a driver in every state.
    await earn(mainCity, dA, '2026-11-02', '100.00', '0.00'); // linked and ready
    await earn(mainCity, dH, '2026-11-02', '25.50', '0.00'); // linked and ready
    await earn(mainCity, dB, '2026-11-02', '50.00', '0.00'); // linked, onboarding not finished
    await earn(mainCity, dC, '2026-11-02', '40.00', '0.00'); // not linked, data fine
    await earn(mainCity, dD, '2026-11-02', '30.00', '0.00'); // not linked, one-word name
    await earn(mainCity, dF, '2026-11-02', '1.92', '1.92'); // net exactly zero
    await earn(mainCity, dG, '2026-11-02', '60.00', '0.00'); // linked and ready, but a payment is already submitted
    await link(dA, 'W-A');
    await link(dH, 'W-H');
    await link(dB, 'W-B', { onboarding: false, tin: 'NEEDS_VERIFICATION' });
    await link(dG, 'W-G');
    const main = (await generateRun(db, sup1, { requestId: randomUUID(), cityId: mainCity.city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' })).run;
    await finalizeRun(db, sup1, main.id);
    await db.query("UPDATE pay_statements SET payout_status = 'submitted' WHERE pay_run_id = $1 AND driver_id = $2", [main.id, dG]);

    const preview = (admin, runId, env = SANDBOX) => previewEvereeBatch(db, admin, runId, { env });
    const by = (result, driver) => result.drivers.find((d) => d.driverId === driver);
    const snapshot = async () => (await db.query(`SELECT (SELECT count(*) FROM pay_statements) s, (SELECT count(*) FROM pay_runs) r, (SELECT count(*) FROM everee_workers) w,
      (SELECT string_agg(payout_status, ',' ORDER BY id) FROM pay_statements) p`)).rows[0];

    await t.test('only a super admin may preview, an unknown run is 404, and the preview is for one run by ID', async () => {
      await assert.rejects(preview(cityAdmin, main.id), { status: 403 });
      await assert.rejects(preview(sup1, 987654321), { status: 404 });
    });

    await t.test('a run that is not finalized cannot be paid: it says why for the whole batch and for each driver', async () => {
      const r = await preview(sup1, draft.id, ARMED);
      assert.equal(r.canSubmit, false);
      assert.ok(codes(r.batchBlockers).includes('run_not_finalized'));
      assert.equal(r.summary.eligible, 0);
      assert.ok(codes(by(r, dN1).blockers).includes('run_not_finalized'));
      assert.ok(codes(by(r, dN2).blockers).includes('negative_net'), 'insurance more than the pay is below zero');
    });

    await t.test('each driver of the finalized run is eligible, or blocked with the reason', async () => {
      const r = await preview(sup2, main.id, ARMED);
      assert.deepEqual([r.run.status, r.environment, r.readOnly], ['finalized', 'sandbox', true]);
      assert.deepEqual(r.drivers.map((d) => d.driverId).sort((a, b) => a - b), [dA, dB, dC, dD, dF, dG, dH].sort((a, b) => a - b), 'the run\'s own statements, nobody else');
      assert.deepEqual([by(r, dA).eligible, by(r, dA).amount, by(r, dA).worker.ready], [true, '100.00', true]);
      assert.equal(by(r, dH).eligible, true);

      const b = by(r, dB);
      assert.deepEqual([b.eligible, codes(b.blockers)], [false, ['worker_not_ready']]);
      assert.deepEqual(b.blockers[0].problems.map((p) => p.code), ['onboarding_incomplete']);

      const c = by(r, dC);
      assert.deepEqual([c.eligible, codes(c.blockers), c.blockers[0].hint], [false, ['no_everee_worker'], 'link_worker']);
      const d = by(r, dD);
      assert.deepEqual([codes(d.blockers), d.blockers[0].hint, d.worker.driverDataIssues], [['no_everee_worker'], 'fix_driver_data', ['name_needs_first_and_last']]);

      assert.deepEqual(codes(by(r, dF).blockers), ['nothing_to_pay', 'no_everee_worker']);
      assert.ok(codes(by(r, dG).blockers).includes('payout_in_progress'), 'a payment already submitted is never paid again');
      assert.equal(by(r, dG).eligible, false);
    });

    await t.test('the total is the sum of the eligible frozen nets only, to the cent', async () => {
      const r = await preview(sup2, main.id, ARMED);
      assert.deepEqual([r.summary.drivers, r.summary.eligible, r.summary.blocked, r.summary.total], [7, 2, 5, '125.50']);
      assert.ok(!JSON.stringify(r).includes('@example.com') && !JSON.stringify(r).includes('5551230003'), 'no email or phone is returned');
    });

    await t.test('payments can be sent only when the switch is on; the preview is available either way', async () => {
      const off = await preview(sup2, main.id, SANDBOX);
      assert.equal(off.canSubmit, false);
      assert.ok(codes(off.batchBlockers).includes('payments_off'));
      assert.equal(off.summary.eligible, 2, 'the same people and amounts');
      const on = await preview(sup2, main.id, ARMED);
      assert.deepEqual([on.canSubmit, on.batchBlockers], [true, []]);
      const none = await preview(sup2, main.id, {});
      assert.equal(none.environment, null);
      assert.equal(none.previewHash, null);
      assert.equal(none.canSubmit, false);
    });

    await t.test('the super admin who finalized the run may preview it too; the preview carries no confirmer rule', async () => {
      const own = await preview(sup1, main.id, ARMED);
      assert.equal('confirm' in own, false);
      assert.equal(own.canSubmit, true);
      assert.equal(own.previewHash, (await preview(sup2, main.id, ARMED)).previewHash, 'the same for whoever looks');
      await assert.rejects(preview(cityAdmin, main.id, ARMED), { status: 403 });
    });

    await t.test('the hash is the same until what would be paid changes: a driver, an amount or an Everee worker', async () => {
      const first = (await preview(sup2, main.id, ARMED)).previewHash;
      assert.match(first, /^[0-9a-f]{64}$/);
      assert.equal((await preview(sup1, main.id, ARMED)).previewHash, first, 'the same for whoever looks');
      assert.equal((await preview(sup2, main.id, SANDBOX)).previewHash, first, 'the switch is not part of what is paid');

      await db.query("UPDATE everee_workers SET onboarding_complete = true, tin_status = 'VERIFIED' WHERE driver_id = $1", [dB]);
      const withB = await preview(sup2, main.id, ARMED);
      assert.equal(by(withB, dB).eligible, true);
      assert.equal(withB.summary.total, '175.50');
      assert.notEqual(withB.previewHash, first, 'a driver became payable');

      await db.query("UPDATE everee_workers SET unlinked_by = $2, unlinked_at = now(), unlink_reason = 'Test' WHERE driver_id = $1", [dA, sup1.id]);
      await link(dA, 'W-A-NEW');
      const swapped = await preview(sup2, main.id, ARMED);
      assert.equal(by(swapped, dA).eligible, true);
      assert.notEqual(swapped.previewHash, withB.previewHash, 'another Everee worker for the same driver');
    });

    await t.test('a sandbox link is not a production link, and a worker who left cannot be paid', async () => {
      const production = await preview(sup2, main.id, { ...ARMED, EVEREE_ENVIRONMENT: 'production', EVEREE_API_TOKEN: 'tsk_prod_ABCDEF123456' });
      assert.equal(production.environment, 'production');
      assert.equal(production.summary.eligible, 0, 'nobody is linked in production');
      await db.query('UPDATE everee_workers SET terminated = true WHERE driver_id = $1 AND unlinked_at IS NULL', [dH]);
      const left = by(await preview(sup2, main.id, ARMED), dH);
      assert.deepEqual([left.eligible, left.blockers[0].problems.map((p) => p.code)], [false, ['separated']]);
    });

    await t.test('previewing changes nothing and calls nothing', async () => {
      const before = await snapshot();
      await preview(sup2, main.id, ARMED);
      await preview(sup1, draft.id, ARMED);
      assert.deepEqual(await snapshot(), before);
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
