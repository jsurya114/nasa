import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEntry } from '../services/payroll/ledger/ledgerStore.js';
import { parseNewEntry } from '../services/payroll/ledger/ledgerRules.js';
import { finalizeRun, generateRun, setRecoveryLimit, voidRun } from '../services/payroll/payRuns/payRunStore.js';
import {
  getDriverBalances, getMyBalances, getMyStatement, getStatement, listDriverStatements, listMyStatements, statementState,
} from '../services/payroll/statements/statementStore.js';

test('statement state keeps pending, approved, submitted and paid apart', () => {
  assert.equal(statementState('draft', 'not_submitted'), 'pending');
  assert.equal(statementState('finalized', 'not_submitted'), 'approved');
  for (const payout of ['submitted', 'paid', 'failed', 'unconfirmed']) assert.equal(statementState('finalized', payout), payout);
  assert.equal(statementState('voided', 'not_submitted'), 'voided');
  assert.equal(statementState('discarded', 'not_submitted'), 'discarded');
});

// Needs a PostgreSQL copy with the app's tables (never production). Run with PAYROLL_TEST_DB=1 and the DB_*
// variables. Everything, the migrations included, runs in one transaction that is always rolled back.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8');

test('statements: own data only, frozen amounts, source charge next to the applied deduction', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const m of ['2026-11-03-issue-141-courier-claims.sql', '2026-11-03-issue-142-driver-ledger.sql', '2026-11-03-issue-143-pay-runs.sql']) await db.query(migration(m));

    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const city = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Statement City', 'TSTST', 'DAILY') RETURNING id")).id;
    const otherCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Statement Other', 'TSTSO', 'DAILY') RETURNING id")).id;
    const route = (await one(`INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
      VALUES ('TS 1', 'Test Statement City', 2, 1.6, 0.5, 0.25, 'TS-1') RETURNING id`)).id;
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

    let seq = 8000;
    const payRow = async (driver, date, gross, insurance) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, start_seq, end_seq, journey_date, packages) VALUES ($1,$2,$3,$4,$5,10) RETURNING id', [driver, route, seq, seq + 9, date])).id;
      seq += 10;
      return (await one('UPDATE payment_dashboard SET closed = true, paid = false, driver_payment = $2, insurance_deduction = $3 WHERE dashboard_data_id = $1 RETURNING id', [dd, gross, insurance])).id;
    };
    await payRow(d1, '2026-11-02', '100.00', '1.92');
    await payRow(d1, '2026-11-03', '100.00', '1.92');
    await payRow(d2, '2026-11-03', '80.50', '0');

    // A chargeable claim (carrier charge -40) and an exempt one (-25, shown as 0) for d1, and one (-10) first
    // matched to d2 that is later corrected to d1.
    const claim = async (key, waybill, type, charge, status, eligible, driver = d1, version = 1) => {
      const id = (await one(`INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row)
        VALUES ('gofo', repeat($1, 64), $6, $2, $3, lower($3), '2026-10-30 10:00', $4::numeric, abs($4::numeric), $5, 'synthetic.xlsx', 'Claims Detail', 2) RETURNING id`, [key, waybill, type, charge, city, version])).id;
      await db.query(`INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, $2, $3, $4, $5, 'test', 'test')`, [id, status, driver, city, eligible]);
      return id;
    };
    await claim('a', 'TESTS001', 'Damaged Item', -40, 'chargeable', 40);
    await claim('b', 'TESTS002', 'Tracking interruption', -25, 'exempt', 0);
    const movedClaim = await claim('d', 'TESTS003', 'Damaged Item', -10, 'chargeable', 10, d2);
    const advance = (await createEntry(db, cityAdmin, parseNewEntry({
      requestId: randomUUID(), driverId: d1, cityId: city, type: 'advance', amount: '200', reason: 'Test advance', effectiveDate: '2026-11-01',
      disbursedOutsidePayroll: true, recoveryPlan: 'installments', installmentAmount: '50',
    }).entry)).entry;

    await setRecoveryLimit(db, superAdmin, { type: 'percent_of_available', value: 100 }, 'Test limit');
    const period = { cityId: city, periodStart: '2026-11-01', periodEnd: '2026-11-07', dataType: 'daily' };
    const run = (await generateRun(db, cityAdmin, { requestId: randomUUID(), ...period })).run;

    await t.test('a driver sees nothing from a draft run; an admin sees it as pending', async () => {
      assert.equal((await listMyStatements(db, d1)).length, 0);
      const forAdmin = await listDriverStatements(db, cityAdmin, d1, city);
      assert.deepEqual(forAdmin.map((s) => s.state), ['pending']);
      await assert.rejects(getMyStatement(db, d1, forAdmin[0].id), { status: 404 });
    });

    let statementId;
    await t.test('after finalizing, the driver reads the frozen statement with every source', async () => {
      await finalizeRun(db, cityAdmin, run.id);
      const mine = await listMyStatements(db, d1);
      assert.equal(mine.length, 1);
      statementId = mine[0].id;
      // 200 - 3.84 = 196.16; claim 40 and instalment 50 taken: 106.16
      assert.deepEqual([mine[0].state, mine[0].gross, mine[0].insurance, mine[0].claim_deductions, mine[0].recoveries, mine[0].net],
        ['approved', '200.00', '3.84', '40.00', '50.00', '106.16']);
      const detail = await getMyStatement(db, d1, statementId);
      const claimLine = detail.lines.find((l) => l.line_type === 'claim');
      assert.deepEqual([claimLine.waybill, claimLine.source_charge, claimLine.amount], ['TESTS001', '-40.00', '-40.00']);
      const recovery = detail.lines.find((l) => l.line_type === 'recovery');
      assert.deepEqual([recovery.entry_type, recovery.reason, recovery.entry_amount, recovery.amount], ['advance', 'Test advance', '200.00', '-50.00']);
      assert.equal(detail.lines.filter((l) => l.line_type === 'earning').every((l) => l.route_name === 'TS 1'), true);
    });

    await t.test('another driver cannot read it, and a wrong-city admin is refused', async () => {
      await assert.rejects(getMyStatement(db, d2, statementId), { status: 404 });
      assert.equal((await listMyStatements(db, d2)).every((s) => s.driver_id === d2), true);
      await assert.rejects(getStatement(db, otherAdmin, statementId), { status: 403 });
      await assert.rejects(listDriverStatements(db, otherAdmin, d1, city), { status: 403 });
      await assert.rejects(listDriverStatements(db, cityAdmin, d1, null), { status: 400 });
      await assert.rejects(getDriverBalances(db, otherAdmin, d1, city), { status: 403 });
      assert.equal((await getStatement(db, superAdmin, statementId)).id, statementId);
    });

    await t.test('balances show the original, what was taken, what is left and the pay run that took it', async () => {
      const { entries, claims, totals } = await getMyBalances(db, d1);
      const adv = entries.find((e) => String(e.id) === String(advance.id));
      assert.deepEqual([adv.amount, adv.applied, adv.outstanding], ['200.00', '50.00', '150.00']);
      assert.deepEqual(adv.pay_runs.map((r) => [String(r.runId), r.amount]), [[String(run.id), '-50.00']]);
      const exempt = claims.find((c) => c.waybill === 'TESTS002');
      assert.deepEqual([exempt.status, exempt.source_charge, exempt.applied, exempt.outstanding], ['exempt', '-25.00', '0.00', '0.00']);
      const charged = claims.find((c) => c.waybill === 'TESTS001');
      assert.deepEqual([charged.applied, charged.outstanding], ['40.00', '0.00']);
      assert.deepEqual(totals, { owedByDriver: '150.00', owedToDriver: '0.00' });
    });

    await t.test('a claim moved from another driver shows none of that driver\'s statements', async () => {
      await db.query('UPDATE courier_claims SET superseded_at = now() WHERE id = $1', [movedClaim]);
      await claim('d', 'TESTS003', 'Damaged Item', -10, 'chargeable', 10, d1, 2);
      const moved = (await getMyBalances(db, d1)).claims.find((c) => c.waybill === 'TESTS003');
      // d2 already paid it on their statement: nothing is owed again, and d2's statement is not linked here.
      assert.deepEqual([moved.pay_runs, moved.applied, moved.outstanding], [[], '0.00', '0.00']);
      assert.equal('taken_all' in moved, false);
      const adminView = (await getDriverBalances(db, cityAdmin, d1, city)).claims.find((c) => c.waybill === 'TESTS003');
      assert.deepEqual(adminView.pay_runs, []);
    });

    await t.test('after a claim moves and the first driver is refunded, the balance shown and the next deduction agree', async () => {
      await db.query('SAVEPOINT refund_case');
      try {
        // TESTS003 was deducted from d2 (10) and now belongs to d1. Until d2 is refunded, d1 owes nothing.
        const owed = async () => (await getMyBalances(db, d1)).claims.find((c) => c.waybill === 'TESTS003').outstanding;
        assert.equal(await owed(), '0.00');
        const due = (await getDriverBalances(db, cityAdmin, d2, city)).refundsDue;
        assert.deepEqual(due.map((r) => [r.waybill, r.claimType, r.amount]), [['TESTS003', 'Damaged Item', '10.00']]);
        assert.equal((await getMyBalances(db, d2)).refundsDue, undefined, 'drivers do not get the admin work list');

        const refundAndDeduct = async (amount, weekStart, weekEnd) => {
          await createEntry(db, cityAdmin, parseNewEntry({
            requestId: randomUUID(), driverId: d2, cityId: city, type: 'correction', direction: 'credit', amount,
            waybill: 'TESTS003', claimType: 'Damaged Item', reason: 'Claim belongs to another driver', effectiveDate: weekStart,
          }).entry);
          await payRow(d2, weekStart, '50.00', '0');
          await payRow(d1, weekEnd, '50.00', '0');
          const r = (await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: weekStart, periodEnd: weekEnd, dataType: 'daily' })).run;
          await finalizeRun(db, cityAdmin, r.id);
          return r;
        };
        // A partial refund of 4, finalized: d1 now shows 4 owed, and the next run deducts exactly 4.
        await refundAndDeduct('4', '2026-11-08', '2026-11-14');
        assert.equal(await owed(), '4.00', 'before the fix: 0');
        await payRow(d1, '2026-11-16', '50.00', '0');
        const r3 = (await generateRun(db, cityAdmin, { requestId: randomUUID(), cityId: city, periodStart: '2026-11-15', periodEnd: '2026-11-21', dataType: 'daily' })).run;
        const s3 = (await listDriverStatements(db, cityAdmin, d1, city)).find((x) => String(x.pay_run_id) === String(r3.id));
        assert.equal(s3.claim_deductions, '4.00', 'the deduction matches the balance shown');
        await finalizeRun(db, cityAdmin, r3.id);
        assert.equal(await owed(), '0.00');
        // The rest of the refund (6), finalized: d1 owes 6 more, and the privacy rule still holds.
        await refundAndDeduct('6', '2026-11-22', '2026-11-28');
        assert.equal(await owed(), '6.00');
        const moved = (await getMyBalances(db, d1)).claims.find((c) => c.waybill === 'TESTS003');
        const d2Statements = (await listMyStatements(db, d2)).map((x) => String(x.id));
        assert.equal(moved.pay_runs.some((p) => d2Statements.includes(String(p.statementId))), false, 'none of d2\'s statements are linked for d1');
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT refund_case');
      }
    });

    await t.test('a voided run stays visible as voided and its deductions count as not taken', async () => {
      await voidRun(db, superAdmin, run.id, 'Test void');
      const [statement] = await listMyStatements(db, d1);
      assert.deepEqual([statement.id, statement.state, statement.net], [statementId, 'voided', '106.16']);
      const { totals } = await getMyBalances(db, d1);
      assert.equal(totals.owedByDriver, '250.00', 'claims 40 and 10 and advance 200 are owed again');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
