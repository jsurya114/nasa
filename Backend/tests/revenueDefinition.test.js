import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRange } from '../services/reporting/inputs.js';
import { businessSummary, rankCities } from '../services/reporting/deliveryReports.js';
import { deliveryTrends } from '../services/reporting/trendReports.js';
import { trendSeries } from '../services/insights/trendSeries.js';
import { AdminDashboardQueries } from '../services/admin/dashboardQueries.js';
import { publishStatement } from '../services/finance/gofoStatement/publishStatement.js';
import { voidStatement } from '../services/finance/gofoStatement/statementStore.js';
import { statementSheets, statementWorkbook } from './helpers/gofoStatementFixture.js';

// One revenue and margin definition for every report (issue #252). Needs a PostgreSQL copy that has the app's tables, the carrier statement migration and both
// reporting migrations (never production). Run with PAYROLL_TEST_DB=1 and the usual DB_* variables. One transaction, always rolled back. All values are made up.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const dir = (name) => fileURLToPath(new URL(`../migrations/${name}`, import.meta.url));
const ID_A = '90000301';
const ID_B = '90000302';

const nestedPool = (client) => {
  let depth = 0;
  return {
    connect: async () => ({
      query: (sql, params) => {
        if (sql === 'BEGIN') { depth += 1; return client.query(`SAVEPOINT s${depth}`); }
        if (sql === 'COMMIT') { const name = `s${depth}`; depth -= 1; return client.query(`RELEASE SAVEPOINT ${name}`); }
        if (sql === 'ROLLBACK') { const name = `s${depth}`; depth -= 1; return client.query(`ROLLBACK TO SAVEPOINT ${name}`).then(() => client.query(`RELEASE SAVEPOINT ${name}`)); }
        return client.query(sql, params);
      },
      release: () => {},
    }),
  };
};

test('delivery revenue, driver earnings and margin use one definition in every report, and the Dashboard totals agree', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const client = await pool.connect();
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(dir('2026-11-08-issue-252-carrier-statements.sql'), 'utf8'));
    await client.query(readFileSync(dir('2026-11-08-issue-252-reporting-statement-revenue.sql'), 'utf8'));
    await client.query(readFileSync(dir('2026-11-08-issue-252-reporting-statement-revenue.sql'), 'utf8')); // safe to run twice

    const weeklyCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Revenue GOFO', 'TST GOFO', 'WEEKLY') RETURNING id")).id;
    const dailyCity = (await one("INSERT INTO city (job, city_code, city_type) VALUES ('Test Revenue SpeedX', 'TSD SPX', 'DAILY') RETURNING id")).id;
    const route = async (job, code) => (await one(
      'INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string) VALUES ($1, $2, 5, 3, 2.5, 1.5, $3) RETURNING id',
      [`Test ${code}`, job, code])).id;
    const routeA = await route('Test Revenue GOFO', 'TS01-001');
    const routeB = await route('Test Revenue GOFO', 'TS01-002');
    const routeD = await route('Test Revenue SpeedX', 'TSD-001');
    const driver = async (name, code, cityId) => (await one("INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES ('x', $1, $2, $3, $4) RETURNING id", [name, `${name.replace(/\s+/g, '.')}@example.test`, code, cityId])).id;
    const driverA = await driver('Revenue Test One', Number(ID_A), weeklyCity);
    const driverB = await driver('Revenue Test Two', Number(ID_B), weeklyCity);
    const driverD = await driver('Revenue Test Three', 90000303, dailyCity);
    // A stored delivery record with the amounts exactly as stored.
    const row = async ({ driverId, routeId, day, pay, margin, seq = 0, delivered = 2, insurance = '0' }) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages, delivered, closed, paid) VALUES ($1,$2,$3,$4,$5,$6,$6,true,false) RETURNING id',
        [driverId, routeId, day, seq, seq ? seq + 9 : 0, delivered])).id;
      return (await one('UPDATE payment_dashboard SET delivered = $2, driver_payment = $3, company_earnings = $4, insurance_deduction = $5 WHERE dashboard_data_id = $1 RETURNING id', [dd, delivered, pay, margin, insurance])).id;
    };
    await row({ driverId: driverA, routeId: routeA, day: '2026-10-19', pay: '3.00', margin: '1.00', insurance: '1.92' }); // would have been 4.00 by the old price fields
    await row({ driverId: driverB, routeId: routeB, day: '2026-10-20', pay: '1.50', margin: '0.50' });                    // would have been 2.00
    await row({ driverId: driverD, routeId: routeD, day: '2026-10-21', pay: '16.00', margin: '4.00', seq: 100, delivered: 10 }); // daily SpeedX: unchanged
    await row({ driverId: driverB, routeId: routeA, day: '2026-10-23', pay: '2.00', margin: '1.00' });                    // weekly work the carrier did not bill

    const period = parseRange({ start_date: '2026-10-19', end_date: '2026-10-25' });
    const city = [weeklyCity];
    const summary = async (cityIds = city, source = null) => (await businessSummary(client, { period, cityIds, source })).data;
    const money = (value) => (value === null ? null : Number(value).toFixed(2));

    await t.test('before any statement the weekly figures are the old price-based ones, labelled ESTIMATED', async () => {
      const data = await summary();
      assert.deepEqual([data.deliveryRevenue, data.driverEarnings, data.deliveryMargin], ['9.00', '6.50', '2.50']);
      assert.deepEqual([data.revenueBasis, data.revenueIsEstimated, data.recordsByBasis.estimated], ['estimated', true, 3]);
      assert.equal(data.unallocatedRevenue, null);
      assert.equal(data.settlement, null, 'no statement, no settlement');
      assert.equal(data.earnedDeliveryRevenue, data.deliveryRevenue, 'the older field names carry the same numbers');
      assert.match((await businessSummary(client, { period, cityIds: city })).warnings.join(' '), /ESTIMATES from the route price fields/);
    });

    await t.test('daily SpeedX keeps its stored company figures and is never called an estimate', async () => {
      const data = await summary([dailyCity]);
      assert.deepEqual([data.deliveryRevenue, data.driverEarnings, data.deliveryMargin, data.revenueBasis, data.revenueIsEstimated], ['20.00', '16.00', '4.00', 'recorded', false]);
    });

    const db = nestedPool(client);
    const file = await statementWorkbook(statementSheets({ idA: ID_A, idB: ID_B }));
    let published;
    await t.test('a verified statement makes the weekly revenue what the carrier billed; work the carrier did not bill has no revenue', async () => {
      published = await publishStatement(db, file, { user: { id: 1 }, sourceLabel: 'revenue test.xlsx' });
      assert.equal(published.status, 'published');
      const data = await summary();
      // The carrier billed 2.61 for A on the 19th and 2.30 for B on the 20th = 4.91. NASA recorded 3.00 + 1.50 + 2.00 of driver earnings.
      assert.deepEqual([data.deliveryRevenue, data.driverEarnings, data.deliveryMargin], ['4.91', '6.50', '-1.59']);
      assert.deepEqual([data.revenueBasis, data.revenueIsEstimated, data.unallocatedRevenue], ['statement', false, null]);
      assert.equal(data.driverEarningsAfterInsurance, '4.58', 'net of the 1.92 insurance only; claim recoveries and advances stay in Payroll');
      assert.deepEqual(data.settlement, {
        statements: 1, deliveryRevenue: '4.91', carrierClaims: '-0.70', ledgerAdjustments: '-2.00', payable: '2.21',
        basis: 'By billing week (a statement is counted in the period that holds the last day of its billing week). Prepayments and withdrawal fees are not included.',
      });
      const shortPeriod = parseRange({ start_date: '2026-10-19', end_date: '2026-10-21' });
      assert.equal((await businessSummary(client, { period: shortPeriod, cityIds: city })).data.settlement, null, 'settlement is by billing week, not by signing day');
    });

    await t.test('every report shows the same numbers: summary, ranking and both trend implementations', async () => {
      const ranking = (await rankCities(client, { period, rankBy: 'revenue', limit: 10, cityIds: city })).data.ranking[0];
      assert.deepEqual([ranking.deliveryRevenue, ranking.driverEarnings, ranking.deliveryMargin, ranking.revenueIsEstimated], ['4.91', '6.50', '-1.59', false]);
      for (const trend of [await trendSeries(client, { period, cityIds: city, interval: 'week' }), await deliveryTrends(client, { period, cityIds: city, interval: 'week' })]) {
        const point = (trend.data.series.find((p) => p.hasRecords !== false && p.deliveryRevenue !== null));
        assert.deepEqual([point.deliveryRevenue, point.deliveryMargin], ['4.91', '-1.59']);
      }
      const byDay = await trendSeries(client, { period, cityIds: city, interval: 'day' });
      const days = Object.fromEntries(byDay.data.series.filter((p) => p.deliveryRevenue !== null).map((p) => [p.bucketStart, p.deliveryRevenue]));
      assert.deepEqual(days, { '2026-10-19': '2.61', '2026-10-20': '2.30', '2026-10-23': '0.00' }, 'revenue stays on the carrier\'s signing day');
    });

    await t.test('the Dashboard totals read the same definition, and only for the owner', async () => {
      const owner = await AdminDashboardQueries.getSummaryData({ job: 'Test Revenue GOFO', startDate: '2026-10-19', endDate: '2026-10-25' }, 1, 'superadmin', client);
      assert.deepEqual([owner.total_delivery_revenue, owner.total_driver_earnings, owner.total_delivery_margin, owner.revenue_is_estimated], ['4.91', '6.50', '-1.59', false]);
      const admin = (await one("INSERT INTO admin (password, name, email, role) VALUES ('x', 'Revenue Test Admin', 'revenue.admin@example.test', 'admin') RETURNING id")).id;
      await client.query('INSERT INTO admin_city_ref (admin_id, city_id) VALUES ($1, $2)', [admin, weeklyCity]);
      const cityAdmin = await AdminDashboardQueries.getSummaryData({ job: 'Test Revenue GOFO', startDate: '2026-10-19', endDate: '2026-10-25' }, admin, 'admin', client);
      for (const key of Object.keys(cityAdmin)) assert.equal(/company|revenue|margin|estimated|unallocated/.test(key), false, `a city admin does not get ${key}`);
      assert.equal(cityAdmin.total_driver_payment, '6.50', 'the pay figures a city admin already had are unchanged');
    });

    await t.test('carrier money that matches no NASA record is kept as unallocated revenue of its city, with no driver', async () => {
      await voidStatement(client, published.statementId, { actorId: 1, reason: 'test: republish without the second driver\'s work' });
      // The second driver's work for the 20th is no longer in the week (moved out of it), so the carrier's 2.30 for that day matches nothing.
      await client.query("UPDATE payment_dashboard SET journey_date = '2026-09-01' WHERE driver_id = $1 AND journey_date = '2026-10-20'", [driverB]);
      const again = await publishStatement(db, file, { user: { id: 1 }, sourceLabel: 'revenue test 2.xlsx' });
      assert.equal(again.status, 'published');
      assert.equal(again.matching.unallocatedRevenue, '2.30');
      const data = await summary();
      assert.deepEqual([data.deliveryRevenue, data.unallocatedRevenue], ['4.91', '2.30'], 'unallocated revenue is part of revenue and shown apart');
      assert.deepEqual([data.driverEarnings, data.deliveryMargin], ['5.00', '-0.09'], 'it adds no driver earnings and no deliveries');
      assert.match((await businessSummary(client, { period, cityIds: city })).warnings.join(' '), /matched no NASA record/);
      assert.equal((await summary(city, 'daily')).unallocatedRevenue, null, 'a daily-only question has none');
      const ranking = (await rankCities(client, { period, rankBy: 'revenue', limit: 10, cityIds: city })).data.ranking[0];
      assert.deepEqual([ranking.deliveryRevenue, ranking.unallocatedRevenue], ['4.91', '2.30']);
      const trendDays = await trendSeries(client, { period, cityIds: city, interval: 'day' });
      assert.equal(trendDays.data.series.find((p) => p.bucketStart === '2026-10-20').unallocatedRevenue, '2.30');
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
