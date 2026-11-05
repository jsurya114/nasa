/**
 * Trends for the Insights page (issue #227): deliveries, earned revenue and gross margin by day, week or month, the weekday pattern and the busiest
 * dates. The same rules as the overview (services/reporting/deliveryReports.js): the Dashboard's delivery records read through reporting.delivery_facts,
 * the stored business date, the city of the record's route, the Dashboard's city rule, stored amounts only. A bucket with no records is NOT zero: its
 * figures are null and `hasRecords` is false, so a chart shows a gap. A record still open has no stored amounts, so its deliveries count and its
 * revenue and margin are left out, and the bucket says so.
 *
 * The output has the same shape as the connector's `get_delivery_trends` (series, weekdays, busiestWeekday, peakDates) so the two can share one
 * implementation later; the only difference is that every bucket of the period is present.
 */
import { InputError, addDays, centsToText, toCents } from '../reporting/inputs.js';

export const INTERVALS = Object.freeze(['day', 'week', 'month']);
export const MAX_DAY_BUCKETS = 366;
const FACTS = 'reporting.delivery_facts f';
// $1 start, $2 end, $3 city ids (or null), $4 source ('daily', 'weekly' or null).
const SCOPE = 'f.business_date BETWEEN $1::date AND $2::date AND f.counts_for_city AND ($3::int[] IS NULL OR f.city_id = ANY($3::int[])) AND ($4::text IS NULL OR f.source = $4::text)';
const WEEKDAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const DAY_MS = 86400000;

const dayMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoDow = (iso) => (new Date(dayMs(iso)).getUTCDay() + 6) % 7; // 0 = Monday
const firstOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const nextMonth = (iso) => { const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY_MS) + 1;

// Where a bucket that contains `date` starts and ends. Weeks run Monday to Sunday, months from the 1st.
export const bucketStartOf = (interval, date) => (interval === 'day' ? date : interval === 'week' ? addDays(date, -isoDow(date)) : firstOfMonth(date));
export const bucketEndOf = (interval, start) => (interval === 'day' ? start : interval === 'week' ? addDays(start, 6) : addDays(nextMonth(start), -1));

// Every bucket that touches the period, in order.
export function bucketStarts(interval, startDate, endDate) {
  const starts = [];
  for (let s = bucketStartOf(interval, startDate); s <= endDate; s = interval === 'day' ? addDays(s, 1) : interval === 'week' ? addDays(s, 7) : nextMonth(s)) starts.push(s);
  return starts;
}

const hundredths = (numerator, denominator) => (denominator > 0n ? centsToText((numerator * 200n + denominator) / (denominator * 2n)) : null);

// The interval for a period, or an InputError saying what to change. Checked before any report runs, and again inside it.
export function parseInterval(interval, period) {
  if (!INTERVALS.includes(interval)) throw new InputError(`interval must be one of: ${INTERVALS.join(', ')}`);
  if (interval === 'day' && period.days > MAX_DAY_BUCKETS) throw new InputError(`A daily trend can cover at most ${MAX_DAY_BUCKETS} days; choose week or month for a longer period.`);
  return interval;
}

export async function trendSeries(db, { period, cityIds = null, source = null, interval }) {
  parseInterval(interval, period);
  if (cityIds !== null) {
    const { rows } = await db.query('SELECT city_id FROM reporting.cities WHERE city_id = ANY($1::int[])', [cityIds]);
    const known = new Set(rows.map((r) => r.city_id));
    const unknown = cityIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new InputError(`Unknown city_id: ${unknown.join(', ')}. Use list_reporting_cities to see the valid ones.`);
  }
  const params = [period.startDate, period.endDate, cityIds, source];
  const { rows: found } = await db.query(
    `SELECT to_char(date_trunc($5::text, f.business_date)::date, 'YYYY-MM-DD') AS bucket_start,
            (COALESCE(sum(f.delivered), 0))::bigint AS deliveries,
            (count(*))::int AS records,
            (count(*) FILTER (WHERE f.amounts_complete))::int AS records_with_amounts,
            (count(DISTINCT f.business_date))::int AS days_with_records,
            (count(DISTINCT f.driver_id) FILTER (WHERE f.delivered > 0))::int AS active_drivers,
            (COALESCE(sum(f.gross_driver_earnings) FILTER (WHERE f.amounts_complete), 0))::numeric(16,2) AS driver_earnings,
            (COALESCE(sum(f.company_margin) FILTER (WHERE f.amounts_complete), 0))::numeric(16,2) AS margin
       FROM ${FACTS} WHERE ${SCOPE} GROUP BY 1`,
    [...params, interval]
  );
  const byStart = new Map(found.map((r) => [r.bucket_start, r]));

  const series = bucketStarts(interval, period.startDate, period.endDate).map((start) => {
    const end = bucketEndOf(interval, start);
    const from = start < period.startDate ? period.startDate : start;
    const to = end > period.endDate ? period.endDate : end;
    const r = byStart.get(start);
    const base = { bucketStart: start, bucketEnd: end, partialBucket: start < period.startDate || end > period.endDate, daysInBucketWithinPeriod: daysBetween(from, to) };
    if (!r) return { ...base, hasRecords: false, deliveries: null, earnedDeliveryRevenue: null, grossDriverEarnings: null, grossMarginBeforeOverheads: null, activeDrivers: null, daysWithRecords: 0, recordsWithoutStoredAmounts: 0 };
    const withAmounts = r.records_with_amounts > 0;
    const driver = toCents(r.driver_earnings);
    const margin = toCents(r.margin);
    return {
      ...base, hasRecords: true,
      deliveries: Number(r.deliveries),
      earnedDeliveryRevenue: withAmounts ? centsToText(driver + margin) : null,
      grossDriverEarnings: withAmounts ? centsToText(driver) : null,
      grossMarginBeforeOverheads: withAmounts ? centsToText(margin) : null,
      activeDrivers: r.active_drivers,
      daysWithRecords: r.days_with_records,
      recordsWithoutStoredAmounts: r.records - r.records_with_amounts,
    };
  });

  const { rows: weekdayRows } = await db.query(
    `SELECT (extract(isodow FROM f.business_date))::int AS dow, (COALESCE(sum(f.delivered), 0))::bigint AS deliveries, (count(DISTINCT f.business_date))::int AS days
       FROM ${FACTS} WHERE ${SCOPE} GROUP BY 1`, params);
  const weekdays = WEEKDAYS.map((name, i) => {
    const row = weekdayRows.find((r) => r.dow === i + 1);
    const total = row ? BigInt(row.deliveries) : 0n;
    const days = row ? row.days : 0;
    return { weekday: name, totalDeliveries: Number(total), daysWithRecords: days, averageDeliveriesPerDayWithRecords: days > 0 ? hundredths(total, BigInt(days)) : null };
  });
  const ranked = weekdays.filter((w) => w.daysWithRecords > 0)
    .sort((a, b) => Number(b.averageDeliveriesPerDayWithRecords) - Number(a.averageDeliveriesPerDayWithRecords) || WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday));
  ranked.forEach((w, i) => { w.rank = i + 1; });
  weekdays.forEach((w) => { if (w.rank === undefined) w.rank = null; });

  const { rows: peakRows } = await db.query(
    `SELECT to_char(f.business_date, 'YYYY-MM-DD') AS d, (extract(isodow FROM f.business_date))::int AS dow, (COALESCE(sum(f.delivered), 0))::bigint AS deliveries
       FROM ${FACTS} WHERE ${SCOPE} GROUP BY f.business_date ORDER BY 3 DESC, 1 ASC LIMIT 5`, params);
  const { rows: bounds } = await db.query(
    `SELECT to_char(min(f.business_date), 'YYYY-MM-DD') AS first_date, to_char(max(f.business_date), 'YYYY-MM-DD') AS last_date
       FROM ${FACTS} WHERE f.counts_for_city AND ($1::int[] IS NULL OR f.city_id = ANY($1::int[])) AND ($2::text IS NULL OR f.source = $2::text)`, [cityIds, source]);
  const { first_date: firstDate, last_date: lastDate } = bounds[0];

  const withRecords = series.filter((p) => p.hasRecords);
  const warnings = [];
  if (withRecords.length === 0) {
    warnings.push('There are no delivery records in this period for these filters.');
  } else {
    if (lastDate && period.endDate > lastDate) warnings.push(`Delivery data for these filters ends on ${lastDate}; later days are missing, not zero.`);
    if (firstDate && period.startDate < firstDate) warnings.push(`Delivery data for these filters starts on ${firstDate}; earlier days are missing, not zero.`);
    const missingDays = period.days - withRecords.reduce((n, p) => n + p.daysWithRecords, 0);
    if (missingDays > 0) warnings.push(`${missingDays} day${missingDays === 1 ? '' : 's'} in the period have no delivery records (non-working days or not yet imported); they are gaps in the charts, not zero-delivery days.`);
    const partial = series.filter((p) => p.partialBucket).length;
    if (partial > 0) warnings.push(`${partial} ${interval}${partial === 1 ? '' : 's'} at the edge of the period ${partial === 1 ? 'is' : 'are'} only partly inside it; compare ${partial === 1 ? 'it' : 'them'} with care.`);
    const open = withRecords.reduce((n, p) => n + p.recordsWithoutStoredAmounts, 0);
    if (open > 0) warnings.push(`${open} record${open === 1 ? ' has' : 's have'} no stored amounts yet: revenue and margin leave ${open === 1 ? 'it' : 'them'} out, deliveries include ${open === 1 ? 'it' : 'them'}.`);
    warnings.push('Weekday averages are over the days that have records, so a weekday NASA does not work shows no average rather than zero.');
  }
  return {
    data: {
      period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
      interval,
      cities: cityIds ?? 'all',
      series,
      weekdays,
      busiestWeekday: ranked[0]?.weekday ?? null,
      peakDates: peakRows.map((r) => ({ date: r.d, weekday: WEEKDAYS[r.dow - 1], deliveries: Number(r.deliveries) })),
    },
    scope: { description: `Delivery records dated ${period.startDate} to ${period.endDate} by ${interval}, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}${source ? `, ${source} records only` : ''}.`, startDate: period.startDate, endDate: period.endDate },
    coverage: [{ source: 'Dashboard delivery records (daily and weekly)', firstDate, lastDate, buckets: series.length, bucketsWithRecords: withRecords.length }],
    warnings,
  };
}
