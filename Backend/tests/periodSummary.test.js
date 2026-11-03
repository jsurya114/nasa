import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry } from '../services/payroll/ledger/ledgerStore.js';
import { settleEntry } from '../services/payroll/ledger/ledgerSettlements.js';
import { parseNewEntry, parseSettlement } from '../services/payroll/ledger/ledgerRules.js';
import { finalizeRun, generateRun, getRun, setRecoveryLimit } from '../services/payroll/payRuns/payRunStore.js';
import { getDriverPeriodSummary } from '../services/payroll/statements/periodSummary.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the migrations included, runs in one transaction that is always rolled back.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('dashboard period summary: this payday, approved or preview, and what is still outstanding', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql',
      '2026-11-03-issue-166-ledger-settlements.sql']) await db.query(migration(m));

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Sum City', 'TSTSU', 'DAILY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Sum Other', 'TSTSO', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TU 1', 'Test Sum City', 2, 1.6, 0.5, 0.25, 'TU-1') RETURNING id`)).id;
    const [d1, d2, d3] = (await db.query('SELECT id FROM drivers ORDER BY id LIMIT 3')).rows.map((r) => r.id);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = ANY($2::int[])', [city, [d1, d3]]);
    await db.query('UPDATE drivers SET city_id = $1 WHERE id = $2', [otherCity, d2]);
    const admin = async (role) => {
      const tag = randomUUID();
      return one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${tag}`, `${tag}@example.com`, role]);
    };
    const superAdmin = await admin('superadmin');
    const cityAdmin = await admin('admin');
    const otherAdmin = await admin('admin');
    await db.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2), ($3, $4)', [cityAdmin.id, city, otherAdmin.id, otherCity]);

    // One closed pay row of 100 on 3 Nov; a carrier claim of 25 and a hand-entered penalty of 40, both due; and a
    // second penalty of 300 recovered as 50 a payday, which will stay mostly outstanding.
    const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,9200,9209,$3,10) RETURNING id', [d1, route, '2026-11-03'])).id;
    await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = 100, insurance_deduction = 0 WHERE dashboard_data_id = $1 RETURNING id', [dd]);
    const claimId = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
      VALUES ('gofo', repeat('d', 64), 1, 'TESTU001', 'Damaged Item', 'damaged item', '2026-10-30 10:00', -25, 25, $1, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [city])).id;
    await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, 25, 'test', 'test')`, [claimId, d1, city]);
    const penalty = async (o) => (await createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d1, cityId: city, type: 'manual_claim', claimType: 'Fake POD', reason: 'Penalty', effectiveDate: '2026-11-01', ...o }).entry)).entry;
    await penalty({ amount: '40', recoveryPlan: 'full_next_payday' });
    const p300 = await penalty({ amount: '300', recoveryPlan: 'installments', installmentAmount: '50' });
    const ask = (who, o = {}) => getDriverPeriodSummary(db, who, { driverId: d1, cityId: city, from: '2026-11-01', to: '2026-11-07', ...o });

    await t.test('before any run: nothing is deducted, and the outstanding penalties are shown apart', async () => {
      const s = await ask(cityAdmin);
      assert.equal(s.period.status, 'none');
      assert.deepEqual(s.outstanding, { penalties: '340.00', other: '25.00', total: '365.00' }, 'the 25 carrier claim is not a hand-entered penalty');
      // no recovery limit is set yet, so nothing is deducted automatically, and the page is told why instead of a silent zero
      assert.equal(s.payday.source, 'estimate');
      assert.equal(s.payday.deducted, '0.00');
      assert.ok(s.payday.flags.some((f) => f.code === 'recovery_limit_not_set'));
      // no dates: only what is owed, and no pay-run figures
      const noDates = await getDriverPeriodSummary(db, cityAdmin, { driverId: d1, cityId: city });
      assert.deepEqual([noDates.payday.source, noDates.payday.deducted], ['none', '0.00']);
    });

    let run;
    await t.test('a draft run is a preview: this payday only, never the whole debt', async () => {
      await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
      // before the run exists, an estimate from the same calculator: by each record's arrangement, under the limit, nothing saved
      const estimate = (await ask(cityAdmin)).payday;
      assert.equal(estimate.source, 'estimate');
      assert.equal(await one('SELECT count(*)::int n FROM pay_runs WHERE city_id = $1', [city]).then((r) => r.n), 0, 'the estimate saves no run');
      assert.deepEqual([estimate.claimDeductions, estimate.recoveries, estimate.deducted], ['25.00', '75.00', '100.00'], 'claim 25, then the 40 due in full and 35 of the 50 instalment, capped at the 100 earned');
      run = (await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' })).run;
      const s = await ask(cityAdmin);
      assert.equal(s.payday.source, 'draft');
      assert.deepEqual([s.payday.claimDeductions, s.payday.recoveries, s.payday.deducted], [estimate.claimDeductions, estimate.recoveries, estimate.deducted], 'the draft run takes exactly what the estimate showed');
      // 25 carrier claim; 40 + 50 instalment recovered; net 100 - 115 would be negative, so the limit caps at 100
      const statement = (await getRun(db, cityAdmin, run.id)).statements[0];
      assert.equal(s.period.status, 'preview');
      assert.equal(s.period.approved.count, 0);
      assert.deepEqual([s.period.preview.claimDeductions, s.period.preview.recoveries, s.period.preview.net], [statement.claim_deductions, statement.recoveries, statement.net]);
      assert.equal(s.period.statements[0].net, statement.net, 'the net is the statement\'s own');
    });

    await t.test('after finalizing it is approved and the net is the frozen statement net', async () => {
      await finalizeRun(db, cityAdmin, run.id);
      const s = await ask(cityAdmin);
      assert.equal(s.payday.source, 'approved');
      assert.equal(s.payday.net, (await getRun(db, cityAdmin, run.id)).statements[0].net, 'the approved net is the frozen statement net');
      const statement = (await getRun(db, cityAdmin, run.id)).statements[0];
      assert.equal(s.period.status, 'approved');
      assert.equal(s.period.approved.net, statement.net);
      assert.equal(s.period.preview.count, 0);
      assert.equal(s.period.approved.deducted, (Number(statement.claim_deductions) + Number(statement.recoveries)).toFixed(2));
      // the whole debt is not subtracted: outstanding is what is left after the payday's share
      assert.equal(Number(s.outstanding.total) + Number(statement.recoveries) + Number(statement.claim_deductions), 365, 'outstanding plus what this payday took is the debt (340 of penalties and 25 of carrier claim)');
    });

    await t.test('the same run is not counted for a range that only crosses it, nor for another range', async () => {
      const crossing = await ask(cityAdmin, { from: '2026-11-04', to: '2026-11-10' });
      assert.deepEqual([crossing.period.status, crossing.period.crossingRuns], ['none', 1]);
      const wider = await ask(cityAdmin, { from: '2026-10-25', to: '2026-11-30' });
      assert.equal(wider.period.status, 'approved');
      const later = await ask(cityAdmin, { from: '2026-11-08', to: '2026-11-14' });
      assert.deepEqual([later.period.status, later.period.crossingRuns], ['none', 0]);
    });

    await t.test('a repayment outside payroll lowers that penalty\'s outstanding amount', async () => {
      const before = Number((await ask(cityAdmin)).outstanding.penalties);
      await settleEntry(db, cityAdmin, parseSettlement({ requestId: randomUUID(), kind: 'outside_repayment', amount: '100', settledOn: '2026-11-05', reference: 'RCPT-5', reason: 'Paid in cash' }, p300.id).settlement);
      const after = await ask(cityAdmin);
      assert.equal(Number(after.outstanding.penalties), before - 100);
      assert.equal(after.period.status, 'approved', 'the approved payday is unchanged');
    });

    await t.test('the outstanding parts add up to the total: outside repayments, settlements and waivers (issue #170 review)', async () => {
      const add = (driverId, o) => createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId, cityId: city, reason: 'Test entry', effectiveDate: '2026-12-01', ...o }).entry);
      const outstandingOf = async (driverId) => (await getDriverPeriodSummary(db, cityAdmin, { driverId, cityId: city, from: '2026-11-01', to: '2026-11-07' })).outstanding;
      const adds = (o) => (Number(o.penalties) + Number(o.other)).toFixed(2) === Number(o.total).toFixed(2);

      // a clean driver: a $40 penalty with $20 repaid outside payroll owes $20, all of it a penalty (never $40 over a $20 debt)
      const penalty = await add(d3, { type: 'manual_claim', claimType: 'Fake POD', amount: '40' });
      assert.deepEqual(await outstandingOf(d3), { penalties: '40.00', other: '0.00', total: '40.00' });
      await add(d3, { type: 'advance_repayment', amount: '20' });
      assert.deepEqual(await outstandingOf(d3), { penalties: '20.00', other: '0.00', total: '20.00' });
      // repaid in full, and repaid more than is owed: nothing owed, nothing negative
      await add(d3, { type: 'advance_repayment', amount: '20' });
      assert.deepEqual(await outstandingOf(d3), { penalties: '0.00', other: '0.00', total: '0.00' });
      await add(d3, { type: 'advance_repayment', amount: '15' });
      assert.deepEqual(await outstandingOf(d3), { penalties: '0.00', other: '0.00', total: '0.00' });

      // a linked partial settlement and a waiver on the penalty, then a pooled repayment on top of an older expense
      const p = await add(d3, { type: 'manual_claim', claimType: 'Late', amount: '100', effectiveDate: '2026-12-05' });
      const settle = (kind, amount, who) => settleEntry(db, who, parseSettlement({ requestId: randomUUID(), kind, amount, settledOn: '2026-12-06', reason: 'Test settlement', ...(kind === 'outside_repayment' && { reference: 'RCPT-6' }) }, p.entry.id).settlement);
      await settle('outside_repayment', '30', cityAdmin);
      await settle('waiver', '20', superAdmin);
      const after = await outstandingOf(d3);
      assert.ok(adds(after));
      // owed: 40 + (100 - 30 settled - 20 waived) = 90; repaid outside payroll in all: 20 + 20 + 15 = 55; so 35 is owed, all penalties
      assert.deepEqual(after, { penalties: '35.00', other: '0.00', total: '35.00' });
      // older debts take the pooled repayment first: a 25 expense dated before the penalties is cleared first (55 - 25 = 30 goes to the
      // 40 penalty), so what remains is still all penalties
      await add(d3, { type: 'expense', amount: '25', effectiveDate: '2026-11-01' });
      assert.deepEqual(await outstandingOf(d3), { penalties: '60.00', other: '0.00', total: '60.00' });
      // a larger, older expense keeps part of the debt: 215 owed less 55 repaid is 160, split by age
      await add(d3, { type: 'expense', amount: '100', effectiveDate: '2026-11-02' });
      const mixed = await outstandingOf(d3);
      assert.deepEqual(mixed, { penalties: '90.00', other: '70.00', total: '160.00' });
      assert.ok(adds(mixed));
    });

    await t.test('a driver with no pay rows yet still gets the reasons, and an instalment is a share, never the whole debt', async () => {
      // d3 has only records: a 300 penalty on 50 instalments, and no earnings in the range
      const add = (o) => createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d3, cityId: city, reason: 'Test entry', effectiveDate: '2026-11-01', ...o }).entry);
      const before = Number((await getDriverPeriodSummary(db, cityAdmin, { driverId: d3, cityId: city, from: '2026-11-01', to: '2026-11-07' })).outstanding.total);
      await add({ type: 'manual_claim', claimType: 'Fake POD', amount: '300', recoveryPlan: 'installments', installmentAmount: '50' });
      await add({ type: 'expense', amount: '20' }); // no arrangement: held for review
      const s = await getDriverPeriodSummary(db, cityAdmin, { driverId: d3, cityId: city, from: '2026-11-01', to: '2026-11-07' });
      assert.equal((Number(s.outstanding.total) - before).toFixed(2), '320.00', 'the whole 300 and the 20 are owed');
      assert.equal(s.payday.deducted, '0.00', 'nothing earned, so nothing can be taken this payday');
      assert.ok(s.payday.flags.some((f) => f.code === 'needs_review'), 'the entry with no arrangement is flagged');
    });

    await t.test('the estimate equals what real drafts take one after the other: daily and weekly rows, a claim, an instalment and a reimbursement', async () => {
      // A second city and a clean driver (d2): $100 of daily pay (insurance 20) and $100 of weekly pay in the range, a $25 carrier
      // claim, a $300 penalty on $50 instalments, and a $50 reimbursement. The same instalment and claim must not be counted twice.
      const city2 = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Sum City 2', 'TSTS2', 'DAILY') RETURNING id")).id;
      const route2 = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ('TU 2', 'Test Sum City 2', 2, 1.6, 0.5, 0.25, 'TU-2') RETURNING id`)).id;
      await db.query('UPDATE drivers SET city_id = $1 WHERE id = $2', [city2, d2]);
      const payRow = async (seqStart, seqEnd, date, gross, insurance) => {
        const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [d2, route2, seqStart, seqEnd, date])).id;
        await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross, insurance]);
      };
      await payRow(9300, 9309, '2026-11-03', '100.00', '20.00'); // daily
      await payRow(0, 0, '2026-11-04', '100.00', '0');           // weekly
      const claim = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
        VALUES ('gofo', repeat('e', 64), 1, 'TESTU002', 'Damaged Item', 'damaged item', '2026-10-30 10:00', -25, 25, $1, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [city2])).id;
      await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, 25, 'test', 'test')`, [claim, d2, city2]);
      const add = (o) => createEntry(db, superAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d2, cityId: city2, reason: 'Test entry', effectiveDate: '2026-11-01', ...o }).entry);
      await add({ type: 'manual_claim', claimType: 'Fake POD', amount: '300', recoveryPlan: 'installments', installmentAmount: '50' });
      await add({ type: 'reimbursement', amount: '50' });

      const estimate = (await getDriverPeriodSummary(db, superAdmin, { driverId: d2, cityId: city2, from: '2026-11-01', to: '2026-11-07' })).payday;
      assert.equal(estimate.source, 'estimate');
      const period = { cityId: city2, periodStart: '2026-11-01', periodEnd: '2026-11-07' };
      const daily = (await generateRun(db, superAdmin, { requestId: randomUUID(), ...period, dataType: 'daily' })).run;
      const weekly = (await generateRun(db, superAdmin, { requestId: randomUUID(), ...period, dataType: 'weekly' })).run;
      const statements = [(await getRun(db, superAdmin, daily.id)).statements[0], (await getRun(db, superAdmin, weekly.id)).statements[0]];
      const total = (key) => statements.reduce((sum, st) => sum + Number(st[key]), 0).toFixed(2);
      // real drafts: daily takes the claim (25) and the instalment (50) and pays the reimbursement (50), net 55; weekly takes nothing more, net 100
      assert.deepEqual([statements[0].claim_deductions, statements[0].recoveries, statements[0].net], ['25.00', '50.00', '55.00']);
      assert.deepEqual([statements[1].claim_deductions, statements[1].recoveries, statements[1].net], ['0.00', '0.00', '100.00']);
      assert.deepEqual([estimate.claimDeductions, estimate.recoveries, estimate.deducted], [total('claim_deductions'), total('recoveries'), (Number(total('claim_deductions')) + Number(total('recoveries'))).toFixed(2)],
        'the estimate takes exactly what the two drafts took, not the instalment and the claim twice');
      assert.equal(estimate.net, total('net'), 'and its net is the calculator\'s own net, with the reimbursement in it');
    });

    await t.test('without dates only what is outstanding is returned, and half a range is refused', async () => {
      const s = await getDriverPeriodSummary(db, cityAdmin, { driverId: d1, cityId: city });
      assert.equal(s.period.status, 'none');
      assert.equal(s.period.crossingRuns, 0);
      assert.equal(s.outstanding.total, (await ask(cityAdmin)).outstanding.total, 'the same outstanding figures as with a range');
      await assert.rejects(getDriverPeriodSummary(db, cityAdmin, { driverId: d1, cityId: city, from: '2026-11-01' }), { status: 400 });
    });

    await t.test('bad dates, the wrong city, a driver of another city and a missing city are refused', async () => {
      await assert.rejects(ask(cityAdmin, { from: '2026-11-08', to: '2026-11-01' }), { status: 400 });
      await assert.rejects(ask(cityAdmin, { from: 'x', to: '2026-11-01' }), { status: 400 });
      await assert.rejects(ask(otherAdmin), { status: 403 });
      await assert.rejects(getDriverPeriodSummary(db, superAdmin, { driverId: d2, cityId: city, from: '2026-11-01', to: '2026-11-07' }), { status: 404 });
      assert.equal((await ask(superAdmin)).period.status, 'approved');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
