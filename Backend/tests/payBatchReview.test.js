import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blockersFor, reviewRunAsBatch } from '../services/payroll/payRuns/payBatchReview.js';
import { finalizeRun, generateRun, setRecoveryLimit } from '../services/payroll/payRuns/payRunStore.js';

const codes = (list) => list.map((b) => b.code);
const base = { net: '10.00', payout_status: 'not_submitted', flags: [] };

test('blockers: only a finalized run with a non-negative, unpaid statement is eligible', () => {
  assert.deepEqual(blockersFor({ statement: base, runStatus: 'finalized' }), []);
  assert.deepEqual(codes(blockersFor({ statement: base, runStatus: 'draft' })), ['run_not_finalized']);
  assert.deepEqual(codes(blockersFor({ statement: { ...base, net: '-0.01' }, runStatus: 'finalized' })), ['negative_net']);
  assert.deepEqual(codes(blockersFor({ statement: { ...base, net: '0.00' }, runStatus: 'finalized' })), []);
});

test('blockers: paid, submitted and unconfirmed block; failed is disclosed so it is checked before a retry', () => {
  const of = (payout_status) => blockersFor({ statement: { ...base, payout_status }, runStatus: 'finalized' });
  assert.deepEqual(codes(of('paid')), ['already_paid']);
  assert.deepEqual(codes(of('submitted')), ['payout_in_progress']);
  assert.deepEqual(codes(of('unconfirmed')), ['payout_in_progress']);
  assert.deepEqual(of('failed').map((b) => [b.code, b.severity]), [['previous_payout_failed', 'disclose']]);
});

test('blockers: statement flags are disclosed and never block', () => {
  const found = blockersFor({
    statement: { ...base, flags: [{ code: 'needs_review', entryId: 7, message: 'no repayment arrangement recorded; not recovered' }] },
    runStatus: 'finalized',
  });
  assert.deepEqual(found.map((b) => [b.code, b.severity]), [['needs_review', 'disclose']]);
});

// Needs a PostgreSQL copy with the app's tables (never production): PAYROLL_TEST_DB=1 and the DB_* variables.
// One transaction, always rolled back. All data is made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('the batch review reads a run read-only, by city, and tells who can be paid', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async () => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql']) await db.query(migration(m));
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Batch City', 'TSTBT', 'DAILY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Other Batch City', 'TSTBO', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TB 1', 'Test Batch City', 2, 1.6, 0.5, 0.25, 'TB-1') RETURNING id`)).id;
    const [d1, d2] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 2')).rows.map((r) => r.id);
    const tag = randomUUID();
    const superAdmin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`]);
    const cityAdmin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'admin') RETURNING id, role", [`Test c ${tag}`, `c${tag}@example.com`]);
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [cityAdmin.id, otherCity]);
    await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');

    let seq = 9700;
    const payRow = async (driver, date, gross, insurance) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, date])).id;
      seq += 10;
      await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1', [dd, gross, insurance]);
    };
    await payRow(d1, '2026-11-02', '100.00', '1.92');
    await payRow(d2, '2026-11-02', '1.00', '1.92'); // insurance is more than the pay: a negative statement
    const { run } = await generateRun(db, superAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' });
    const snapshot = async () => (await db.query(`SELECT (SELECT count(*) FROM pay_statements) s, (SELECT count(*) FROM pay_statement_lines) l, (SELECT count(*) FROM pay_runs) r, (SELECT string_agg(payout_status, ',') FROM pay_statements) p`)).rows[0];

    // Claims with no decision have no driver (#141). Three of this city, one of the other city, one superseded.
    const { importClaims } = await import('../services/payroll/claims/claimsStore.js');
    const { parseClaimsRows } = await import('../services/payroll/claims/claimsParser.js');
    const head = ['date', 'Waybill No.', 'Claim Type', 'Declared value (USD)', 'Confirm date.', 'The total expenses-exclusive of taxes'];
    const claimsOf = (rows) => parseClaimsRows([head, ...rows], { courier: 'gofo' }).claims;
    const src = (importCityId) => ({ importCityId, sourceFile: 'synthetic.xlsx', sourceSheet: 'Claims Detail', importedBy: null });
    await importClaims(db, claimsOf([
      ['10/07/2026 10:00:00', 'PBR001', 'Damaged Item', 10, null, -5],
      ['10/07/2026 10:00:00', 'PBR002', 'Damaged Item', 10, null, -6],
      ['10/07/2026 10:00:00', 'PBR003', 'Damaged Item', 10, null, -7],
    ]), src(city));
    await importClaims(db, claimsOf([['10/07/2026 10:00:00', 'PBR004', 'Damaged Item', 10, null, -8]]), src(otherCity));
    await db.query(`UPDATE courier_claim_matches SET status = 'ambiguous' WHERE claim_id = (SELECT id FROM courier_claims WHERE waybill = 'PBR002')`);
    await db.query(`UPDATE courier_claim_matches SET status = 'review' WHERE claim_id = (SELECT id FROM courier_claims WHERE waybill = 'PBR003')`);

    const before = await snapshot();
    const draft = await reviewRunAsBatch(db, superAdmin, run.id);
    assert.equal(draft.readOnly, true);
    assert.equal(draft.summary.eligible, 0, 'nothing in a draft can be paid');
    assert.ok(draft.drivers.every((d) => d.blockers.some((b) => b.code === 'run_not_finalized')));

    // The negative statement stops the run being finalized (#143), so finalize after removing it from the picture is not
    // possible here; check the negative driver on the draft, then a clean run for the eligible case.
    const negative = draft.drivers.find((d) => d.driverId === d2);
    assert.ok(negative.blockers.some((b) => b.code === 'negative_net'));
    assert.equal(draft.drivers.length, 2);
    assert.deepEqual(draft.summary.pendingClaims, { unresolved: 1, ambiguous: 1, review: 1, total: 3 }, 'this city\'s open claims, not the other city\'s');
    assert.ok(draft.drivers.every((d) => d.blockers.every((b) => b.code !== 'claims_waiting')), 'a claim is never attributed to a driver');
    assert.deepEqual(await snapshot(), before, 'reading the review changes nothing');

    await assert.rejects(reviewRunAsBatch(db, cityAdmin, run.id), (e) => e.status === 403, 'a city admin of another city is refused');
    await assert.rejects(reviewRunAsBatch(db, superAdmin, 999999999), (e) => e.status === 404);

    // A finalized run: remove the negative driver's rows first by using a second, clean run on a later day.
    await payRow(d1, '2026-11-09', '50.00', '0.00');
    const { run: clean } = await generateRun(db, superAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-09', periodEnd: '2026-11-09', dataType: 'daily' });
    await finalizeRun(db, superAdmin, clean.id);
    const review = await reviewRunAsBatch(db, superAdmin, clean.id);
    assert.deepEqual([review.summary.drivers, review.summary.eligible, review.summary.blocked], [1, 1, 0]);
    assert.equal(review.summary.eligibleTotals.net, '50.00');
    assert.equal(review.summary.pendingClaims.total, 3, 'a finalized run discloses them too');
    const otherReview = await (async () => {
      const { run: o } = await generateRun(db, superAdmin, { requestId: randomUUID(), cityId: otherCity, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' });
      return reviewRunAsBatch(db, superAdmin, o.id);
    })();
    assert.deepEqual(otherReview.summary.pendingClaims, { unresolved: 1, ambiguous: 0, review: 0, total: 1 });

    await db.query("UPDATE pay_statements SET payout_status = 'submitted' WHERE pay_run_id = $1", [clean.id]);
    const submitted = await reviewRunAsBatch(db, superAdmin, clean.id);
    assert.deepEqual([submitted.summary.eligible, submitted.summary.blocked], [0, 1]);
    assert.equal(submitted.summary.eligibleTotals.net, '0.00');
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
