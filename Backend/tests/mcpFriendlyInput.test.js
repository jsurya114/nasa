import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, parseMinActiveDays } from '../services/reporting/inputs.js';
import { peakDatesFrom, weekdayProfile } from '../services/reporting/trendReports.js';
import { forecastDeliveriesTool, getBusinessSummaryTool, rankCitiesTool, rankDriversTool } from '../services/mcp/tools/deliveryTools.js';

// ---------- busiest weekday and peak dates when nothing was delivered ----------
const row = (dow, deliveries, days) => ({ dow, deliveries, days });

test('records with no completed delivery give no busiest weekday and no peak date', () => {
  const { weekdays, busiestWeekday } = weekdayProfile([row(4, 0, 1)]);
  assert.equal(busiestWeekday, null);
  assert.ok(weekdays.every((w) => w.rank === null), 'nobody is ranked when every total is zero');
  const thursday = weekdays.find((w) => w.weekday === 'Thursday');
  assert.deepEqual([thursday.totalDeliveries, thursday.daysWithRecords, thursday.averageDeliveriesPerDayWithRecords], [0, 1, '0.00'], 'the day with records is still reported');
  assert.deepEqual(peakDatesFrom([{ d: '2026-11-05', dow: 4, deliveries: '0' }]), []);
});

test('with real deliveries the busiest weekday and peak dates are unchanged', () => {
  const { weekdays, busiestWeekday } = weekdayProfile([row(1, 300, 2), row(5, 500, 2), row(6, 0, 1)]);
  assert.equal(busiestWeekday, 'Friday');
  assert.deepEqual(weekdays.filter((w) => w.rank !== null).sort((a, b) => a.rank - b.rank).map((w) => [w.weekday, w.rank]), [['Friday', 1], ['Monday', 2], ['Saturday', 3]]);
  assert.equal(weekdays.find((w) => w.weekday === 'Tuesday').rank, null, 'no records: no rank');
  assert.deepEqual(
    peakDatesFrom([{ d: '2026-10-30', dow: 5, deliveries: '21253' }, { d: '2026-10-31', dow: 6, deliveries: '0' }]),
    [{ date: '2026-10-30', weekday: 'Friday', deliveries: 21253 }],
    'a day with no completed delivery is not a peak'
  );
});

// ---------- numeric limits are explained by the tool, not rejected by the schema ----------
const sample = { start_date: '2026-10-01', end_date: '2026-10-31' };

test('out-of-range numbers pass the schema so the tool can explain them', () => {
  const cases = [
    [rankCitiesTool, { ...sample, rank_by: 'revenue', limit: 500 }],
    [rankDriversTool, { ...sample, limit: 500 }],
    [rankDriversTool, { ...sample, min_active_days: 99 }],
    [forecastDeliveriesTool, { days: 60 }],
    [getBusinessSummaryTool, { ...sample, city_ids: Array.from({ length: 51 }, (_, i) => i + 1) }],
  ];
  for (const [tool, args] of cases) assert.equal(tool.inputSchema.safeParse(args).success, true, `${tool.name} ${JSON.stringify(args).slice(0, 60)}`);
});

test('wrong types and unknown arguments are still refused by the schema', () => {
  assert.equal(rankCitiesTool.inputSchema.safeParse({ ...sample, rank_by: 'profit' }).success, false);
  assert.equal(rankCitiesTool.inputSchema.safeParse({ ...sample, rank_by: 'revenue', sql: 'select 1' }).success, false);
  assert.equal(rankDriversTool.inputSchema.safeParse({ ...sample, limit: 'ten' }).success, false);
});

test('the tool descriptions still tell Claude the allowed ranges', () => {
  const described = (tool, key) => tool.inputSchema.shape[key].description;
  assert.match(described(rankCitiesTool, 'limit'), /1 to 50/);
  assert.match(described(rankDriversTool, 'limit'), /1 to 50/);
  assert.match(described(rankDriversTool, 'min_active_days'), /1 to 31/);
  assert.match(described(forecastDeliveriesTool, 'days'), /1 to 28/);
  assert.match(described(getBusinessSummaryTool, 'city_ids'), /at most 50/);
});

test('min_active_days is checked with a plain message', () => {
  assert.equal(parseMinActiveDays(undefined, 3), 3);
  assert.equal(parseMinActiveDays(1, 3), 1);
  assert.equal(parseMinActiveDays(31, 3), 31);
  for (const bad of [0, 32, 99, 2.5, -1]) assert.throws(() => parseMinActiveDays(bad, 3), (e) => e instanceof InputError && /min_active_days must be a whole number from 1 to 31/.test(e.message));
});
