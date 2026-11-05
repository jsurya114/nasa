/**
 * Delivery, revenue and margin reports (issue #220). Plain functions: `(db, filters) -> result`, where `db` has `query(sql, params)`
 * (the restricted reporting connection, or a test transaction). They only SELECT from the `reporting` views.
 *
 * What is counted (docs/INSIGHTS_MCP.md section 6):
 *  - every Dashboard delivery record (daily and weekly), by the stored business date and the city of the record's ROUTE;
 *  - the Dashboard's own city rule: a DAILY city counts records with sequence numbers, a WEEKLY city those without (reporting.counts_for_city);
 *  - deliveries = the stored delivered counts. One record is an aggregate, never "one order";
 *  - revenue = stored gross driver earnings + stored company margin, from the SAME records. A record without stored amounts yet
 *    (still open, or half filled) is counted and disclosed but contributes no revenue or margin: missing is not zero;
 *  - gross margin = stored company margin, "gross profit before overheads", never net profit.
 * Each fact is aggregated once, in one pass over the view, so no join can multiply a total.
 */
import { InputError, addDays, centsToText, percentChange, toCents } from './inputs.js';

const MONEY = 'numeric(16,2)';
const FACTS = 'reporting.delivery_facts f';

// Shared WHERE for one period, an optional city list and an optional source. Parameters: $1 start, $2 end, $3 city ids (or null),
// $4 source ('daily', 'weekly' or null for both).
const SCOPE = 'f.business_date BETWEEN $1::date AND $2::date AND f.counts_for_city AND ($3::int[] IS NULL OR f.city_id = ANY($3::int[])) AND ($4::text IS NULL OR f.source = $4::text)';

const num = (value) => (value === null || value === undefined ? null : Number(value));

export async function listReportingCities(db) {
  const { rows } = await db.query(
    `SELECT c.city_id, c.city_name, c.city_code, c.city_type, c.enabled,
            to_char(min(f.business_date) FILTER (WHERE f.counts_for_city), 'YYYY-MM-DD') AS first_date,
            to_char(max(f.business_date) FILTER (WHERE f.counts_for_city), 'YYYY-MM-DD') AS last_date,
            (count(f.fact_id) FILTER (WHERE f.counts_for_city))::int AS records
       FROM reporting.cities c
       LEFT JOIN ${FACTS} ON f.city_id = c.city_id
      GROUP BY c.city_id, c.city_name, c.city_code, c.city_type, c.enabled
      ORDER BY c.city_name, c.city_id`
  );
  const cities = rows.map((r) => ({
    cityId: r.city_id, name: r.city_name, code: r.city_code, type: r.city_type, enabled: r.enabled,
    firstDeliveryDate: r.first_date, lastDeliveryDate: r.last_date, records: r.records,
  }));
  const dates = cities.flatMap((c) => [c.firstDeliveryDate, c.lastDeliveryDate]).filter(Boolean).sort();
  const warnings = [];
  if (cities.length === 0) warnings.push('No cities are set up.');
  return {
    data: { cities },
    scope: { description: 'All cities (the owner is a super admin).' },
    coverage: [{ source: 'Dashboard delivery records', firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null, records: cities.reduce((n, c) => n + c.records, 0) }],
    warnings,
  };
}

// Throws an InputError that names the unknown ids, so a wrong city is never silently ignored.
async function assertCitiesExist(db, cityIds) {
  if (cityIds === null) return;
  const { rows } = await db.query('SELECT city_id FROM reporting.cities WHERE city_id = ANY($1::int[])', [cityIds]);
  const known = new Set(rows.map((r) => r.city_id));
  const unknown = cityIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new InputError(`Unknown city_id: ${unknown.join(', ')}. Use list_reporting_cities to see the valid ones.`);
}

// One pass over the period's records.
async function aggregatePeriod(db, { startDate, endDate }, cityIds, source = null) {
  const { rows } = await db.query(
    `SELECT (COALESCE(sum(f.delivered), 0))::bigint                                            AS deliveries,
            (count(*))::int                                                                     AS records,
            (count(*) FILTER (WHERE f.amounts_complete))::int                                   AS records_with_amounts,
            (count(*) FILTER (WHERE NOT f.amounts_complete AND NOT f.amounts_partial))::int     AS records_open,
            (count(*) FILTER (WHERE f.amounts_partial))::int                                    AS records_partial,
            (count(*) FILTER (WHERE f.source = 'daily'))::int                                   AS daily_records,
            (count(*) FILTER (WHERE f.source = 'weekly'))::int                                  AS weekly_records,
            (COALESCE(sum(f.delivered) FILTER (WHERE f.amounts_complete), 0))::bigint           AS deliveries_with_amounts,
            (COALESCE(sum(f.gross_driver_earnings) FILTER (WHERE f.amounts_complete), 0))::${MONEY} AS driver_earnings,
            (COALESCE(sum(f.company_margin) FILTER (WHERE f.amounts_complete), 0))::${MONEY}    AS margin,
            (count(DISTINCT f.driver_id) FILTER (WHERE f.delivered > 0))::int                   AS active_drivers,
            (count(DISTINCT (f.driver_id, f.business_date)) FILTER (WHERE f.delivered > 0))::int AS active_driver_days,
            (count(DISTINCT f.business_date))::int                                              AS days_with_records
       FROM ${FACTS} WHERE ${SCOPE}`,
    [startDate, endDate, cityIds, source]
  );
  const r = rows[0];
  const withAmounts = r.records_with_amounts > 0;
  const driverCents = toCents(r.driver_earnings);
  const marginCents = toCents(r.margin);
  const revenueCents = withAmounts ? driverCents + marginCents : null;
  const deliveries = BigInt(r.deliveries);
  const activeDays = BigInt(r.active_driver_days);
  const financialDeliveries = BigInt(r.deliveries_with_amounts);
  // Divisions are done on exact integers (cents), rounded half up to cents / hundredths.
  const ratio = (numerator, denominator, scale) => {
    if (numerator === null || denominator <= 0n) return null;
    const scaled = numerator * scale;
    return (scaled * 2n + denominator) / (denominator * 2n);
  };
  return {
    raw: r,
    deliveries: Number(deliveries),
    revenueCents,
    marginCents: withAmounts ? marginCents : null,
    driverCents: withAmounts ? driverCents : null,
    revenueText: centsToText(revenueCents),
    marginText: centsToText(withAmounts ? marginCents : null),
    driverText: centsToText(withAmounts ? driverCents : null),
    marginPercentage: revenueCents !== null && revenueCents > 0n ? centsToText(ratio(marginCents * 10000n, revenueCents, 1n)) : null,
    revenuePerDelivery: centsToText(withAmounts ? ratio(revenueCents, financialDeliveries, 1n) : null),
    marginPerDelivery: centsToText(withAmounts ? ratio(marginCents, financialDeliveries, 1n) : null),
    deliveriesPerActiveDriverDay: activeDays > 0n ? centsToText(ratio(deliveries, activeDays, 100n)) : null,
  };
}

async function coverageOf(db, { startDate, endDate }, cityIds, source = null) {
  const { rows } = await db.query(
    `SELECT to_char(min(f.business_date), 'YYYY-MM-DD') AS first_date, to_char(max(f.business_date), 'YYYY-MM-DD') AS last_date,
            (SELECT (count(*))::int FROM ${FACTS} WHERE f.business_date BETWEEN $1::date AND $2::date AND NOT f.counts_for_city
                AND ($3::int[] IS NULL OR f.city_id = ANY($3::int[])) AND ($4::text IS NULL OR f.source = $4::text)) AS excluded
       FROM ${FACTS} WHERE f.counts_for_city AND ($3::int[] IS NULL OR f.city_id = ANY($3::int[])) AND ($4::text IS NULL OR f.source = $4::text)`,
    [startDate, endDate, cityIds, source]
  );
  return { firstDate: rows[0].first_date, lastDate: rows[0].last_date, excludedByCityRule: rows[0].excluded };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function warningsFor(period, agg, coverage) {
  const r = agg.raw;
  const warnings = [];
  if (r.records === 0) {
    warnings.push('There are no delivery records in this period for the selected cities. Nothing here is zero because of a measurement: there is simply no data.');
    if (coverage.lastDate && period.endDate > coverage.lastDate) warnings.push(`The latest delivery record is dated ${coverage.lastDate}.`);
    return warnings;
  }
  if (coverage.lastDate && period.endDate > coverage.lastDate) warnings.push(`Delivery data for these cities ends on ${coverage.lastDate}; the days after it are missing, not zero.`);
  if (coverage.firstDate && period.startDate < coverage.firstDate) warnings.push(`Delivery data for these cities starts on ${coverage.firstDate}; the days before it are missing, not zero.`);
  const missingDays = period.days - r.days_with_records;
  if (missingDays > 0) warnings.push(`${plural(missingDays, 'day has', 'days have')} no delivery records in this period (they may be non-working days or not yet imported).`);
  if (r.records_open > 0) warnings.push(`${plural(r.records_open, 'record is', 'records are')} still open with no stored amounts, so revenue and margin leave ${r.records_open === 1 ? 'it' : 'them'} out. Their delivery counts are included in deliveries.`);
  if (r.records_partial > 0) warnings.push(`${plural(r.records_partial, 'record has', 'records have')} only one of driver earnings and margin stored, so revenue and margin leave ${r.records_partial === 1 ? 'it' : 'them'} out.`);
  if (coverage.excludedByCityRule > 0) warnings.push(`${plural(coverage.excludedByCityRule, 'record is', 'records are')} left out because ${coverage.excludedByCityRule === 1 ? 'its' : 'their'} sequence numbers do not match the city type, the same rule the Dashboard applies when a city is selected.`);
  if (r.records_with_amounts === 0) warnings.push('No record in this period has stored amounts, so revenue and margin are not available.');
  return warnings;
}

function summaryData(period, cityIds, agg) {
  const r = agg.raw;
  return {
    period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
    cities: cityIds ?? 'all',
    deliveries: agg.deliveries,
    earnedDeliveryRevenue: agg.revenueText,
    grossDriverEarnings: agg.driverText,
    grossMarginBeforeOverheads: agg.marginText,
    marginPercentage: agg.marginPercentage,
    activeDrivers: r.active_drivers,
    activeDriverDays: r.active_driver_days,
    deliveriesPerActiveDriverDay: agg.deliveriesPerActiveDriverDay,
    revenuePerDelivery: agg.revenuePerDelivery,
    marginPerDelivery: agg.marginPerDelivery,
    records: {
      total: r.records, withStoredAmounts: r.records_with_amounts, open: r.records_open, partialAmounts: r.records_partial,
      daily: r.daily_records, weekly: r.weekly_records,
    },
  };
}

function compare(current, previous) {
  const diff = (a, b) => (a === null || b === null ? null : centsToText(a - b));
  const change = (cur, prev) => ({ absolute: diff(cur, prev), percent: percentChange(cur, prev) });
  return {
    deliveries: { absolute: String(current.deliveries - previous.deliveries), percent: percentChange(BigInt(current.deliveries) * 100n, BigInt(previous.deliveries) * 100n) },
    earnedDeliveryRevenue: change(current.revenueCents, previous.revenueCents),
    grossMarginBeforeOverheads: change(current.marginCents, previous.marginCents),
  };
}

export async function businessSummary(db, { period, cityIds, comparePrevious = false, source = null }) {
  await assertCitiesExist(db, cityIds);
  const [agg, coverage] = [await aggregatePeriod(db, period, cityIds, source), await coverageOf(db, period, cityIds, source)];
  const data = summaryData(period, cityIds, agg);
  const warnings = warningsFor(period, agg, coverage);

  if (comparePrevious) {
    const previousEnd = addDays(period.startDate, -1);
    const previousStart = addDays(previousEnd, -(period.days - 1));
    const previousPeriod = { startDate: previousStart, endDate: previousEnd, days: period.days };
    const previousAgg = await aggregatePeriod(db, previousPeriod, cityIds, source);
    const incomplete = coverage.firstDate === null || previousStart < coverage.firstDate;
    const noPrevious = previousAgg.raw.records === 0;
    data.comparison = {
      status: noPrevious ? 'insufficient_data' : incomplete ? 'incomplete' : 'complete',
      previousPeriod: { startDate: previousStart, endDate: previousEnd, days: period.days },
      previous: { deliveries: previousAgg.deliveries, earnedDeliveryRevenue: previousAgg.revenueText, grossMarginBeforeOverheads: previousAgg.marginText },
      change: noPrevious ? null : compare(agg, previousAgg),
      note: noPrevious
        ? 'There is no delivery data in the previous equal-length period, so no change is shown.'
        : incomplete
          ? `Delivery data starts on ${coverage.firstDate}, so the previous period (${previousStart} to ${previousEnd}) is only partly covered: the change is not like for like.`
          : 'Compared with the immediately preceding period of the same length.',
    };
    if (data.comparison.status !== 'complete') warnings.push(`Comparison: ${data.comparison.note}`);
  }

  return {
    data,
    scope: { description: `Delivery records dated ${period.startDate} to ${period.endDate}, ${cityIds ? `cities ${cityIds.join(', ')}` : 'all cities'}${source ? `, ${source} records only` : ''}.`, startDate: period.startDate, endDate: period.endDate },
    coverage: [{
      source: 'Dashboard delivery records (daily and weekly)',
      firstDate: coverage.firstDate, lastDate: coverage.lastDate,
      recordsInPeriod: agg.raw.records, daysWithRecords: agg.raw.days_with_records, daysInPeriod: period.days,
    }],
    warnings,
  };
}

// The SQL column each ranking metric sorts by. Only these are ever put into the query text; the caller's word is never used.
const RANK_COLUMN = { deliveries: 'deliveries', revenue: 'revenue', gross_margin: 'margin' };

export async function rankCities(db, { period, rankBy, limit, cityIds = null, source = null }) {
  const column = RANK_COLUMN[rankBy];
  if (!column) throw new InputError('rank_by is not supported');
  await assertCitiesExist(db, cityIds);
  const { rows } = await db.query(
    `WITH per_city AS (
       SELECT f.city_id, f.city_name, f.city_code,
              (COALESCE(sum(f.delivered), 0))::bigint AS deliveries,
              (count(*))::int AS records,
              (count(*) FILTER (WHERE f.amounts_complete))::int AS records_with_amounts,
              (count(*) FILTER (WHERE NOT f.amounts_complete))::int AS records_without_amounts,
              CASE WHEN count(*) FILTER (WHERE f.amounts_complete) > 0
                   THEN (sum(f.gross_driver_earnings) FILTER (WHERE f.amounts_complete) + sum(f.company_margin) FILTER (WHERE f.amounts_complete))::${MONEY} END AS revenue,
              CASE WHEN count(*) FILTER (WHERE f.amounts_complete) > 0
                   THEN (sum(f.company_margin) FILTER (WHERE f.amounts_complete))::${MONEY} END AS margin
         FROM ${FACTS}
        WHERE f.business_date BETWEEN $1::date AND $2::date AND f.counts_for_city
          AND ($4::int[] IS NULL OR f.city_id = ANY($4::int[])) AND ($5::text IS NULL OR f.source = $5::text)
        GROUP BY f.city_id, f.city_name, f.city_code
     ), totals AS (
       SELECT sum(deliveries) AS t_deliveries, sum(revenue) AS t_revenue, sum(margin) AS t_margin, count(*)::int AS cities_with_data,
              sum(records)::int AS t_records, sum(records_without_amounts)::int AS t_without
         FROM per_city
     )
     SELECT p.*, t.t_deliveries, t.t_revenue, t.t_margin, t.cities_with_data, t.t_records, t.t_without
       FROM per_city p CROSS JOIN totals t
      ORDER BY p.${column} DESC NULLS LAST, p.city_id ASC
      LIMIT $3`,
    [period.startDate, period.endDate, limit, cityIds, source]
  );

  const ranked = rows.map((r, index) => {
    const revenue = toCents(r.revenue);
    const margin = toCents(r.margin);
    const metricValue = { deliveries: BigInt(r.deliveries), revenue, gross_margin: margin }[rankBy];
    const total = { deliveries: BigInt(r.t_deliveries ?? 0), revenue: toCents(r.t_revenue), gross_margin: toCents(r.t_margin) }[rankBy];
    const share = metricValue !== null && total !== null && total > 0n
      ? centsToText(((metricValue * 10000n) * 2n + total) / (total * 2n))
      : null;
    return {
      rank: index + 1,
      cityId: r.city_id, name: r.city_name, code: r.city_code,
      deliveries: Number(r.deliveries),
      earnedDeliveryRevenue: r.revenue,
      grossMarginBeforeOverheads: r.margin,
      marginPercentage: revenue !== null && revenue > 0n ? centsToText(((margin * 10000n) * 2n + revenue) / (revenue * 2n)) : null,
      shareOfTotalPercent: share,
      records: r.records,
      recordsWithoutStoredAmounts: r.records_without_amounts,
    };
  });

  const first = rows[0];
  const warnings = [];
  if (rows.length === 0) warnings.push('There are no delivery records in this period, so no city can be ranked.');
  if (first && first.t_without > 0) warnings.push(`${plural(first.t_without, 'record is', 'records are')} still open or incomplete (no stored amounts): revenue and margin leave them out, deliveries include them. A city with no stored amounts shows revenue and margin as missing, not zero.`);
  if (first && first.cities_with_data > rows.length) warnings.push(`Showing the top ${rows.length} of ${first.cities_with_data} cities with records; the share is of the total across all ${first.cities_with_data}.`);
  return {
    data: {
      period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
      rankedBy: rankBy,
      ranking: ranked,
      totalsAllCities: first
        ? { deliveries: Number(first.t_deliveries), earnedDeliveryRevenue: first.t_revenue, grossMarginBeforeOverheads: first.t_margin, citiesWithData: first.cities_with_data }
        : { deliveries: 0, earnedDeliveryRevenue: null, grossMarginBeforeOverheads: null, citiesWithData: 0 },
    },
    scope: { description: `Cities ranked by ${rankBy.replace('_', ' ')}, delivery records dated ${period.startDate} to ${period.endDate}${cityIds ? `, cities ${cityIds.join(', ')}` : ''}${source ? `, ${source} records only` : ''}.`, startDate: period.startDate, endDate: period.endDate },
    coverage: [{ source: 'Dashboard delivery records (daily and weekly)', recordsInPeriod: first ? first.t_records : 0, citiesWithData: first ? first.cities_with_data : 0, daysInPeriod: period.days }],
    warnings,
  };
}
