import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry, listEntries, voidEntry } from '../services/payroll/ledger/ledgerStore.js';
import { parseNewEntry } from '../services/payroll/ledger/ledgerRules.js';
import { discardRun, finalizeRun, generateRun, getRun, setRecoveryLimit, voidRun } from '../services/payroll/payRuns/payRunStore.js';

// The cases from Jasil's review of #152, each reproduced and then fixed. Needs a PostgreSQL copy with the app's
// tables (never production): PAYROLL_TEST_DB=1 and the DB_* variables. Everything runs in one transaction that is
// always rolled back, and each case in its own savepoint, so the cases cannot affect each other. All data is made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('pay run review cases: dates, one recovery per period, lowered claims, undisbursed advances, ledger balances', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const isolated = (name, fn) => t.test(name, async () => {
    await db.query('SAVEPOINT review_case');
    try { await fn(); } finally { await db.query('ROLLBACK TO SAVEPOINT review_case'); }
  });
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql']) await db.query(migration(m));

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Review City', 'TSTRV', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TR 1', 'Test Review City', 2, 1.6, 0.5, 0.25, 'TR-1') RETURNING id`)).id;
    const [d1, d2] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 2')).rows.map((r) => r.id);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = ANY($2::int[])', [city, [d1, d2]]);
    const tag = randomUUID();
    const admin = await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`]);
    await setRecoveryLimit(db, admin, { type: 'percent_of_available', value: 100 }, 'Test limit');

    let seq = 9500;
    const payRow = async (date, gross = '100.00', insurance = '1.92', driver = d1) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, date])).id;
      seq += 10;
      await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1', [dd, gross, insurance]);
    };
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) await payRow(date); // 294.24 available
    const ledger = async (o) => {
      const parsed = parseNewEntry({ requestId: randomUUID(), driverId: o.driverId ?? d1, cityId: city, reason: 'Test entry', effectiveDate: '2026-11-01', ...o });
      assert.ok(parsed.entry, JSON.stringify(parsed.errors));
      return (await createEntry(db, admin, parsed.entry)).entry;
    };
    const run = async (o = {}) => (await generateRun(db, admin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily', ...o })).run;
    const statement = async (r, driver = d1) => (await getRun(db, admin, r.id)).statements.find((s) => s.driver_id === driver);
    const codes = (s) => s.flags.map((f) => f.code);

    await isolated('a repayment dated in the future does not lower what is recovered today', async () => {
      await ledger({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'full_next_payday' });
      await ledger({ type: 'advance_repayment', amount: '100', effectiveDate: '2027-01-01' });
      const s = await statement(await run());
      assert.equal(s.recoveries, '200.00', 'before the fix: 100');
      assert.equal(s.lines.some((l) => l.line_type === 'repayment'), false, 'a repayment not yet in effect is not used');
    });

    await isolated('a used repayment is recorded on the statement and cannot be voided while that run stands', async () => {
      await ledger({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'full_next_payday' });
      const repaid = await ledger({ type: 'advance_repayment', amount: '60' });
      const s = await statement(await run());
      assert.equal(s.recoveries, '140.00');
      const line = s.lines.find((l) => l.line_type === 'repayment');
      assert.deepEqual([String(line.ledger_entry_id), line.amount], [String(repaid.id), '60.00']);
      await assert.rejects(voidEntry(db, admin, { entryId: repaid.id, requestId: randomUUID(), reason: 'Undo' }), { status: 409 });
    });

    await isolated('a second run for the same period takes no second instalment; discarding the first frees it', async () => {
      await ledger({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50' });
      const first = await run();
      await finalizeRun(db, admin, first.id);
      assert.equal((await statement(first)).recoveries, '50.00');
      await payRow('2026-11-05'); // a late row for the same week, paid in a supplemental run
      const supplemental = await run();
      const s = await statement(supplemental);
      assert.equal(s.recoveries, '0.00', 'before the fix: another 50');
      assert.ok(codes(s).includes('already_recovered_this_period'));
      // A weekly run over the same days overlaps too.
      await discardRun(db, admin, supplemental.id, 'Test');
      const weekly = await run({ dataType: 'weekly' });
      assert.equal((await getRun(db, admin, weekly.id)).statements.length, 0, 'no weekly rows here, but nothing is taken either');
      await discardRun(db, admin, weekly.id, 'Test');
      // Next week is a new pay period.
      await payRow('2026-11-10');
      assert.equal((await statement(await run({ periodStart: '2026-11-08', periodEnd: '2026-11-14' }))).recoveries, '50.00');
    });

    await isolated('a draft that is discarded releases its instalment for the next run of the same period', async () => {
      await ledger({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50' });
      const draft = await run();
      await discardRun(db, admin, draft.id, 'Wrong period');
      assert.equal((await statement(await run())).recoveries, '50.00');
    });

    await isolated('a claim lowered after deduction is flagged on the next statement until a credit correction settles it', async () => {
      const claim = async (version, charge) => {
        const id = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
          VALUES ('gofo', repeat('e', 64), $1, 'TESTR001', 'Damaged Item', 'damaged item', '2026-10-30 10:00', $2::numeric, abs($2::numeric), $3, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [version, charge, city])).id;
        await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, abs($4::numeric), 'test', 'test')`, [id, d1, city, charge]);
        return id;
      };
      const v1 = await claim(1, '-40');
      const first = await run();
      await finalizeRun(db, admin, first.id);
      assert.equal((await statement(first)).claim_deductions, '40.00');
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [v1]);
      const v2 = await claim(2, '-30'); // the carrier lowers it to 30
      await payRow('2026-11-10');
      const nextWeek = { periodStart: '2026-11-08', periodEnd: '2026-11-14' };
      const draft = await run(nextWeek);
      const flagged = (await statement(draft)).flags.find((f) => f.code === 'claim_over_recovered');
      assert.deepEqual([String(flagged?.claimId), flagged?.amount], [String(v2), '10.00'], 'before the fix: nothing at all');
      assert.equal((await statement(draft)).claim_deductions, '0.00');
      await discardRun(db, admin, draft.id, 'Record the refund first');
      // The approved refund: a credit correction naming the claim. It is paid once and the flag goes away.
      await ledger({ type: 'correction', direction: 'credit', amount: '10', waybill: 'TESTR001', claimType: 'Damaged Item', reason: 'Carrier lowered claim' });
      const settled = await statement(await run(nextWeek));
      assert.equal(codes(settled).includes('claim_over_recovered'), false);
      assert.equal(settled.reimbursements, '10.00');
    });

    await isolated('a lowered claim is flagged only in the city whose run deducted it', async () => {
      const cityB = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Review B', 'TSTRB', 'DAILY') RETURNING id")).id;
      const routeB = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ('TRB 1', 'Test Review B', 2, 1.6, 0.5, 0.25, 'TRB-1') RETURNING id`)).id;
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,9900,9909,$3,10) RETURNING id', [d1, routeB, '2026-11-05'])).id;
      await db.query('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = 100, insurance_deduction = 0 WHERE dashboard_data_id = $1', [dd]);
      const claimIn = async (version, charge) => {
        const id = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
          VALUES ('gofo', repeat('f', 64), $1, 'TESTR002', 'Damaged Item', 'damaged item', '2026-10-30 10:00', $2::numeric, abs($2::numeric), $3, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [version, charge, cityB])).id;
        await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, abs($4::numeric), 'test', 'test')`, [id, d1, cityB, charge]);
        return id;
      };
      const v1 = await claimIn(1, '-40');
      const runB = await run({ cityId: cityB });
      await finalizeRun(db, admin, runB.id);
      assert.equal((await statement(runB)).claim_deductions, '40.00');
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [v1]);
      await claimIn(2, '-30');
      // The driver also works in this test's main city: that city's run does not read city B's deductions.
      assert.equal(codes(await statement(await run())).includes('claim_over_recovered'), false);
    });

    // A claim first charged to A (d1), then matched to B (d2). Shared by the two reassignment cases below.
    const reassignedClaim = async (key, waybill) => {
      const claimFor = async (version, driver) => {
        const id = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
          VALUES ('gofo', repeat($1, 64), $2, $3, 'Damaged Item', 'damaged item', '2026-10-30 10:00', -40, 40, $4, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [key, version, waybill, city])).id;
        await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, 40, 'test', 'test')`, [id, driver, city]);
        return id;
      };
      const v1 = await claimFor(1, d1);
      const first = await run();
      await finalizeRun(db, admin, first.id);
      assert.equal((await statement(first)).claim_deductions, '40.00', 'A is charged');
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [v1]);
      await claimFor(2, d2); // the claim really belongs to B
      for (const date of ['2026-11-10', '2026-11-17', '2026-11-24']) {
        await payRow(date);
        await payRow(date, '100.00', '0', d2);
      }
    };
    const week = (n) => ({ periodStart: `2026-11-${String(1 + 7 * n).padStart(2, '0')}`, periodEnd: `2026-11-${String(7 + 7 * n).padStart(2, '0')}` });

    await isolated('a claim moved to another driver: nothing twice while A is unrefunded, then B once after A\'s refund is final', async () => {
      await reassignedClaim('1', 'TESTR003');
      // Week 2: A is not refunded yet, so B is not charged (that would collect 80); A is flagged for a refund.
      let draft = await run(week(1));
      assert.equal((await statement(draft, d2)).claim_deductions, '0.00');
      assert.ok(codes(await statement(draft)).includes('claim_over_recovered'));
      await discardRun(db, admin, draft.id, 'Record the refund first');
      // The refund to A, linked to the claim. While it is only in a draft, B is still not charged.
      await ledger({ type: 'correction', direction: 'credit', amount: '40', waybill: 'TESTR003', claimType: 'Damaged Item', reason: 'Claim was not this driver' });
      draft = await run(week(1));
      assert.deepEqual([(await statement(draft)).reimbursements, (await statement(draft, d2)).claim_deductions], ['40.00', '0.00']);
      await finalizeRun(db, admin, draft.id);
      // Week 3: A's refund is final, so B owes the 40, exactly once (before the fix: 0, never recovered).
      const third = await run(week(2));
      assert.equal((await statement(third, d2)).claim_deductions, '40.00');
      assert.equal(codes(await statement(third)).includes('claim_over_recovered'), false);
      await finalizeRun(db, admin, third.id);
      // Week 4: nothing more.
      assert.equal((await statement(await run(week(3)), d2)).claim_deductions, '0.00');
      // The refund run cannot now be voided: a later run charged B because of it.
      await assert.rejects(voidRun(db, admin, draft.id, 'Payout failed'), { status: 409, message: /relied on a claim refund/ });
    });

    await isolated('a partial refund to A lets B be charged only the refunded part', async () => {
      await reassignedClaim('2', 'TESTR004');
      await ledger({ type: 'correction', direction: 'credit', amount: '25', waybill: 'TESTR004', claimType: 'Damaged Item', reason: 'Part refund' });
      const refundRun = await run(week(1));
      assert.equal((await statement(refundRun)).reimbursements, '25.00');
      await finalizeRun(db, admin, refundRun.id);
      const next = await run(week(2));
      assert.equal((await statement(next, d2)).claim_deductions, '25.00', '15 still sits with A, so B owes 25');
      const flag = (await statement(next)).flags.find((f) => f.code === 'claim_over_recovered');
      assert.equal(flag?.amount, '15.00', 'A is still owed the other 15');
    });

    await isolated('an advance not marked as paid out is never recovered and is counted as waiting', async () => {
      await ledger({ type: 'advance', amount: '100', disbursedOutsidePayroll: false, recoveryPlan: 'full_next_payday' });
      const r = await run();
      const s = await statement(r);
      assert.equal(s.recoveries, '0.00', 'before the fix: 100');
      assert.ok(codes(s).includes('advance_not_disbursed'));
      assert.equal((await getRun(db, admin, r.id)).waiting.advances_not_paid_out, 1);
    });

    await isolated('the ledger list shows what runs settled or reserved, what is left, and which runs took it', async () => {
      const advance = await ledger({ type: 'advance', amount: '200', disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50' });
      const first = await run();
      let listed = (await listEntries(db, admin, { cityId: city, driverId: d1 })).entries.find((e) => String(e.id) === String(advance.id));
      assert.deepEqual([listed.settled, listed.reserved, listed.outstanding], ['0.00', '50.00', '200.00'], 'a draft only reserves');
      await finalizeRun(db, admin, first.id);
      const { entries, balances } = await listEntries(db, admin, { cityId: city, driverId: d1 });
      listed = entries.find((e) => String(e.id) === String(advance.id));
      assert.deepEqual([listed.settled, listed.reserved, listed.outstanding], ['50.00', '0.00', '150.00']);
      assert.deepEqual(listed.pay_runs.map((p) => [String(p.runId), p.runStatus, p.amount]), [[String(first.id), 'finalized', '-50.00']]);
      assert.equal(balances[d1], '150.00', 'before the fix: 200');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
