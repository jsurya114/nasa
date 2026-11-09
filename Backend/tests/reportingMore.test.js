import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { InputError, addDays, parseRange } from '../services/reporting/inputs.js';
import { forecastFromSeries, MAX_FORECAST_DAYS, METHODS, predict } from '../services/reporting/forecast.js';
import { deliveryTrends, rankDrivers } from '../services/reporting/trendReports.js';
import { claimExposure, paymentOverview } from '../services/reporting/claimPaymentReports.js';
import { businessSummary } from '../services/reporting/deliveryReports.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------- forecast: pure rules on made-up series ----------
const PATTERN = [100, 120, 110, 130, 150, 200]; // Monday to Saturday; Sunday is never worked
const MONDAY = '2026-01-05';
const series = ({ weeks, pattern = PATTERN, skipWeeks = [], partialLastWeek = null, bump = () => 0 }) => {
  const out = [];
  for (let w = 0; w < weeks; w += 1) {
    if (skipWeeks.includes(w)) continue;
    pattern.forEach((v, d) => { out.push({ date: addDays(MONDAY, w * 7 + d), value: v + bump(w, d) }); });
  }
  if (partialLastWeek !== null) {
    const w = weeks;
    PATTERN.slice(0, partialLastWeek).forEach((v, d) => out.push({ date: addDays(MONDAY, w * 7 + d), value: Math.round(v / 3) }));
  }
  return out;
};

test('a steady weekday pattern is forecast exactly, tested on past weeks, with a range and no zero for a day never worked', () => {
  const f = forecastFromSeries(series({ weeks: 20 }), { days: 7 });
  assert.equal(f.status, 'ok');
  assert.equal(f.estimate, true);
  assert.equal(f.forecast[0].date, addDays(MONDAY, 20 * 7), 'starts the Monday after the last complete week');
  assert.deepEqual(f.forecast.slice(0, 6).map((d) => d.estimate), PATTERN);
  assert.deepEqual(f.forecast.slice(0, 6).map((d) => [d.low, d.high]), PATTERN.map((v) => [v, v]), 'no error in the backtest: a zero-width range');
  assert.equal(f.forecast[6].weekday, 'Sunday');
  assert.equal(f.forecast[6].estimate, null, 'no estimate, not a forecast of zero');
  assert.match(f.forecast[6].note, /not forecast as zero/);
  assert.equal(f.total.estimate, 810);
  assert.equal(f.backtest.testWeeks, 8);
  assert.equal(f.backtest.observations, 48);
  assert.equal(f.backtest.weightedAbsolutePercentError, 0);
  assert.equal(f.backtest.rangeLevelPercent, 80);
  assert.equal(f.method.candidates.length, 3);
  assert.deepEqual(f.excludedWeeks, []);
});

test('a partly imported latest week is left out and forecast, not read as a fall in deliveries', () => {
  const f = forecastFromSeries(series({ weeks: 20, partialLastWeek: 2 }), { days: 7 });
  assert.equal(f.status, 'ok');
  assert.equal(f.excludedWeeks.length, 1);
  assert.equal(f.excludedWeeks[0].weekStart, addDays(MONDAY, 20 * 7));
  assert.match(f.excludedWeeks[0].reason, /partly imported/);
  assert.equal(f.forecast[0].date, addDays(MONDAY, 20 * 7), 'the incomplete week itself is what gets forecast');
  assert.deepEqual(f.forecast.slice(0, 6).map((d) => d.estimate), PATTERN, 'the thin week did not drag the estimate down');
  assert.match(f.warnings.join(' '), /gap in imports is not a fall in deliveries/);
  assert.equal(f.dataEndsOn, addDays(MONDAY, 20 * 7 + 1));
});

test('a gap week in the middle is a missing import, not a zero week', () => {
  const f = forecastFromSeries(series({ weeks: 20, skipWeeks: [9, 10] }), { days: 7 });
  assert.equal(f.status, 'ok');
  assert.equal(f.excludedWeeks.length, 0, 'weeks with no records at all are simply absent');
  assert.deepEqual(f.forecast.slice(0, 6).map((d) => d.estimate), PATTERN);
  const thin = series({ weeks: 20 }).filter((p) => !(p.date >= addDays(MONDAY, 9 * 7 + 2) && p.date < addDays(MONDAY, 10 * 7)));
  const g = forecastFromSeries(thin, { days: 7 });
  assert.deepEqual(g.excludedWeeks.map((w) => w.weekStart), [addDays(MONDAY, 9 * 7)], 'a week with only two days of records is a partial import');
});

test('too little or empty history is insufficient_data, with the reason', () => {
  const few = forecastFromSeries(series({ weeks: 6 }), { days: 7 });
  assert.equal(few.status, 'insufficient_data');
  assert.match(few.reason, /at least 10 are needed/);
  assert.deepEqual(few.forecast, []);
  const none = forecastFromSeries([], { days: 7 });
  assert.equal(none.status, 'insufficient_data');
  assert.match(none.reason, /no delivery records/);
});

test('a level shift is followed by the better method, and the backtest never uses the week it scores', () => {
  const shifted = series({ weeks: 24, bump: (w) => (w >= 16 ? 100 : 0) });
  const f = forecastFromSeries(shifted, { days: 6 });
  assert.equal(f.method.name, 'same_weekday_last_week', 'after a step up, last week beats a slower average');
  assert.deepEqual(f.forecast.map((d) => d.estimate), PATTERN.map((v) => v + 100));
  // predict() sees only weeks before the target week.
  const byWeekday = Array.from({ length: 7 }, () => []);
  byWeekday[0] = [{ weekStart: '2026-01-05', value: 10, date: '2026-01-05' }, { weekStart: '2026-01-12', value: 20, date: '2026-01-12' }, { weekStart: '2026-01-19', value: 9999, date: '2026-01-19' }];
  const mean4 = METHODS.find((m) => m.name === 'weekday_average_4_weeks');
  assert.equal(predict(mean4, 0, '2026-01-19', byWeekday), 15, 'the target week itself and later weeks are ignored');
  assert.equal(predict(mean4, 0, '2026-01-05', byWeekday), null, 'nothing earlier: no forecast');
});

test('range of days and start date are validated, never clipped', () => {
  const data = series({ weeks: 20 });
  for (const days of [0, 29, 1.5, -1]) assert.throws(() => forecastFromSeries(data, { days }), InputError, String(days));
  assert.equal(MAX_FORECAST_DAYS, 28);
  const start = addDays(MONDAY, 20 * 7);
  assert.throws(() => forecastFromSeries(data, { days: 7, startDate: addDays(start, -1) }), /must be .* or later/);
  assert.throws(() => forecastFromSeries(data, { days: 7, startDate: addDays(start, 90) }), /too far after the data/);
  assert.throws(() => forecastFromSeries(data, { days: 7, startDate: '2026-13-40' }), InputError);
  const later = forecastFromSeries(data, { days: 3, startDate: addDays(start, 14) });
  assert.equal(later.forecast[0].date, addDays(start, 14));
  const stale = forecastFromSeries(data, { days: 7, today: addDays(start, 100) });
  assert.match(stale.warnings.join(' '), /well before today/);
});

test('a malformed start_date is refused before any data is looked at', () => {
  for (const startDate of ['banana', '2026-13-45', '10/01/2026', '2026-02-30']) {
    assert.throws(() => forecastFromSeries([], { days: 7, startDate }), InputError, startDate);
    assert.throws(() => forecastFromSeries(series({ weeks: 3 }), { days: 7, startDate }), InputError, `${startDate} with too little history`);
  }
});

test('few backtest points give point estimates only, with a warning', () => {
  const f = forecastFromSeries(series({ weeks: 12, pattern: [100, 120] }), { days: 2 });
  assert.equal(f.status, 'ok');
  assert.equal(f.backtest.rangeLevelPercent, null);
  assert.ok(f.forecast.every((d) => d.low === null && d.high === null && d.estimate !== null));
  assert.match(f.warnings.join(' '), /too few backtest points/);
});

// ---------- database: a disposable copy with both reporting migrations (never production) ----------
const hasDb = process.env.MCP_TEST_DB === '1';
const DAY = 86400000;
const weekdayName = (iso) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
const monday = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);

test('trends, driver ranking, claims and payments follow the same rules and add up', { skip: !hasDb && 'set MCP_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pg } = await import('pg');
  const owner = new pg.Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, database: process.env.DB_NAME, password: process.env.DB_PASSWORD });
  const db = await owner.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  try {
    await db.query('BEGIN');
    const tag = randomBytes(3).toString('hex');
    const city = async (name, type) => (await one('INSERT INTO city (job, city_code, city_type) VALUES ($1, $2, $3) RETURNING id', [`Rpm ${name} ${tag}`, `M${name}${tag}`.toUpperCase(), type])).id;
    const cityA = await city('A', 'DAILY');
    const cityB = await city('B', 'WEEKLY');
    const route = async (name, cityId) => (await one(
      `INSERT INTO routes (name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, route_code_in_string)
       SELECT $1, c.job, 2, 1.6, 2, 1.6, $3 FROM city c WHERE c.id = $2 RETURNING id`, [`${name} ${tag}`, cityId, `RM-${name}-${tag}`])).id;
    const routeA = await route('A1', cityA);
    const routeB = await route('B1', cityB);
    let code = 700000000 + Math.floor(Math.random() * 90000000);
    const driver = async (label, cityId) => (await one('INSERT INTO drivers (password, name, email, driver_code, city_id) VALUES (\'x\', $1, $2, $3, $4) RETURNING id', [`Rpm ${label} ${tag}`, `rpm-${label}-${tag}@example.test`, (code += 1), cityId])).id;
    const d1 = await driver('d1', cityA);
    const d2 = await driver('d2', cityA);
    const d3 = await driver('d3', cityB);

    const rows = [];
    const row = async ({ driver: d, route: r, cityId, date, seq, delivered, closed = true, pay = null, margin = null }) => {
      const dd = (await one('INSERT INTO dashboard_data (driver_id, route_id, journey_date, start_seq, end_seq, packages) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [d, r, date, seq || 0, seq ? seq + 9 : 0, delivered])).id;
      await db.query('UPDATE payment_dashboard SET delivered = $2, closed = $3, driver_payment = $4, company_earnings = $5 WHERE dashboard_data_id = $1', [dd, delivered, closed, pay, margin]);
      rows.push({ driver: d, cityId, date, delivered, counted: !(cityId === cityA && !seq), pay, margin, complete: pay !== null && margin !== null });
    };
    // 2090-03-01 is a Wednesday. Period: 2090-03-01 to 2090-03-31.
    await row({ driver: d1, route: routeA, cityId: cityA, date: '2090-03-01', seq: 100, delivered: 10, pay: '16.00', margin: '4.00' });
    await row({ driver: d1, route: routeA, cityId: cityA, date: '2090-03-02', seq: 110, delivered: 20, pay: '32.00', margin: '8.00' });
    await row({ driver: d2, route: routeA, cityId: cityA, date: '2090-03-02', seq: 120, delivered: 5, pay: '8.00', margin: '2.00' });
    await row({ driver: d1, route: routeA, cityId: cityA, date: '2090-03-03', seq: 130, delivered: 4, closed: false });
    await row({ driver: d2, route: routeA, cityId: cityA, date: '2090-03-04', seq: 140, delivered: 6, pay: '9.60', margin: null });
    await row({ driver: d1, route: routeA, cityId: cityA, date: '2090-03-06', seq: 0, delivered: 7, pay: '11.20', margin: '2.80' }); // breaks the city rule: not counted
    await row({ driver: d3, route: routeB, cityId: cityB, date: '2090-03-01', seq: 0, delivered: 100, pay: '250.00', margin: '50.00' });
    await row({ driver: d3, route: routeB, cityId: cityB, date: '2090-03-05', seq: 0, delivered: 50, pay: '125.00', margin: '25.00' });
    await row({ driver: d2, route: routeB, cityId: cityB, date: '2090-03-07', seq: 0, delivered: 30, pay: '75.00', margin: '15.00' }); // d2 also delivers in city B
    await row({ driver: d1, route: routeA, cityId: cityA, date: '2090-03-20', seq: 150, delivered: 40, pay: '64.00', margin: '16.00' });
    const period = parseRange({ start_date: '2090-03-01', end_date: '2090-03-31' });
    const counted = rows.filter((r) => r.counted);

    await t.test('trends: every interval adds up to the summary, edge buckets are flagged, missing days are not zero', async () => {
      const summary = (await businessSummary(db, { period, cityIds: null })).data;
      for (const interval of ['day', 'week', 'month']) {
        const { data, warnings } = await deliveryTrends(db, { period, cityIds: null, interval });
        assert.equal(data.series.reduce((n, p) => n + p.deliveries, 0), summary.deliveries, `${interval}: deliveries add up`);
        const money = (key) => data.series.reduce((n, p) => n + (p[key] === null ? 0n : BigInt(p[key].replace('.', ''))), 0n);
        assert.equal(money('earnedDeliveryRevenue'), BigInt(summary.earnedDeliveryRevenue.replace('.', '')), `${interval}: revenue adds up`);
        assert.equal(money('grossMarginBeforeOverheads'), BigInt(summary.grossMarginBeforeOverheads.replace('.', '')), `${interval}: margin adds up`);
        assert.equal(data.series.reduce((n, p) => n + p.recordsWithoutStoredAmounts, 0), summary.records.total - summary.records.withStoredAmounts);
        assert.ok(data.series.every((p, i, all) => i === 0 || all[i - 1].bucketStart < p.bucketStart), 'in date order');
        assert.match(warnings.join(' '), /not counted as zero-delivery days/);
      }
      const weekly = (await deliveryTrends(db, { period, cityIds: null, interval: 'week' })).data;
      const expected = new Map();
      for (const r of counted) expected.set(monday(r.date), (expected.get(monday(r.date)) ?? 0) + r.delivered);
      assert.deepEqual(weekly.series.map((p) => [p.bucketStart, p.deliveries]), [...expected].sort(([a], [b]) => (a < b ? -1 : 1)), 'independent weekly totals');
      assert.equal(weekly.series[0].bucketStart, '2090-02-27', 'weeks start on Monday');
      assert.equal(weekly.series[0].partialBucket, true, 'the first week starts before the period');
      assert.equal(weekly.series[0].daysInBucketWithinPeriod, 5, 'Wednesday to Sunday');
      const monthly = (await deliveryTrends(db, { period, cityIds: null, interval: 'month' })).data;
      assert.equal(monthly.series.length, 1);
      assert.equal(monthly.series[0].bucketStart, '2090-03-01');
      assert.equal(monthly.series[0].bucketEnd, '2090-03-31');
      assert.equal(monthly.series[0].partialBucket, false);
      const daily = (await deliveryTrends(db, { period, cityIds: null, interval: 'day' })).data;
      assert.deepEqual(daily.series.map((p) => p.bucketStart), ['2090-03-01', '2090-03-02', '2090-03-03', '2090-03-04', '2090-03-05', '2090-03-07', '2090-03-20'], 'only days with records appear');
      assert.equal(daily.series[0].deliveries, 110, '10 in city A and 100 in city B');
    });

    await t.test('weekday profile and peak dates', async () => {
      const { data } = await deliveryTrends(db, { period, cityIds: null, interval: 'week' });
      assert.equal(data.weekdays.length, 7);
      const wednesday = data.weekdays.find((w) => w.weekday === 'Wednesday');
      assert.deepEqual([wednesday.totalDeliveries, wednesday.daysWithRecords, wednesday.averageDeliveriesPerDayWithRecords], [110, 1, '110.00'], 'one Wednesday with records (2090-03-01)');
      const thursday = data.weekdays.find((w) => w.weekday === 'Thursday');
      assert.deepEqual([thursday.totalDeliveries, thursday.averageDeliveriesPerDayWithRecords], [25, '25.00']);
      assert.equal(wednesday.rank, 1, 'the busiest weekday by average per day with records');
      assert.equal(data.weekdays.filter((w) => w.daysWithRecords === 0).every((w) => w.averageDeliveriesPerDayWithRecords === null && w.rank === null), true, 'no records: no average and no rank, not zero');
      assert.equal(data.busiestWeekday, data.weekdays.find((w) => w.rank === 1).weekday);
      assert.deepEqual(data.peakDates.map((p) => [p.date, p.deliveries]), [['2090-03-01', 110], ['2090-03-05', 50], ['2090-03-20', 40], ['2090-03-07', 30], ['2090-03-02', 25]]);
      assert.equal(data.peakDates[0].weekday, weekdayName('2090-03-01'));
      const onlyB = (await deliveryTrends(db, { period, cityIds: [cityB], interval: 'day' })).data;
      assert.equal(onlyB.series.reduce((n, p) => n + p.deliveries, 0), 180);
    });

    await t.test('trend inputs: unknown city, bad interval and an over-long daily range are refused', async () => {
      await assert.rejects(deliveryTrends(db, { period, cityIds: [2147483000], interval: 'day' }), /Unknown city_id/);
      await assert.rejects(deliveryTrends(db, { period, cityIds: null, interval: 'year' }), /interval must be one of/);
      await assert.rejects(deliveryTrends(db, { period: parseRange({ start_date: '2089-01-01', end_date: '2090-03-31' }), cityIds: null, interval: 'day' }), /at most 366 days/);
      assert.ok((await deliveryTrends(db, { period: parseRange({ start_date: '2089-01-01', end_date: '2090-03-31' }), cityIds: null, interval: 'month' })).data.series.length >= 1);
    });

    await t.test('driver ranking: by deliveries and per active day, main city, shares, stable ties', async () => {
      const byDeliveries = (await rankDrivers(db, { period, cityIds: null, rankBy: 'deliveries', limit: 10, minActiveDays: 1 })).data;
      const view = byDeliveries.ranking.map((r) => [r.driverId, r.deliveries, r.activeDays, r.deliveriesPerActiveDay, r.primaryCity.cityId, r.citiesWorked]);
      // d3 150; d2 = 5 + 6 + 30; d1 = 10 + 20 + 4 + 40 (the rule-breaking record is not counted)
      assert.deepEqual(view, [[d3, 150, 2, '75.00', cityB, 1], [d1, 74, 4, '18.50', cityA, 1], [d2, 41, 3, '13.67', cityB, 2]]);
      assert.equal(byDeliveries.ranking[2].primaryCity.cityId, cityB, 'd2 delivered most in city B');
      assert.deepEqual(byDeliveries.ranking.map((r) => r.shareOfAllDeliveriesPercent), ['56.60', '27.92', '15.47']);
      assert.ok(byDeliveries.ranking.every((r) => Object.keys(r).every((k) => !/email|phone|password|code/i.test(k))), 'names and cities only');
      const perDay = (await rankDrivers(db, { period, cityIds: null, rankBy: 'deliveries_per_active_day', limit: 10, minActiveDays: 3 })).data;
      assert.deepEqual(perDay.ranking.map((r) => r.driverId), [d1, d2], 'd3 has only 2 active days: left out of the per-day ranking');
      const limited = await rankDrivers(db, { period, cityIds: null, rankBy: 'deliveries', limit: 1, minActiveDays: 1 });
      assert.equal(limited.data.ranking.length, 1);
      assert.match(limited.warnings.join(' '), /top 1 of 3 drivers/);
      const cityOnly = (await rankDrivers(db, { period, cityIds: [cityA], rankBy: 'deliveries', limit: 10, minActiveDays: 1 })).data;
      assert.deepEqual(cityOnly.ranking.map((r) => [r.driverId, r.deliveries]), [[d1, 74], [d2, 11]], 'within a city, only that city\'s deliveries');
      assert.equal(byDeliveries.ranking.reduce((n, r) => n + r.deliveries, 0), (await businessSummary(db, { period, cityIds: null })).data.deliveries, 'drivers add up to the summary');
    });

    // ---- claims ----
    const admin = (await one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, 'superadmin') RETURNING id", [`Rpm admin ${tag}`, `rpm-${tag}@example.test`])).id;
    let claimNo = 0;
    const claim = async ({ cityId, amount, status, date = '2090-02-10', superseded = false, noMatch = false, claimType = 'Damaged Item', driverId = null }) => {
      claimNo += 1;
      const key = randomBytes(32).toString('hex');
      const c = await one(
        `INSERT INTO courier_claims (courier, claim_key, version, waybill, claim_type, claim_type_key, claim_at, original_charge, deduction_amount, import_city_id, source_file, source_sheet, source_row, superseded_at)
         VALUES ('gofo', $1, 1, $2, $3, lower($3), $4, $5, $6, $7, 'synthetic.xlsx', 'Claims Detail', $8, $9) RETURNING id`,
        [key, `RPM${tag}${claimNo}`, claimType, `${date} 10:00:00`, -amount, amount, cityId, claimNo, superseded ? new Date().toISOString() : null]);
      if (!noMatch) {
        const matched = status === 'chargeable' || status === 'exempt';
        await db.query(
          `INSERT INTO courier_claim_matches (claim_id, status, driver_id, city_id, eligible_deduction, reason, rule_version) VALUES ($1, $2, $3, $4, $5, 'synthetic', 'test')`,
          [c.id, status, matched ? driverId : null, matched ? cityId : null, status === 'chargeable' ? amount : status === 'exempt' ? 0 : null]);
      }
      return c.id;
    };
    const chargeableId = await claim({ cityId: cityA, amount: 40, status: 'chargeable', driverId: d1 });
    await claim({ cityId: cityA, amount: 30, status: 'exempt', driverId: d1, claimType: 'Tracking interruption' });
    await claim({ cityId: cityA, amount: 50, status: 'unresolved', date: '2090-01-05' });
    await claim({ cityId: cityA, amount: 20, status: 'ambiguous', date: '2090-02-20' });
    await claim({ cityId: cityA, amount: 10, status: 'review', date: '2090-02-21' });
    await claim({ cityId: cityA, amount: 5, noMatch: true, date: '2090-02-22' });                       // no decision record: unmatched
    await claim({ cityId: cityA, amount: 999, status: 'chargeable', driverId: d1, superseded: true });  // an older version: not counted
    await claim({ cityId: cityB, amount: 12, status: 'chargeable', driverId: d3, date: '2090-03-02' });

    const payRun = async ({ cityId, status, label }) => (await one(
      `INSERT INTO pay_runs (request_id, city_id, period_start, period_end, data_type, status, created_by, finalized_by, finalized_at, closed_by, closed_at, close_reason)
       VALUES ($1, $2, '2090-02-01', '2090-02-07', 'daily', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [randomUUID(), cityId, status, admin, status === 'finalized' ? admin : null, status === 'finalized' ? new Date().toISOString() : null,
        status === 'voided' || status === 'discarded' ? admin : null, status === 'voided' || status === 'discarded' ? new Date().toISOString() : null, status === 'voided' || status === 'discarded' ? `synthetic ${label}` : null])).id;
    const statement = async (runId, driverId, net, payoutStatus = 'not_submitted', paidAt = null) => (await one(
      `INSERT INTO pay_statements (pay_run_id, driver_id, gross, insurance, reimbursements, claim_deductions, recoveries, net, carried_forward, payout_status, paid_at)
       VALUES ($1, $2, $3, 0, 0, 0, 0, $3, 0, $4, $5) RETURNING id`, [runId, driverId, net, payoutStatus, paidAt])).id;

    const finalized = await payRun({ cityId: cityA, status: 'finalized' });
    const claimStatement = await statement(finalized, d1, '100.00');
    await db.query(`INSERT INTO pay_statement_lines (statement_id, line_type, amount, claim_id) VALUES ($1, 'claim', -25, $2)`, [claimStatement, chargeableId]);
    const draftRun = await payRun({ cityId: cityA, status: 'draft' });
    await statement(draftRun, d2, '70.00');
    const voidedRun = await payRun({ cityId: cityA, status: 'voided', label: 'voided' });
    await statement(voidedRun, d2, '900.00');
    const discardedRun = await payRun({ cityId: cityA, status: 'discarded', label: 'discarded' });
    await statement(discardedRun, d2, '800.00');
    await statement(finalized, d2, '50.00', 'submitted');
    await statement(finalized, d3, '30.00', 'unconfirmed');
    const [e4, e5, e6, e7] = [await driver('e4', cityA), await driver('e5', cityA), await driver('e6', cityA), await driver('e7', cityA)];
    await statement(finalized, e4, '20.00', 'failed');
    await statement(finalized, e5, '40.00', 'paid', new Date(Date.now() - 5 * DAY).toISOString());
    await statement(finalized, e6, '60.00', 'paid', new Date(Date.now() - 60 * DAY).toISOString());
    const returnedStatement = await statement(finalized, e7, '15.00', 'paid', new Date(Date.now() - 2 * DAY).toISOString());
    const hasEveree = (await one("SELECT to_regclass('public.everee_payment_items') AS t")).t !== null;
    if (hasEveree) {
      const batch = await one(`INSERT INTO everee_payment_batches (request_id, pay_run_id, city_id, environment, preview_hash, driver_count, total, created_by) VALUES ($1, $2, $3, 'sandbox', $4, 1, 15, $5) RETURNING id`, [randomUUID(), finalized, cityA, randomBytes(32).toString('hex'), admin]);
      await db.query(`INSERT INTO everee_payment_items (batch_id, pay_statement_id, driver_id, everee_worker_id, external_id, amount, status, deposit_returned) VALUES ($1, $2, $3, 'w-test', $4, 15, 'paid', true)`, [batch.id, returnedStatement, e7, `nasa-stmt-${returnedStatement}`]);
    }

    await t.test('claim exposure counts the current version of each claim by decision and never invents a driver', async () => {
      const { data, warnings } = await claimExposure(db, { period: null, cityIds: [cityA] });
      assert.equal(data.totalClaims, 6, 'the older version is not counted');
      assert.deepEqual(data.chargeable, { claims: 1, amountOwedByDrivers: '40.00', deductedInApprovedPayRuns: '25.00', stillToDeductBeforeRefunds: '15.00' });
      assert.deepEqual(data.exempt, { claims: 1, claimAmountNotCharged: '30.00' });
      assert.equal(data.unmatched.claims, 4);
      assert.equal(data.unmatched.claimAmount, '85.00', '50 + 20 + 10 + 5 (a claim with no decision record is unmatched)');
      assert.equal(data.unmatched.oldestClaimDate, '2090-01-05');
      assert.deepEqual(data.unmatched.byStatus, { unresolved: { claims: 2, claimAmount: '55.00' }, ambiguous: { claims: 1, claimAmount: '20.00' }, review: { claims: 1, claimAmount: '10.00' } });
      assert.match(warnings.join(' '), /4 claims are not matched to a driver yet \(85\.00 USD\)/);
      assert.match(warnings.join(' '), /DFWGOFO \+ Tracking interruption/);
      assert.match(warnings.join(' '), /before any later refund/);
    });

    await t.test('claim filters: by date, by city, and both dates or neither', async () => {
      const feb = (await claimExposure(db, { period: { startDate: '2090-02-15', endDate: '2090-02-28' }, cityIds: [cityA] })).data;
      assert.equal(feb.totalClaims, 3, 'claims dated 20, 21 and 22 February');
      assert.deepEqual([feb.chargeable.claims, feb.exempt.claims, feb.unmatched.claims, feb.unmatched.claimAmount], [0, 0, 3, '35.00']);
      const b = (await claimExposure(db, { period: null, cityIds: [cityB] })).data;
      assert.deepEqual([b.totalClaims, b.chargeable.amountOwedByDrivers, b.chargeable.stillToDeductBeforeRefunds, b.unmatched.claims], [1, '12.00', '12.00', 0]);
      await assert.rejects(claimExposure(db, { period: null, cityIds: [2147483000] }), /Unknown city_id/);
      const empty = await claimExposure(db, { period: { startDate: '2095-01-01', endDate: '2095-01-31' }, cityIds: null });
      assert.equal(empty.data.totalClaims, 0);
      assert.match(empty.warnings.join(' '), /no carrier claims/);
    });

    await t.test('the payment overview separates pending, approved, processing, unconfirmed, failed, returned and paid', async () => {
      const { data, warnings } = await paymentOverview(db, { cityIds: [cityA] });
      assert.deepEqual(data.pendingApproval, { statements: 1, drivers: 1, amount: '70.00' }, 'a draft run is pending approval');
      assert.deepEqual(data.approvedAwaitingPayment, { statements: 1, drivers: 1, amount: '100.00' });
      assert.deepEqual(data.processing, { statements: 1, drivers: 1, amount: '50.00' });
      assert.deepEqual(data.unconfirmed, { statements: 1, drivers: 1, amount: '30.00' });
      assert.deepEqual(data.failed, { statements: 1, drivers: 1, amount: '20.00' });
      if (hasEveree) {
        assert.deepEqual(data.returned, { statements: 1, drivers: 1, amount: '15.00' }, 'a returned deposit is its own bucket');
        assert.deepEqual(data.paid.statements, 2, 'the returned deposit is NOT counted as paid');
        assert.equal(data.paid.amount, '100.00');
      } else {
        assert.deepEqual(data.paid.statements, 3);
      }
      assert.deepEqual(data.paid.paidInLast30Days.statements, hasEveree ? 1 : 2, 'a payment 60 days ago is outside the last 30 days');
      assert.ok(!JSON.stringify(data).includes('900.00') && !JSON.stringify(data).includes('800.00'), 'voided and discarded runs are not payments');
      assert.deepEqual(data.byCity.map((c) => [c.cityId, c.approvedAwaitingPayment, c.processing, c.failed]), [[cityA, '100.00', '80.00', '20.00']], 'processing = submitted + unconfirmed');
      assert.ok(data.needsAttention.every((a) => ['failed', 'unconfirmed', 'returned'].includes(a.state)));
      assert.ok(data.needsAttention.length >= 2);
      assert.match(warnings.join(' '), /unconfirmed.*must be checked before it is retried/);
      assert.match(warnings.join(' '), /Approved is not paid/);
      const all = (await paymentOverview(db, { cityIds: null })).data;
      assert.ok(Number(all.approvedAwaitingPayment.amount) >= 100, 'all cities include this city');
      assert.equal((await paymentOverview(db, { cityIds: [cityB] })).data.approvedAwaitingPayment.statements, 0);
      await assert.rejects(paymentOverview(db, { cityIds: [2147483000] }), /Unknown city_id/);
    });

    await t.test('a payment view built before the Everee tables existed says returned deposits are not visible', async (sub) => {
      if (!hasEveree) return sub.skip('this copy has no Everee tables');
      const visible = await paymentOverview(db, { cityIds: [cityA] });
      assert.equal(visible.data.returnedDepositsVisible, true);
      assert.ok(!visible.warnings.join(' ').includes('NOT visible'));
      // Rebuild the view the way the migration does when the table is missing, inside this rolled-back transaction.
      await db.query('ALTER TABLE everee_payment_items RENAME TO everee_payment_items_hidden_by_test');
      await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-06-issue-220-reporting-claims-payments.sql', import.meta.url)), 'utf8'));
      const blind = await paymentOverview(db, { cityIds: [cityA] });
      assert.equal(blind.data.returnedDepositsVisible, false);
      assert.equal(blind.data.returned.statements, 0);
      assert.match(blind.warnings.join(' '), /Returned deposits are NOT visible.*Re-run the claims-and-payments reporting migration after the Everee migrations/);
      await db.query('ALTER TABLE everee_payment_items_hidden_by_test RENAME TO everee_payment_items');
      await db.query(readFileSync(fileURLToPath(new URL('../migrations/2026-11-06-issue-220-reporting-claims-payments.sql', import.meta.url)), 'utf8'));
      assert.equal((await paymentOverview(db, { cityIds: [cityA] })).data.returnedDepositsVisible, true, 're-running the migration restores it');
    });

    await t.test('reading these reports changes nothing', async () => {
      const snapshot = async () => JSON.stringify(await one('SELECT (SELECT count(*) FROM courier_claims) c, (SELECT count(*) FROM pay_statements) s, (SELECT sum(net) FROM pay_statements) n, (SELECT count(*) FROM pay_runs) r, (SELECT count(*) FROM payment_dashboard) p, (SELECT sum(company_earnings) FROM payment_dashboard) e'));
      const before = await snapshot();
      await claimExposure(db, { period: null, cityIds: null });
      await paymentOverview(db, { cityIds: null });
      await rankDrivers(db, { period, cityIds: null, rankBy: 'deliveries', limit: 5, minActiveDays: 1 });
      await deliveryTrends(db, { period, cityIds: null, interval: 'week' });
      assert.equal(await snapshot(), before);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    db.release();
    await owner.end();
  }
});
