/**
 * Delivery forecast (issue #220). A transparent statistical estimate, not a promise, with no other model and no AI service.
 *
 * Method: for each weekday, the average (or last value) of the same weekday in recent complete weeks. Three candidates are
 * compared by BACKTESTING: for each of the last weeks, forecast it using only the weeks before it (no future data), and score
 * the forecast against what happened. The candidate with the smallest error is used. The 80% range comes from the relative errors
 * seen in that backtest, and is only given when there are enough backtest points.
 *
 * Incomplete imports are told apart from real quiet days: a week with far fewer days of records than usual (a partly imported
 * week) is left out of training and backtesting instead of being treated as a drop in deliveries. A day with no records at all
 * is "no data", never a measured zero. When history or coverage cannot support a useful forecast the answer is insufficient_data.
 *
 * `forecastFromSeries` is pure (no database), so every rule here is tested with made-up series.
 */
import { InputError, addDays, parseBusinessDate } from './inputs.js';

export const MAX_FORECAST_DAYS = 28;
export const MAX_START_GAP_DAYS = 56;
const MIN_COMPLETE_WEEKS = 10;
const MAX_TEST_WEEKS = 8;
const MIN_TEST_WEEKS = 4;
const MIN_TRAIN_WEEKS = 4;
const MIN_BACKTEST_POINTS_FOR_RANGE = 20;
const INTERVAL_LEVEL = 80;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const isoDow = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
const weekStartOf = (iso) => addDays(iso, -isoDow(iso));
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (sorted, q) => {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const round2 = (n) => Math.round(n * 100) / 100;

// Candidate methods: what to predict for `date` from the observations in earlier complete weeks.
// `obs` maps date -> deliveries, only for complete weeks before the date's own week.
export const METHODS = Object.freeze([
  { name: 'weekday_average_4_weeks', description: 'Average of the same weekday in the last 4 complete weeks that have records', weeks: 4, mode: 'mean' },
  { name: 'weekday_average_8_weeks', description: 'Average of the same weekday in the last 8 complete weeks that have records', weeks: 8, mode: 'mean' },
  { name: 'same_weekday_last_week', description: 'The same weekday in the most recent complete week that has a record', weeks: 1, mode: 'last' },
]);

export function predict(method, weekdayIndex, targetWeekStart, byWeekday) {
  // byWeekday[dow] = [{ weekStart, value }] sorted by week
  const earlier = byWeekday[weekdayIndex].filter((o) => o.weekStart < targetWeekStart).slice(-method.weeks);
  if (earlier.length === 0) return null;
  const values = earlier.map((o) => o.value);
  return method.mode === 'last' ? values[values.length - 1] : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * @param {{date: string, value: number}[]} series  one point per date that has records (deliveries for all chosen cities)
 * @param {{days: number, startDate?: string|null, today?: string|null}} options
 */
export function forecastFromSeries(series, { days, startDate = null, today = null }) {
  const warnings = [];
  const insufficient = (reason, extra = {}) => ({ status: 'insufficient_data', estimate: true, reason, forecast: [], warnings, ...extra });
  if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) throw new InputError(`days must be a whole number from 1 to ${MAX_FORECAST_DAYS}`);
  if (series.length === 0) return insufficient('There are no delivery records for these cities.');

  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const dataEndsOn = sorted[sorted.length - 1].date;
  const dataStartsOn = sorted[0].date;

  // Group the observed days into ISO weeks (Monday first).
  const weeks = new Map();
  for (const p of sorted) {
    const key = weekStartOf(p.date);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(p);
  }
  const weekKeys = [...weeks.keys()].sort();
  const counts = weekKeys.map((k) => weeks.get(k).length);
  const typical = median(counts.slice(0, Math.max(1, counts.length - 1))); // usual number of days with records in a week
  const excluded = [];
  const usable = [];
  weekKeys.forEach((key, i) => {
    const isLast = i === weekKeys.length - 1;
    const n = counts[i];
    if (isLast && n < typical * 0.8) excluded.push({ weekStart: key, daysWithRecords: n, reason: 'the latest week has far fewer days of records than usual, so it looks only partly imported' });
    else if (!isLast && n < typical * 0.5) excluded.push({ weekStart: key, daysWithRecords: n, reason: 'a week with far fewer days of records than usual, so it looks like a gap or a partial import' });
    else usable.push(key);
  });
  if (excluded.length > 0) warnings.push(`${excluded.length} week(s) with unusually few days of records were left out of training and testing (${excluded.map((e) => e.weekStart).join(', ')}): a gap in imports is not a fall in deliveries.`);

  if (usable.length < MIN_COMPLETE_WEEKS) {
    return insufficient(`Only ${usable.length} complete week(s) of delivery records are available; at least ${MIN_COMPLETE_WEEKS} are needed for a forecast that can be tested.`, { dataEndsOn, excludedWeeks: excluded });
  }

  const byWeekday = Array.from({ length: 7 }, () => []);
  for (const key of usable) for (const p of weeks.get(key)) byWeekday[isoDow(p.date)].push({ weekStart: key, value: p.value, date: p.date });
  byWeekday.forEach((list) => list.sort((a, b) => (a.date < b.date ? -1 : 1)));

  // Backtest: the last test weeks, each predicted from the weeks before it only.
  const testWeeks = usable.slice(-Math.min(MAX_TEST_WEEKS, usable.length - MIN_TRAIN_WEEKS));
  if (testWeeks.length < MIN_TEST_WEEKS) return insufficient('There is not enough history to test the forecast on past weeks.', { dataEndsOn, excludedWeeks: excluded });
  const scored = METHODS.map((method) => {
    const points = [];
    for (const weekStart of testWeeks) {
      for (const p of weeks.get(weekStart)) {
        const f = predict(method, isoDow(p.date), weekStart, byWeekday);
        if (f !== null) points.push({ date: p.date, weekStart, actual: p.value, forecast: f });
      }
    }
    const absError = points.reduce((n, x) => n + Math.abs(x.actual - x.forecast), 0);
    const actualSum = points.reduce((n, x) => n + x.actual, 0);
    return { method, points, wape: actualSum > 0 ? absError / actualSum : null };
  }).filter((s) => s.points.length > 0 && s.wape !== null);
  if (scored.length === 0) return insufficient('The forecast could not be tested on past weeks.', { dataEndsOn, excludedWeeks: excluded });
  scored.sort((a, b) => a.wape - b.wape);
  const best = scored[0];
  const bias = best.points.reduce((n, x) => n + (x.forecast - x.actual), 0) / best.points.reduce((n, x) => n + x.actual, 0);

  // Where the forecast starts: the Monday after the last usable week (so a partly imported latest week is forecast, not trusted).
  const lastUsable = usable[usable.length - 1];
  const defaultStart = addDays(lastUsable, 7);
  let start = defaultStart;
  if (startDate) {
    parseBusinessDate(startDate, 'start_date');
    if (startDate < defaultStart) throw new InputError(`start_date must be ${defaultStart} or later: that is the first day after the last complete week of data (data ends on ${dataEndsOn}).`);
    if (startDate > addDays(defaultStart, MAX_START_GAP_DAYS)) throw new InputError(`start_date is too far after the data. The latest complete week ends ${addDays(lastUsable, 6)}; ask for a start within ${MAX_START_GAP_DAYS} days of ${defaultStart}.`);
    start = startDate;
  }
  if (today && addDays(defaultStart, 14) < today) warnings.push(`The delivery data ends on ${dataEndsOn}, which is well before today (${today}). The forecast assumes the recent weekday pattern continues across the gap; it does not know what happened since.`);

  // Prediction range: relative errors seen in the backtest. Only given with enough points.
  const relative = best.points.filter((x) => x.forecast > 0).map((x) => (x.actual - x.forecast) / x.forecast).sort((a, b) => a - b);
  const haveRange = relative.length >= MIN_BACKTEST_POINTS_FOR_RANGE;
  const lowRel = haveRange ? quantile(relative, (100 - INTERVAL_LEVEL) / 200) : null;
  const highRel = haveRange ? quantile(relative, 1 - (100 - INTERVAL_LEVEL) / 200) : null;
  const inside = haveRange ? best.points.filter((x) => x.forecast > 0 && (x.actual - x.forecast) / x.forecast >= lowRel && (x.actual - x.forecast) / x.forecast <= highRel).length / best.points.filter((x) => x.forecast > 0).length : null;
  if (!haveRange) warnings.push('There are too few backtest points to give a prediction range, so only point estimates are shown.');

  const forecast = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const dow = isoDow(date);
    const recentWeeks = byWeekday[dow].filter((o) => o.weekStart >= usable[Math.max(0, usable.length - 8)]);
    const value = recentWeeks.length === 0 ? null : predict(best.method, dow, '9999-12-31', byWeekday); // every usable week is earlier
    if (value === null) {
      forecast.push({ date, weekday: WEEKDAYS[dow], estimate: null, low: null, high: null, note: 'No deliveries were recorded on this weekday in the last 8 complete weeks, so no estimate is made (it is not forecast as zero).' });
    } else {
      forecast.push({
        date, weekday: WEEKDAYS[dow], estimate: Math.round(value),
        low: haveRange ? Math.max(0, Math.round(value * (1 + lowRel))) : null,
        high: haveRange ? Math.max(0, Math.round(value * (1 + highRel))) : null,
        note: null,
      });
    }
  }

  // Weekly totals seen in the backtest give a plain range for the whole horizon (only for a full 7 days or more).
  const weekErrors = testWeeks.map((weekStart) => {
    const pts = best.points.filter((x) => x.weekStart === weekStart);
    const f = pts.reduce((n, x) => n + x.forecast, 0);
    const a = pts.reduce((n, x) => n + x.actual, 0);
    return f > 0 ? (a - f) / f : null;
  }).filter((x) => x !== null);
  const estimates = forecast.filter((d) => d.estimate !== null);
  const total = estimates.reduce((n, d) => n + d.estimate, 0);
  const totalRange = days >= 7 && weekErrors.length >= MIN_TEST_WEEKS
    ? { low: Math.round(total * (1 + Math.min(...weekErrors))), high: Math.round(total * (1 + Math.max(...weekErrors))), basis: `The lowest and highest weekly errors seen in ${weekErrors.length} backtested weeks. A range from past errors, not a guarantee.` }
    : null;

  warnings.push('This is an estimate from past weekday patterns. It does not know about holidays, weather, new contracts or route changes, and the real result can fall outside the range.');
  return {
    status: 'ok',
    estimate: true,
    method: { name: best.method.name, description: best.method.description, candidates: scored.map((s) => ({ name: s.method.name, wape: round2(s.wape * 100) })) },
    trainingPeriod: { startDate: weekKeys.find((k) => usable.includes(k)), endDate: addDays(lastUsable, 6), completeWeeks: usable.length, daysWithRecords: usable.reduce((n, k) => n + weeks.get(k).length, 0) },
    dataStartsOn, dataEndsOn,
    excludedWeeks: excluded,
    forecast,
    total: { estimate: total, daysEstimated: estimates.length, range: totalRange },
    backtest: {
      testWeeks: testWeeks.length,
      observations: best.points.length,
      weightedAbsolutePercentError: round2(best.wape * 100),
      biasPercent: round2(bias * 100),
      naiveWeightedAbsolutePercentError: round2((scored.find((s) => s.method.name === 'same_weekday_last_week')?.wape ?? best.wape) * 100),
      rangeLevelPercent: haveRange ? INTERVAL_LEVEL : null,
      shareOfBacktestInsideRange: inside === null ? null : round2(inside * 100),
    },
    warnings,
  };
}

// Reads the daily totals (all chosen cities together, by the Dashboard's rules) and forecasts from them.
export async function forecastDeliveries(db, { cityIds, days, startDate, today }) {
  if (cityIds !== null) {
    const { rows } = await db.query('SELECT city_id FROM reporting.cities WHERE city_id = ANY($1::int[])', [cityIds]);
    const known = new Set(rows.map((r) => r.city_id));
    const unknown = cityIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new InputError(`Unknown city_id: ${unknown.join(', ')}. Use list_reporting_cities to see the valid ones.`);
  }
  const { rows } = await db.query(
    `WITH bounds AS (SELECT max(f.business_date) AS last_date FROM reporting.delivery_facts f WHERE f.counts_for_city AND ($1::int[] IS NULL OR f.city_id = ANY($1::int[])))
     SELECT to_char(f.business_date, 'YYYY-MM-DD') AS date, (COALESCE(sum(f.delivered), 0))::bigint AS value
       FROM reporting.delivery_facts f, bounds b
      WHERE f.counts_for_city AND ($1::int[] IS NULL OR f.city_id = ANY($1::int[])) AND f.business_date > b.last_date - 400
      GROUP BY f.business_date ORDER BY f.business_date`,
    [cityIds]
  );
  const { warnings, ...result } = forecastFromSeries(rows.map((r) => ({ date: r.date, value: Number(r.value) })), { days, startDate, today });
  return {
    data: { cities: cityIds ?? 'all', horizonDays: days, ...result },
    scope: { description: `Estimated deliveries for ${days} day(s), ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}, from past delivery records. An estimate.` },
    coverage: [{ source: 'Dashboard delivery records (daily and weekly), last 400 days', daysWithRecords: rows.length, firstDate: rows[0]?.date ?? null, lastDate: rows[rows.length - 1]?.date ?? null }],
    warnings,
  };
}
