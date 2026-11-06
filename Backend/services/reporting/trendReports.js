/**
 * Trends and driver rankings (issue #220). Same rules as deliveryReports.js: the Dashboard's delivery records, stored business
 * dates, the record's route city, the Dashboard's city rule, stored amounts, missing amounts left out of money and disclosed.
 */
import { InputError, addDays, centsToText, toCents } from './inputs.js';

const FACTS = 'reporting.delivery_facts f';
const SCOPE = 'f.business_date BETWEEN $1::date AND $2::date AND f.counts_for_city AND ($3::int[] IS NULL OR f.city_id = ANY($3::int[]))';
const MONEY = 'numeric(16,2)';
export const INTERVALS = Object.freeze(['day', 'week', 'month']);
export const MAX_DAY_BUCKETS = 366;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const lastDayOfMonth = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const bucketEnd = (interval, start) => (interval === 'day' ? start : interval === 'week' ? addDays(start, 6) : lastDayOfMonth(start));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const hundredths = (numerator, denominator) => (denominator > 0n ? centsToText((numerator * 200n + denominator) / (denominator * 2n)) : null);

export async function deliveryTrends(db, { period, cityIds, interval }) {
  if (!INTERVALS.includes(interval)) throw new InputError(`interval must be one of: ${INTERVALS.join(', ')}`);
  if (interval === 'day' && period.days > MAX_DAY_BUCKETS) throw new InputError(`A daily trend can cover at most ${MAX_DAY_BUCKETS} days; use interval week or month for longer periods.`);
  if (cityIds !== null) {
    const { rows } = await db.query('SELECT city_id FROM reporting.cities WHERE city_id = ANY($1::int[])', [cityIds]);
    const known = new Set(rows.map((r) => r.city_id));
    const unknown = cityIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new InputError(`Unknown city_id: ${unknown.join(', ')}. Use list_reporting_cities to see the valid ones.`);
  }
  const params = [period.startDate, period.endDate, cityIds];
  const { rows: series } = await db.query(
    `SELECT to_char(date_trunc($4::text, f.business_date)::date, 'YYYY-MM-DD') AS bucket_start,
            (COALESCE(sum(f.delivered), 0))::bigint AS deliveries,
            (count(*))::int AS records,
            (count(*) FILTER (WHERE f.amounts_complete))::int AS records_with_amounts,
            (count(DISTINCT f.business_date))::int AS days_with_records,
            (count(DISTINCT f.driver_id) FILTER (WHERE f.delivered > 0))::int AS active_drivers,
            (COALESCE(sum(f.gross_driver_earnings) FILTER (WHERE f.amounts_complete), 0))::${MONEY} AS driver_earnings,
            (COALESCE(sum(f.company_margin) FILTER (WHERE f.amounts_complete), 0))::${MONEY} AS margin
       FROM ${FACTS} WHERE ${SCOPE}
      GROUP BY 1 ORDER BY 1`,
    [...params, interval]
  );
  const { rows: weekdayRows } = await db.query(
    `SELECT (extract(isodow FROM f.business_date))::int AS dow, (COALESCE(sum(f.delivered), 0))::bigint AS deliveries, (count(DISTINCT f.business_date))::int AS days
       FROM ${FACTS} WHERE ${SCOPE} GROUP BY 1`, params);
  const { rows: peakRows } = await db.query(
    `SELECT to_char(f.business_date, 'YYYY-MM-DD') AS d, (extract(isodow FROM f.business_date))::int AS dow, (COALESCE(sum(f.delivered), 0))::bigint AS deliveries
       FROM ${FACTS} WHERE ${SCOPE} GROUP BY f.business_date ORDER BY 3 DESC, 1 ASC LIMIT 5`, params);
  const { rows: bounds } = await db.query(
    `SELECT to_char(min(f.business_date), 'YYYY-MM-DD') AS first_date, to_char(max(f.business_date), 'YYYY-MM-DD') AS last_date
       FROM ${FACTS} WHERE f.counts_for_city AND ($1::int[] IS NULL OR f.city_id = ANY($1::int[]))`, [cityIds]);
  const { firstDate, lastDate } = { firstDate: bounds[0].first_date, lastDate: bounds[0].last_date };

  const points = series.map((r) => {
    const start = r.bucket_start;
    const end = bucketEnd(interval, start);
    const from = start < period.startDate ? period.startDate : start;
    const to = end > period.endDate ? period.endDate : end;
    const withAmounts = r.records_with_amounts > 0;
    const driver = toCents(r.driver_earnings);
    const margin = toCents(r.margin);
    return {
      bucketStart: start, bucketEnd: end,
      deliveries: Number(r.deliveries),
      earnedDeliveryRevenue: withAmounts ? centsToText(driver + margin) : null,
      grossMarginBeforeOverheads: withAmounts ? centsToText(margin) : null,
      activeDrivers: r.active_drivers,
      recordsWithoutStoredAmounts: r.records - r.records_with_amounts,
      daysWithRecords: r.days_with_records,
      daysInBucketWithinPeriod: daysBetween(from, to),
      partialBucket: start < period.startDate || end > period.endDate,
    };
  });

  const weekdays = WEEKDAYS.map((name, i) => {
    const row = weekdayRows.find((r) => r.dow === i + 1);
    const total = row ? BigInt(row.deliveries) : 0n;
    const days = row ? row.days : 0;
    return { weekday: name, totalDeliveries: Number(total), daysWithRecords: days, averageDeliveriesPerDayWithRecords: days > 0 ? hundredths(total, BigInt(days)) : null };
  });
  const ranked = [...weekdays].filter((w) => w.daysWithRecords > 0)
    .sort((a, b) => Number(b.averageDeliveriesPerDayWithRecords) - Number(a.averageDeliveriesPerDayWithRecords) || WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday));
  ranked.forEach((w, i) => { w.rank = i + 1; });
  weekdays.forEach((w) => { if (w.rank === undefined) w.rank = null; });

  const warnings = [];
  if (series.length === 0) {
    warnings.push('There are no delivery records in this period for the selected cities.');
  } else {
    if (lastDate && period.endDate > lastDate) warnings.push(`Delivery data for these cities ends on ${lastDate}; later days are missing, not zero.`);
    if (firstDate && period.startDate < firstDate) warnings.push(`Delivery data for these cities starts on ${firstDate}; earlier days are missing, not zero.`);
    const missing = period.days - points.reduce((n, p) => n + p.daysWithRecords, 0); // buckets split the dates, so this is the days with no records
    if (missing > 0) warnings.push(`${missing} day${missing === 1 ? '' : 's'} in the period have no delivery records (non-working days or not yet imported); they are not counted as zero-delivery days.`);
    const partial = points.filter((p) => p.partialBucket).length;
    if (partial > 0) warnings.push(`${partial} ${interval}${partial === 1 ? '' : 's'} at the edge of the period ${partial === 1 ? 'is' : 'are'} only partly inside it (partialBucket); compare them with care.`);
    const open = points.reduce((n, p) => n + p.recordsWithoutStoredAmounts, 0);
    if (open > 0) warnings.push(`${open} record${open === 1 ? ' has' : 's have'} no stored amounts yet: revenue and margin leave them out, deliveries include them.`);
    warnings.push('Weekday averages are over days that have records, so a weekday NASA does not work shows no average rather than zero.');
  }
  return {
    data: {
      period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
      interval,
      cities: cityIds ?? 'all',
      series: points,
      weekdays,
      busiestWeekday: ranked[0]?.weekday ?? null,
      peakDates: peakRows.map((r) => ({ date: r.d, weekday: WEEKDAYS[r.dow - 1], deliveries: Number(r.deliveries) })),
    },
    scope: { description: `Delivery records dated ${period.startDate} to ${period.endDate} by ${interval}, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}.`, startDate: period.startDate, endDate: period.endDate },
    coverage: [{ source: 'Dashboard delivery records (daily and weekly)', firstDate, lastDate, buckets: points.length }],
    warnings,
  };
}

const DRIVER_ORDER = { deliveries: 'p.deliveries DESC', deliveries_per_active_day: 'p.per_day DESC' };

export async function rankDrivers(db, { period, cityIds, rankBy, limit, minActiveDays }) {
  const order = DRIVER_ORDER[rankBy];
  if (!order) throw new InputError('rank_by must be deliveries or deliveries_per_active_day');
  const { rows } = await db.query(
    `WITH per_driver AS (
       SELECT f.driver_id, f.driver_name,
              (COALESCE(sum(f.delivered), 0))::bigint AS deliveries,
              (count(DISTINCT f.business_date) FILTER (WHERE f.delivered > 0))::int AS active_days,
              (count(DISTINCT f.city_id))::int AS cities_worked
         FROM ${FACTS} WHERE ${SCOPE}
        GROUP BY f.driver_id, f.driver_name
     ), main_city AS (
       SELECT DISTINCT ON (x.driver_id) x.driver_id, x.city_id, x.city_name
         FROM (SELECT f.driver_id, f.city_id, f.city_name, sum(f.delivered) AS d FROM ${FACTS} WHERE ${SCOPE} GROUP BY f.driver_id, f.city_id, f.city_name) x
        ORDER BY x.driver_id, x.d DESC, x.city_id ASC
     ), eligible AS (
       SELECT d.*, CASE WHEN d.active_days > 0 THEN round(d.deliveries::numeric / d.active_days, 2) END AS per_day
         FROM per_driver d WHERE d.active_days >= $4
     ), totals AS (
       SELECT (SELECT COALESCE(sum(deliveries), 0) FROM per_driver) AS all_deliveries,
              (SELECT count(*) FROM per_driver)::int AS drivers_with_records,
              (SELECT count(*) FROM eligible)::int AS drivers_ranked
     )
     SELECT p.driver_id, p.driver_name, p.deliveries, p.active_days, p.cities_worked, p.per_day::text AS per_day_text,
            m.city_id, m.city_name, t.all_deliveries, t.drivers_with_records, t.drivers_ranked
       FROM eligible p JOIN main_city m ON m.driver_id = p.driver_id CROSS JOIN totals t
      ORDER BY ${order} NULLS LAST, p.driver_id ASC
      LIMIT $5`,
    [period.startDate, period.endDate, cityIds, minActiveDays, limit]
  );
  const first = rows[0];
  const total = first ? BigInt(first.all_deliveries) : 0n;
  const ranking = rows.map((r, i) => ({
    rank: i + 1,
    driverId: r.driver_id,
    name: r.driver_name,
    primaryCity: { cityId: r.city_id, name: r.city_name },
    citiesWorked: r.cities_worked,
    deliveries: Number(r.deliveries),
    activeDays: r.active_days,
    deliveriesPerActiveDay: r.per_day_text,
    shareOfAllDeliveriesPercent: total > 0n ? centsToText((BigInt(r.deliveries) * 20000n + total) / (total * 2n)) : null,
  }));
  const warnings = [];
  if (ranking.length === 0) warnings.push('No driver has records that meet the conditions in this period.');
  if (first && first.drivers_ranked > ranking.length) warnings.push(`Showing the top ${ranking.length} of ${first.drivers_ranked} drivers; shares are of all deliveries by drivers with records.`);
  if (rankBy === 'deliveries_per_active_day') warnings.push(`Drivers need at least ${minActiveDays} active days to be ranked by deliveries per active day, so one big day does not decide the ranking.`);
  if (minActiveDays > 1 && first && first.drivers_with_records > first.drivers_ranked) warnings.push(`${first.drivers_with_records - first.drivers_ranked} driver(s) are left out because they have fewer than ${minActiveDays} active days.`);
  warnings.push('A driver who worked in more than one city is shown in the city where they delivered most; deliveries count wherever they were recorded. Ties are broken by driver id.');
  return {
    data: {
      period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
      rankedBy: rankBy,
      cities: cityIds ?? 'all',
      minActiveDays,
      ranking,
      driversWithRecords: first ? first.drivers_with_records : 0,
    },
    scope: { description: `Drivers ranked by ${rankBy.replaceAll('_', ' ')}, delivery records dated ${period.startDate} to ${period.endDate}, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}.`, startDate: period.startDate, endDate: period.endDate },
    coverage: [{ source: 'Dashboard delivery records (daily and weekly)', driversWithRecords: first ? first.drivers_with_records : 0 }],
    warnings,
  };
}
