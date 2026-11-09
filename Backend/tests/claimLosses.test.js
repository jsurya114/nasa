import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseRange } from '../services/reporting/inputs.js';
import { INACTIVE_DAYS, claimLosses } from '../services/reporting/lossReports.js';
import { businessSummary } from '../services/reporting/deliveryReports.js';

// Needs a PostgreSQL copy with the app's tables and the reporting views (never production). Run with MCP_TEST_DB=1 and the DB_* variables. Everything
// happens in one transaction that is always rolled back. All values are made up and dated 2090, so nothing real is read or changed.
const hasDb = process.env.MCP_TEST_DB === '1';

test('claim losses: unrecovered, unmatched, exempt and insurance add up, and profit after them is the margin less the total', { skip: !hasDb && 'set MCP_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const owner = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const db = await owner.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    // the views of this change, in case this copy has not had the migration yet
    const { readFileSync } = await import('node:fs');
    await db.query(readFileSync(new URL('../migrations/2026-11-10-reporting-claim-losses.sql', import.meta.url), 'utf8'));
    const tag = randomBytes(3).toString('hex');
    const city = async (name, type) => (await one('INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, $3) RETURNING id', [`Loss ${name} ${tag}`, `L${name}${tag}`.toUpperCase(), type])).id;
    const cityA = await city('A', 'DAILY');
    const cityB = await city('B', 'WEEKLY');
    const route = async (name, cityId) => (await one(
      `INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
       SELECT $1, c.job, 2, 1.6, 2, 1.6, $3 FROM city c WHERE c.id = $2 RETURNING id`, [`${name} ${tag}`, cityId, `LS-${name}-${tag}`])).id;
    const routeA = await route('A1', cityA);
    const routeB = await route('B1', cityB);
    let code = 800000000 + Math.floor(Math.random() * 90000000);
    const driver = async (label, cityId, enabled = true) => (await one('INSERT INTO drivers (password, name, email, driver_code, city_id, enabled) VALUES (\'x\', $1, $2, $3, $4, $5) RETURNING id',
      [`Loss ${label} ${tag}`, `loss-${label}-${tag}@example.test`, (code += 1), cityId, enabled])).id;
    const active = await driver('active', cityA);
    const gone = await driver('gone', cityA);
    const disabled = await driver('disabled', cityA, false);
    const weekly = await driver('weekly', cityB);
    const delivery = async ({ driverId, routeId, date, seq, delivered, pay = null, margin = null, insurance = null }) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [driverId, routeId, date, seq, seq ? seq + 9 : 0, delivered])).id;
      await db.query('UPDATE payment_dashboard SET delivered = $2, closed = true, driver_payment = $3, company_earnings = $4, insurance_deduction = $5 WHERE dashboard_data_id = $1', [dd, delivered, pay, margin, insurance]);
    };
    // The last day each driver worked: `gone` was last seen long before the as-of day, `disabled` worked recently but is switched off.
    await delivery({ driverId: active, routeId: routeA, date: '2090-03-20', seq: 100, delivered: 40, pay: '64.00', margin: '16.00' });
    await delivery({ driverId: gone, routeId: routeA, date: '2090-01-10', seq: 120, delivered: 10, pay: '16.00', margin: '4.00' });
    await delivery({ driverId: disabled, routeId: routeA, date: '2090-03-25', seq: 140, delivered: 5, pay: '8.00', margin: '2.00' });
    // Weekly city B: insurance withheld from its driver in the billing week 2090-03-06 to 2090-03-12.
    await delivery({ driverId: weekly, routeId: routeB, date: '2090-03-07', seq: 0, delivered: 20, pay: '40.00', margin: '10.00', insurance: '30.00' });
    await delivery({ driverId: weekly, routeId: routeB, date: '2090-03-08', seq: 0, delivered: 10, pay: '20.00', margin: '5.00', insurance: '20.00' });

    const admin = (await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id", [`Loss admin ${tag}`, `loss-${tag}@example.test`])).id;
    let claimNo = 0;
    const claim = async ({ cityId, amount, status, driverId = null, date = '2090-03-01', superseded = false, claimType = 'Damaged Item' }) => {
      claimNo += 1;
      const c = await one(
        `INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row, superseded_at)
         VALUES ('gofo', $1, 1, $2, $3, lower($3), $4, $5, $6, $7, 'synthetic.xlsx', 'Claims Detail', $8, $9) RETURNING id`,
        [randomBytes(32).toString('hex'), `LOSS${tag}${claimNo}`, claimType, `${date} 10:00:00`, -amount, amount, cityId, claimNo, superseded ? new Date().toISOString() : null]);
      const matched = status === 'chargeable' || status === 'exempt';
      await db.query(
        `INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, $2, $3, $4, $5, 'synthetic', 'test')`,
        [c.id, status, matched ? driverId : null, matched ? cityId : null, status === 'chargeable' ? amount : status === 'exempt' ? 0 : null]);
      return c.id;
    };
    const partlyDeducted = await claim({ cityId: cityA, amount: 40, status: 'chargeable', driverId: active });
    const fullyDeducted = await claim({ cityId: cityA, amount: 12, status: 'chargeable', driverId: active });
    await claim({ cityId: cityA, amount: 30, status: 'chargeable', driverId: gone });
    await claim({ cityId: cityA, amount: 20, status: 'chargeable', driverId: disabled });
    await claim({ cityId: cityA, amount: 15, status: 'exempt', driverId: active, claimType: 'Tracking interruption' });
    await claim({ cityId: cityA, amount: 10, status: 'unresolved', date: '2090-03-05' });
    await claim({ cityId: cityA, amount: 999, status: 'chargeable', driverId: active, superseded: true }); // an older version: never counted
    await claim({ cityId: cityA, amount: 77, status: 'chargeable', driverId: active, date: '2089-12-01' }); // dated before the period

    const finalizedRun = (await one(
      `INSERT INTO pay_runs (request_id, city_id, period_start, period_end, data_type, status, created_by, finalized_by, finalized_at) VALUES ($1, $2, '2090-03-01', '2090-03-07', 'daily', 'finalized', $3, $3, now()) RETURNING id`,
      [randomUUID(), cityA, admin])).id;
    const draftRun = (await one(
      `INSERT INTO pay_runs (request_id, city_id, period_start, period_end, data_type, status, created_by) VALUES ($1, $2, '2090-03-08', '2090-03-14', 'daily', 'draft', $3) RETURNING id`,
      [randomUUID(), cityA, admin])).id;
    const statement = async (runId, driverId) => (await one(
      `INSERT INTO pay_statements (pay_run_id, driver_id, gross, insurance, reimbursements, claim_deductions, recoveries, net, carried_forward, payout_status) VALUES ($1, $2, 100, 0, 0, 0, 0, 100, 0, 'not_submitted') RETURNING id`, [runId, driverId])).id;
    const s1 = await statement(finalizedRun, active);
    await db.query(`INSERT INTO pay_statement_lines (statement_id, line_type, amount, claim_id) VALUES ($1, 'claim', -25, $2), ($1, 'claim', -12, $3)`, [s1, partlyDeducted, fullyDeducted]);
    // A draft run has taken nothing yet: its claim line must not count as recovered.
    const s2 = await statement(draftRun, gone);
    const goneClaim = (await one(`SELECT id FROM courier_claims WHERE waybill = $1`, [`LOSS${tag}3`])).id;
    await db.query(`INSERT INTO pay_statement_lines (statement_id, line_type, amount, claim_id) VALUES ($1, 'claim', -30, $2)`, [s2, goneClaim]);

    // The carrier's statement for city B's billing week: a 100.00 driver insurance premium and a 30.00 warehouse penalty (not insurance).
    const statementId = (await one(
      `INSERT INTO carrier_statements (fleet, city_id, period_start, period_end, billing_week, bill_number, currency, fingerprint, version, status, detail_fee_cents, offset_cents, claims_cents, adjustments_cents, settlement_payable_cents, detail_lines, offset_lines, source_label)
       VALUES ($1, $2, '2090-03-06', '2090-03-12', '2090-W10', $3, 'USD', $4, 1, 'published', 0, 0, 0, -13000, -13000, 0, 0, 'synthetic') RETURNING id`,
      [`LS-${tag}`, cityB, `B${tag}`, randomBytes(32).toString('hex')])).id;
    await db.query(`INSERT INTO carrier_statement_items (statement_id, kind, source_row, amount_cents, label) VALUES ($1, 'adjustment', 2, -10000, 'Driver Service Fee'), ($1, 'adjustment', 3, -3000, 'DSP Warehouse Violation Penalty')`, [statementId]);

    const period = parseRange({ start_date: '2090-02-01', end_date: '2090-03-31' });
    const asOf = '2090-03-31';

    await t.test('claims: only what is still owed counts, split by whether the driver is still working, and nothing is double counted', async () => {
      const { data } = await claimLosses(db, { period, cityIds: [cityA], asOf });
      assert.equal(data.inactiveDays, INACTIVE_DAYS);
      assert.deepEqual(data.claimLosses.unrecovered, {
        claims: 3, amount: '65.00',
        likelyLost: { claims: 2, amount: '50.00' },       // the driver last seen in January, and the disabled driver
        stillRecoverable: { claims: 1, amount: '15.00' }, // 40 less the 25 a finalized run took; the 12 claim taken in full is not a loss
      });
      assert.deepEqual(data.claimLosses.unmatched, { claims: 1, amount: '10.00', oldestClaimDate: '2090-03-05' });
      assert.deepEqual(data.claimLosses.exemptAbsorbed, { claims: 1, amount: '15.00' });
      assert.equal(data.claimLosses.total, '90.00', 'older versions and claims before the period are left out; a draft run took nothing');
    });

    await t.test('insurance: the carrier\'s driver service fee less what was withheld, and only that fee', async () => {
      const { data } = await claimLosses(db, { period, cityIds: [cityB], asOf });
      assert.deepEqual(data.insurance, { available: true, statements: 1, carrierPremium: '100.00', withheldFromDrivers: '50.00', difference: '50.00', notRecovered: '50.00' });
      assert.equal(data.claimLosses.total, '0.00');
      assert.equal(data.margin.totalLosses, '50.00');
    });

    await t.test('profit after losses is the approved margin less every loss, and the margin itself is untouched', async () => {
      const all = (await claimLosses(db, { period, cityIds: [cityA, cityB], asOf })).data;
      const margin = (await businessSummary(db, { period, cityIds: [cityA, cityB] })).data.grossMarginBeforeOverheads;
      assert.equal(all.margin.grossMarginBeforeOverheads, margin);
      assert.equal(all.margin.totalLosses, '140.00', '90.00 of claims and 50.00 of insurance');
      assert.equal(all.margin.profitAfterClaimLosses, (BigInt(margin.replace('.', '')) - 14000n).toString().replace(/^(-?\d+)(\d{2})$/, '$1.$2'));
      assert.deepEqual(all.byCity.map((c) => [c.cityId, c.total]), [[cityA, '90.00']].sort(([a], [b]) => a - b));
    });

    await t.test('a surplus of withheld insurance is shown, never counted as a gain', async () => {
      await db.query(`UPDATE payment_dashboard SET insurance_deduction = 90 WHERE insurance_deduction = 30`);
      const { data, warnings } = await claimLosses(db, { period, cityIds: [cityB], asOf });
      assert.equal(data.insurance.difference, '-10.00', '110.00 withheld against a 100.00 premium');
      assert.equal(data.insurance.notRecovered, '0.00');
      assert.match(warnings.join(' '), /more insurance withheld than the carrier charged/);
    });

    await t.test('periods and cities stay separate, an unknown city is refused, and an empty period is zero not missing', async () => {
      const empty = await claimLosses(db, { period: parseRange({ start_date: '2095-01-01', end_date: '2095-01-31' }), cityIds: null, asOf });
      assert.equal(empty.data.claimLosses.total, '0.00');
      assert.equal(empty.data.margin.profitAfterClaimLosses, null, 'no delivery margin in that period: not shown as zero');
      assert.match(empty.warnings.join(' '), /no delivery margin/);
      await assert.rejects(claimLosses(db, { period, cityIds: [2147483000], asOf }), /Unknown city_id/);
    });

    await t.test('reading the report changes nothing', async () => {
      const snapshot = async () => JSON.stringify(await one('SELECT (SELECT count(*) FROM courier_claims) c, (SELECT count(*) FROM courier_claim_matches) m, (SELECT count(*) FROM pay_statement_lines) l, (SELECT count(*) FROM carrier_statement_items) i'));
      const before = await snapshot();
      await claimLosses(db, { period, cityIds: null, asOf });
      assert.equal(await snapshot(), before);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await owner.end();
  }
});
