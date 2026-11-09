import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry, voidEntry } from '../services/payroll/ledger/ledgerStore.js';
import { lockCityPayroll } from '../services/payroll/claims/claimsStore.js';
import { parseNewEntry } from '../services/payroll/ledger/ledgerRules.js';
import { discardRun, finalizeRun, generateRun, getRun, setRecoveryLimit, voidRun } from '../services/payroll/payRuns/payRunStore.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the three migrations included, runs in one transaction that is always rolled back.
// City, route, admins, journeys, pay rows, claims and ledger entries are all made up inside it.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('pay runs: today\'s totals, exactly-once rows and deductions, frozen history', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const savepoint = async (fn) => {
    await db.query('SAVEPOINT s');
    try { return await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
  };
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql', '2026-11-03-issue-166-ledger-settlements.sql']) await db.query(migration(m));

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Pay City', 'TSTPAY', 'DAILY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Pay Other', 'TSTPO', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TP 1', 'Test Pay City', 2, 1.6, 0.5, 0.25, 'TP-1') RETURNING id`)).id;
    const [d1, d2] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 2')).rows.map((r) => r.id);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = ANY($2::int[])', [city, [d1, d2]]);
    const admin = async (role) => {
      const tag = randomUUID();
      return one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`, role]);
    };
    const superAdmin = await admin('superadmin');
    const cityAdmin = await admin('admin');
    const otherAdmin = await admin('admin');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2), ($3, $4)', [cityAdmin.id, city, otherAdmin.id, otherCity]);

    // Closed pay rows, as the upload and calculation would leave them: d1 three days, d2 one day.
    let seq = 7000;
    const payRow = async (driver, date, gross, insurance) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, 0, 0, date])).id;
      seq += 10;
      return (await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross, insurance])).id;
    };
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) await payRow(d1, date, '100.00', '1.92');
    await payRow(d2, '2026-11-03', '80.50', '0');
    const outside = await payRow(d1, '2026-11-09', '999.00', '0'); // after the period

    // A matched claim (40) for d1, an advance of 200 as 50 x 4, one without a plan, and a reimbursement.
    const claimId = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
      VALUES ('gofo', repeat('c', 64), 1, 'TESTP001', 'Damaged Item', 'damaged item', '2026-10-30 10:00', -40, 40, $1, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [city])).id;
    await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, 40, 'test', 'test')`, [claimId, d1, city]);
    const ledger = async (o) => (await createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d1, cityId: city, reason: 'Test entry', effectiveDate: '2026-11-01', ...o }).entry)).entry;
    const advance = await ledger({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50' });
    const unplanned = await ledger({ type: 'expense', amount: '30' });
    const reimbursement = await ledger({ type: 'reimbursement', amount: '12.25' });
    const period = { cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'weekly' };
    const statementOf = (detail, driver) => detail.statements.find((s) => s.driver_id === driver);

    let firstRun;
    await t.test('no recovery limit set: statements equal today\'s net, nothing is deducted, the reimbursement is paid', async () => {
      const { run } = await generateRun(db, cityAdmin, { requestId: randomUUID(), ...period });
      firstRun = run;
      const detail = await getRun(db, cityAdmin, run.id);
      const s1 = statementOf(detail, d1);
      // today: 3 x (100.00 - 1.92) = 294.24 for d1; 80.50 for d2
      assert.deepEqual([s1.gross, s1.insurance, s1.claim_deductions, s1.recoveries, s1.reimbursements, s1.net], ['300.00', '5.76', '0.00', '0.00', '12.25', '306.49']);
      assert.equal(statementOf(detail, d2).net, '80.50');
      assert.equal(s1.carried_forward, '270.00', 'claim 40 + advance 200 + expense 30, nothing erased');
      assert.ok(s1.flags.some((f) => f.code === 'recovery_limit_not_set'));
      assert.ok(s1.flags.some((f) => f.code === 'needs_review' && String(f.entryId) === String(unplanned.id)));
      assert.equal(s1.lines.some((l) => l.payment_dashboard_id === outside), false, 'a row after the period is left out');
      assert.equal(detail.totals.net, '386.99');
      assert.equal(detail.waiting.entries_needing_review, 1);
    });

    await t.test('the same request again returns the same run; another run cannot take rows a draft holds', async () => {
      const again = await generateRun(db, cityAdmin, { requestId: firstRun.request_id, ...period });
      assert.deepEqual([again.replay, again.run.id], [true, firstRun.id]);
      const second = await generateRun(db, cityAdmin, { requestId: randomUUID(), ...period });
      assert.equal((await getRun(db, cityAdmin, second.run.id)).statements.length, 0);
      await discardRun(db, cityAdmin, second.run.id, 'Empty test run');
    });

    await t.test('a wrong-city or no-city admin cannot make or read a run; only a super admin sets the limit', async () => {
      await assert.rejects(generateRun(db, otherAdmin, { requestId: randomUUID(), ...period }), { status: 403 });
      await assert.rejects(getRun(db, otherAdmin, firstRun.id), { status: 403 });
      await assert.rejects(setRecoveryLimit(db, cityAdmin, { type: 'percent_of_available', value: 100 }, 'Test'), { status: 403 });
      await assert.rejects(setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 150 }, 'Test'), { status: 400 });
      await assert.rejects(setRecoveryLimit(db, superAdmin, { type: 'fixed_amount', value: 50 }, ''), { status: 400 });
    });

    let run;
    await t.test('with a limit: the claim and one instalment are deducted once, the unplanned debit waits', async () => {
      await discardRun(db, cityAdmin, firstRun.id, 'Re-run after setting the limit');
      await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
      run = (await generateRun(db, cityAdmin, { requestId: randomUUID(), ...period })).run;
      const s1 = statementOf(await getRun(db, cityAdmin, run.id), d1);
      // 300 - 5.76 + 12.25 = 306.49 available; claim 40 + instalment 50 = 90; net 216.49; carried 150 + 30
      assert.deepEqual([s1.claim_deductions, s1.recoveries, s1.net, s1.carried_forward], ['40.00', '50.00', '216.49', '180.00']);
      const history = await one("SELECT count(*)::int AS n FROM payroll_settings_history WHERE changed_by = $1", [superAdmin.id]);
      assert.equal(history.n, 1, 'the setting change is recorded');
    });

    await t.test('finalizing freezes the run; it can be repeated safely but not discarded', async () => {
      const done = await finalizeRun(db, cityAdmin, run.id);
      assert.equal(done.run.status, 'finalized');
      assert.equal((await finalizeRun(db, cityAdmin, run.id)).replay, true);
      await assert.rejects(discardRun(db, cityAdmin, run.id, 'Too late'), { status: 409 });
      await assert.rejects(voidEntry(db, cityAdmin, { entryId: advance.id, requestId: randomUUID(), reason: 'Undo' }), { status: 409, message: /already on a pay run/ });
      await assert.rejects(voidEntry(db, cityAdmin, { entryId: reimbursement.id, requestId: randomUUID(), reason: 'Undo' }), { status: 409 });
    });

    await t.test('the next run takes the next instalment and never the same claim, row or reimbursement again', async () => {
      await payRow(d1, '2026-11-10', '100.00', '1.92');
      // The carrier amends the claim from 40 to 45 after 40 was already deducted: only the 5 difference is owed.
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [claimId]);
      const v2 = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
        VALUES ('gofo', repeat('c', 64), 2, 'TESTP001', 'Damaged Item', 'damaged item', '2026-10-30 10:00', -45, 45, $1, 'synthetic-2.xlsx', 'Claims Detail', 2) RETURNING id`, [city])).id;
      await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, 45, 'test', 'test')`, [v2, d1, city]);
      const next = (await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-08', periodEnd: '2026-11-14', dataType: 'weekly' })).run;
      const s1 = statementOf(await getRun(db, cityAdmin, next.id), d1);
      // rows 9 Nov (999.00) and 10 Nov: 5 more for the amended claim, reimbursement already paid, instalment 2 of 4
      assert.deepEqual([s1.gross, s1.claim_deductions, s1.recoveries, s1.reimbursements, s1.carried_forward], ['1099.00', '5.00', '50.00', '0.00', '130.00']);
      await discardRun(db, cityAdmin, next.id, 'Test');
    });

    await t.test('a ledger void waits while a pay run for the same city is being built', async () => {
      // A fresh city: this test's own transaction already holds the lock of `city` from the runs above.
      const lockCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Pay Lock', 'TSTLCK', 'DAILY') RETURNING id")).id;
      await db.query('UPDATE drivers SET city_id = $1 WHERE id = $2', [lockCity, d2]);
      const entry = (await createEntry(db, superAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d2, cityId: lockCity, type: 'expense', amount: '5', reason: 'Test entry', effectiveDate: '2026-11-01' }).entry)).entry;
      const other = await pool.connect();
      try {
        await other.query('BEGIN');
        await lockCityPayroll(other, lockCity); // as if another admin were building a run there right now
        await savepoint(async () => {
          await db.query("SET LOCAL statement_timeout = '400ms'");
          await assert.rejects(voidEntry(db, superAdmin, { entryId: entry.id, requestId: randomUUID(), reason: 'Undo' }), /statement timeout/);
        });
      } finally {
        await other.query('ROLLBACK');
        other.release();
      }
      const voided = await voidEntry(db, superAdmin, { entryId: entry.id, requestId: randomUUID(), reason: 'Undo' });
      assert.equal(voided.entry.entry_type, 'void');
    });

    await t.test('statements and lines cannot be edited or deleted; payout fields can be set', async () => {
      const s = await one('SELECT id FROM pay_statements WHERE pay_run_id = $1 LIMIT 1', [run.id]);
      await savepoint(() => assert.rejects(db.query('UPDATE pay_statements SET net = 1 WHERE id = $1', [s.id]), /cannot be changed/));
      await savepoint(() => assert.rejects(db.query('DELETE FROM pay_statement_lines WHERE statement_id = $1', [s.id]), /cannot be deleted/));
      await savepoint(() => assert.rejects(db.query('UPDATE pay_statement_lines SET amount = 1 WHERE statement_id = $1', [s.id]), /cannot be changed/));
      await savepoint(async () => {
        await db.query("UPDATE pay_statements SET payout_status = 'submitted', payout_reference = 'TEST-REF' WHERE id = $1", [s.id]);
      });
    });

    await t.test('voiding: super admin only, never while a payout is unconfirmed, and it releases everything', async () => {
      await assert.rejects(voidRun(db, cityAdmin, run.id, 'Test'), { status: 403 });
      const s = await one('SELECT id FROM pay_statements WHERE pay_run_id = $1 AND driver_id = $2', [run.id, d1]);
      await db.query("UPDATE pay_statements SET payout_status = 'unconfirmed' WHERE id = $1", [s.id]);
      await assert.rejects(voidRun(db, superAdmin, run.id, 'Test'), { status: 409, message: /reconcile/ });
      await db.query("UPDATE pay_statements SET payout_status = 'failed' WHERE id = $1", [s.id]);
      const voided = await voidRun(db, superAdmin, run.id, 'Wrong period');
      assert.equal(voided.run.status, 'voided');
      const live = await one('SELECT count(*)::int AS n FROM pay_statement_lines l JOIN pay_statements s ON s.id = l.statement_id WHERE s.pay_run_id = $1 AND l.active', [run.id]);
      assert.equal(live.n, 0);
      // released: a new run can take the claim (now its amended 45) and the first instalment again
      const redo = (await generateRun(db, cityAdmin, { requestId: randomUUID(), ...period })).run;
      const s1 = statementOf(await getRun(db, cityAdmin, redo.id), d1);
      assert.deepEqual([s1.claim_deductions, s1.recoveries], ['45.00', '50.00']);
    });

    await t.test('a statement below zero blocks finalizing', async () => {
      const d2only = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Pay Neg', 'TSTNEG', 'DAILY') RETURNING id")).id;
      const r2 = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ('TN 1', 'Test Pay Neg', 2, 1.6, 0.5, 0.25, 'TN-1') RETURNING id`)).id;
      const dd = (await one("INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,9000,9009,'2026-11-02',10) RETURNING id", [d2, r2])).id;
      await db.query("UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = 1, insurance_deduction = 1.92 WHERE dashboard_data_id = $1", [dd]);
      const neg = (await generateRun(db, superAdmin, { requestId: randomUUID(), cityId: d2only, ...{ periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' } })).run;
      await assert.rejects(finalizeRun(db, superAdmin, neg.id), { status: 409, message: /below zero/ });
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
