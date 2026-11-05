import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry } from '../services/payroll/ledger/ledgerStore.js';
import { settleEntry } from '../services/payroll/ledger/ledgerSettlements.js';
import { parseNewEntry, parseSettlement } from '../services/payroll/ledger/ledgerRules.js';
import { discardRun, finalizeRun, generateRun, getRun, setRecoveryLimit } from '../services/payroll/payRuns/payRunStore.js';
import { getDriverPeriodSummary } from '../services/payroll/statements/periodSummary.js';

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the migrations included, runs in one transaction that is always rolled back.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const PLAN = (o) => (['advance', 'manual_claim'].includes(o.type) && o.recoveryPlan === undefined ? { recoveryPlan: 'full_next_payday' } : {}); // an advance or penalty above the driver's payment must say how it is repaid
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
    const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,0,0,$3,10) RETURNING id', [d1, route, '2026-11-03'])).id;
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
      assert.deepEqual(s.outstanding, { penalties: '365.00', other: '0.00', total: '365.00' }, 'the 25 carrier claim from the Excel is a penalty, like the 340 entered by hand');
      // no recovery limit is set, yet the dashboard still shows what each record asks for this payday: 25 claim, 40 in full, 35 of the 50 instalment, capped at the 100 earned
      assert.equal(s.payday.source, 'estimate');
      assert.deepEqual([s.payday.claimDeductions, s.payday.recoveries, s.payday.deducted], ['25.00', '75.00', '100.00']);
      assert.ok(!s.payday.flags.some((f) => f.code === 'recovery_limit_not_set'));
      // no dates: the same estimate, over all the driver's closed, unpaid pay up to today
      const noDates = await getDriverPeriodSummary(db, cityAdmin, { driverId: d1, cityId: city });
      assert.deepEqual([noDates.payday.source, noDates.payday.deducted], ['estimate', '100.00']);
    });

    let run;
    await t.test('a draft run is a preview: this payday only, never the whole debt', async () => {
      await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
      // before the run exists, an estimate from the same calculator: by each record's arrangement, under the limit, nothing saved
      const estimate = (await ask(cityAdmin)).payday;
      assert.equal(estimate.source, 'estimate');
      assert.equal(await one('SELECT count(*)::int n FROM pay_runs WHERE city_id = $1', [city]).then((r) => r.n), 0, 'the estimate saves no run');
      assert.deepEqual([estimate.claimDeductions, estimate.recoveries, estimate.deducted], ['25.00', '75.00', '100.00'], 'claim 25, then the 40 due in full and 35 of the 50 instalment, capped at the 100 earned');
      run = (await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'weekly' })).run;
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
      const add = (driverId, o) => createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId, cityId: city, reason: 'Test entry', effectiveDate: '2026-12-01', ...o, ...PLAN(o) }).entry);
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
      assert.ok(s.payday.flags.some((f) => f.code === 'no_eligible_earnings'));
      assert.equal(s.payday.net, null);
    });

    await t.test('no eligible pay rows and a due reimbursement: nothing is estimated, because no real run creates a statement', async () => {
      // d3 has a 300 penalty on 50 instalments and no closed, unpaid pay rows. A 50 reimbursement must not fund a deduction.
      await createEntry(db, cityAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d3, cityId: city, type: 'reimbursement', amount: '50', reason: 'Fuel', effectiveDate: '2026-11-01' }).entry);
      const range = { driverId: d3, cityId: city, from: '2026-11-01', to: '2026-11-07' };
      const s = await getDriverPeriodSummary(db, cityAdmin, range);
      assert.deepEqual([s.payday.source, s.payday.deducted, s.payday.claimDeductions, s.payday.recoveries, s.payday.net], ['estimate', '0.00', '0.00', '0.00', null]);
      // the following real runs, daily and weekly, create no statement for this driver, so nothing would be taken
      const before = await one('SELECT count(*)::int n FROM pay_statements WHERE driver_id = $1', [d3]);
      for (const dataType of ['daily', 'weekly']) {
        const { run } = await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType });
        assert.equal((await getRun(db, cityAdmin, run.id)).statements.some((st) => st.driver_id === d3), false, `${dataType}: no statement for this driver`);
      }
      assert.equal((await one('SELECT count(*)::int n FROM pay_statements WHERE driver_id = $1', [d3])).n, before.n);
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
      // no dates chosen: the same figures, because all of this driver's closed, unpaid pay is in the range anyway
      assert.deepEqual((await getDriverPeriodSummary(db, superAdmin, { driverId: d2, cityId: city2 })).payday, estimate, 'without dates the estimate is the same');
      const period = { cityId: city2, periodStart: '2026-11-01', periodEnd: '2026-11-07' };
      const daily = (await generateRun(db, superAdmin, { requestId: randomUUID(), ...period, dataType: 'daily' })).run;
      const weekly = (await generateRun(db, superAdmin, { requestId: randomUUID(), ...period, dataType: 'weekly' })).run;
      const statements = [(await getRun(db, superAdmin, daily.id)).statements[0], (await getRun(db, superAdmin, weekly.id)).statements[0]];
      const total = (key) => statements.reduce((sum, st) => sum + Number(st[key]), 0).toFixed(2);
      // real drafts: the daily run takes the instalment (50) and pays the reimbursement (50), net 80, and never the carrier claim; the weekly run
      // takes the claim (25) and no second instalment, net 75. Carrier claims are taken only by a weekly run.
      assert.deepEqual([statements[0].claim_deductions, statements[0].recoveries, statements[0].net], ['0.00', '50.00', '80.00']);
      assert.deepEqual([statements[1].claim_deductions, statements[1].recoveries, statements[1].net], ['25.00', '0.00', '75.00']);
      assert.deepEqual([estimate.claimDeductions, estimate.recoveries, estimate.deducted], [total('claim_deductions'), total('recoveries'), (Number(total('claim_deductions')) + Number(total('recoveries'))).toFixed(2)],
        'the estimate takes exactly what the two drafts took, not the instalment and the claim twice');
      assert.equal(estimate.net, total('net'), 'and its net is the calculator\'s own net, with the reimbursement in it');
      // The same driver without dates: the estimate was worked out before the runs above, so it is gone now; ask again on a fresh
      // driver below. Here the rows are on live statements, so nothing is eligible.
      const after = (await getDriverPeriodSummary(db, superAdmin, { driverId: d2, cityId: city2 })).payday;
      assert.deepEqual([after.source, after.deducted, after.net], ['estimate', '0.00', null]);
    });

    // A clean city, route and driver for a scenario of its own (the drivers above are used up). Weekly pay rows have no sequence numbers.
    let scenario = 0;
    const freshScenario = async () => {
      scenario += 1;
      const name = `Test Sum Scenario ${scenario}`;
      const c = (await one("INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, 'DAILY') RETURNING id", [name, `TSS${scenario}`])).id;
      const r = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
        VALUES ($1, $2, 2, 1.6, 0.5, 0.25, $3) RETURNING id`, [`TS ${scenario}`, name, `TS-${scenario}`])).id;
      const tag = randomUUID();
      const d = (await one("INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES ('x', $1, $2, $3, $4, true) RETURNING id",
        [`Scenario Driver ${scenario}`, `${tag}@example.com`, 8700000 + scenario, c])).id;
      let seq = 9600 + scenario * 100;
      const row = async (date, gross, { weekly = true } = {}) => {
        const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [d, r, weekly ? 0 : seq, weekly ? 0 : seq + 9, date])).id;
        seq += 10;
        await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = 0 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross]);
      };
      const day = async (offset) => (await one("SELECT to_char(CURRENT_DATE + $1::int, 'YYYY-MM-DD') AS d", [offset])).d;
      const claim = async (amount) => {
        const id = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
          VALUES ('gofo', encode(sha256($1::bytea), 'hex'), 1, $2, 'Damaged Item', 'damaged item', now(), $3, $4, $5, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [`scenario-${scenario}`, `TESTSC${scenario}`, -amount, amount, c])).id;
        await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, 'chargeable', $2, $3, $4, 'test', 'test')`, [id, d, c, amount]);
        return id;
      };
      const penalty = (o) => createEntry(db, superAdmin, parseNewEntry({ requestId: randomUUID(), driverId: d, cityId: c, type: 'manual_claim', claimType: 'Fake POD', reason: 'Penalty', effectiveDate: '2026-01-01', ...o }).entry);
      const estimate = async (range = {}) => (await getDriverPeriodSummary(db, superAdmin, { driverId: d, cityId: c, ...range })).payday;
      const draft = async (periodStart, periodEnd, dataType) => (await getRun(db, superAdmin, (await generateRun(db, superAdmin, { requestId: randomUUID(), cityId: c, periodStart, periodEnd, dataType })).run.id));
      return { c, d, row, day, claim, penalty, estimate, draft };
    };

    await t.test('carrier claims are taken only by a weekly run: a daily run in the same city never consumes one, and the estimate agrees', async () => {
      const sc = await freshScenario();
      const claimId = await sc.claim(25);
      await sc.penalty({ amount: '300', recoveryPlan: 'installments', installmentAmount: '50' });
      const today = await sc.day(0);
      const from = await sc.day(-6);
      await sc.row(today, '100.00', { weekly: false }); // a daily (SpeedX-style) pay row
      // the estimate and the real daily draft both take only the manual instalment, and leave the carrier claim alone
      const dailyEstimate = await sc.estimate({ from, to: today });
      const daily = await sc.draft(from, today, 'daily');
      const statement = daily.statements[0];
      assert.deepEqual([statement.claim_deductions, statement.recoveries], ['0.00', '50.00']);
      assert.deepEqual([dailyEstimate.claimDeductions, dailyEstimate.recoveries], ['0.00', '50.00']);
      assert.equal(Number((await one('SELECT count(*) n FROM pay_statement_lines WHERE claim_id = $1 AND active', [claimId])).n), 0, 'the claim is still waiting for a weekly run');
      // a weekly pay row for the same driver: now the claim is taken, by the weekly run only (the instalment is held: same period)
      await discardRun(db, superAdmin, daily.run.id, 'Test');
      await sc.row(today, '100.00');
      const weeklyEstimate = await sc.estimate({ from, to: today });
      const weekly = await sc.draft(from, today, 'weekly');
      assert.deepEqual([weekly.statements[0].claim_deductions, weekly.statements[0].recoveries], ['25.00', '50.00']);
      // (the estimate runs the daily run, then the weekly run, as above: the instalment once, the claim once)
      assert.deepEqual([weeklyEstimate.claimDeductions, weeklyEstimate.recoveries], ['25.00', '50.00']);
      assert.equal(Number((await one('SELECT count(*) n FROM pay_statement_lines WHERE claim_id = $1 AND active', [claimId])).n), 1, 'taken once, by the weekly run');
    });

    await t.test('with no dates, an instalment taken for an earlier period does not hold back this period\'s (relative to today, against the real draft)', async () => {
      const sc = await freshScenario();
      await sc.penalty({ amount: '300', recoveryPlan: 'installments', installmentAmount: '50' });
      const earlierDay = await sc.day(-14);
      const today = await sc.day(0);
      // an earlier pay period: $100 earned two weeks ago, $50 taken for it
      await sc.row(earlierDay, '100.00');
      const earlier = await sc.draft(await sc.day(-20), earlierDay, 'weekly');
      assert.equal(earlier.statements[0].recoveries, '50.00');
      await finalizeRun(db, superAdmin, earlier.run.id);
      // new work today: $100 eligible
      await sc.row(today, '100.00');
      const noDates = await sc.estimate();
      const current = await sc.estimate({ from: await sc.day(-6), to: today });
      assert.deepEqual([noDates.deducted, noDates.net], ['50.00', '50.00'], 'before the fix: 0.00 and 100.00, the old instalment held it back');
      assert.deepEqual([current.deducted, current.net], [noDates.deducted, noDates.net], 'the same as an explicit current-period estimate');
      const real = await sc.draft(await sc.day(-6), today, 'weekly');
      assert.deepEqual([real.statements[0].recoveries, real.statements[0].net], ['50.00', '50.00'], 'and the same as the real following draft');
      // the once-per-overlapping-period protection is kept: with that draft in place the same work cannot be taken twice
      const again = await sc.estimate();
      assert.deepEqual([again.deducted, again.net], ['0.00', null]);
    });

    await t.test('a penalty entered after the week the pay is for is still taken (no dates), the same as the real draft that ends today', async () => {
      const sc = await freshScenario();
      const workDay = await sc.day(-20); // the pay is from three weeks ago (an older report)
      await sc.row(workDay, '100.00');
      await sc.penalty({ amount: '60', recoveryPlan: 'full_next_payday', effectiveDate: await sc.day(-5) }); // entered much later
      const noDates = await sc.estimate();
      assert.deepEqual([noDates.deducted, noDates.net], ['60.00', '40.00'], 'before the fix: 0.00, the penalty looked dated in the future');
      assert.equal(noDates.flags.some((f) => f.code === 'not_yet_due'), false);
      const real = await sc.draft(await sc.day(-26), await sc.day(0), 'weekly'); // a run for the last days ends today
      assert.deepEqual([real.statements[0].recoveries, real.statements[0].net], ['60.00', '40.00'], 'the same as the real draft');
    });

    await t.test('a record dated in the future is not taken, and the reason is shown instead of a silent zero', async () => {
      const sc = await freshScenario();
      await sc.row(await sc.day(-2), '100.00');
      await sc.penalty({ amount: '60', recoveryPlan: 'full_next_payday', effectiveDate: await sc.day(10) });
      const estimate = await sc.estimate();
      assert.equal(estimate.deducted, '0.00');
      assert.ok(estimate.flags.some((f) => f.code === 'not_yet_due'), 'says why');
    });

    await t.test('the estimate does not depend on the recovery limit, set or not', async () => {
      const sc = await freshScenario();
      await sc.row(await sc.day(-2), '100.00');
      await sc.penalty({ amount: '60', recoveryPlan: 'full_next_payday', effectiveDate: await sc.day(-1) });
      for (const limit of [{ type: 'percent_of_available', value: 10 }, null]) {
        await db.query("UPDATE payroll_settings SET value = $1::jsonb WHERE key = 'recovery_limit'", [JSON.stringify(limit)]);
        const estimate = await sc.estimate();
        assert.equal(estimate.deducted, '60.00');
        assert.equal(estimate.net, '40.00');
        assert.ok(!estimate.flags.some((f) => f.code === 'recovery_limit_not_set'));
      }
      await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit'); // put the limit back for the tests after this one
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
