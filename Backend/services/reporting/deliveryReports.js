/**
 * Delivery, revenue and margin reports (issue #220). Plain functions: `(db, filters) -> result`, where `db` has `query(sql, params)`
 * (the restricted reporting connection, or a test transaction). They only SELECT from the `reporting` views.
 *
 * What is counted (docs/INSIGHTS_MCP.md section 6):
 *  - every Dashboard delivery record (daily and weekly), by the stored business date and the city of the record's ROUTE;
 *  - the Dashboard's own city rule: a DAILY city counts records with sequence numbers, a WEEKLY city those without (reporting.counts_for_city);
 *  - deliveries = the stored delivered counts. One record is an aggregate, never "one order";
 *  - delivery revenue, driver earnings and delivery margin use ONE shared definition (revenueSql.js, issue #252): weekly GOFO revenue is what the
 *    carrier billed (a published statement), daily revenue is the stored company price figure, and a weekly record in a week with no verified
 *    statement keeps the old price-based figure but is labelled "estimated". Carrier money that matched no record is UNALLOCATED revenue of its
 *    city. A record without usable amounts is counted and disclosed but contributes nothing: missing is not zero;
 *  - delivery margin = delivery revenue minus gross driver earnings, "gross profit before overheads", never net profit.
 * Each fact is aggregated once, in one pass over the view, so no join can multiply a total.
 */
import { InputError, addDays, centsToText, percentChange, toCents } from './inputs.js';
import { REVENUE_AGGREGATES, basisCounts, basisOf, settlementFor, unallocatedFor } from './revenueSql.js';
import { invoicePaymentsFor } from './invoiceReports.js';

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

// One pass over the period's records, plus the carrier money that matched none of them.
async function aggregatePeriod(db, { startDate, endDate }, cityIds, source = null) {
  const { rows } = await db.query(
    `SELECT (COALESCE(sum(f.delivered), 0))::bigint                                            AS deliveries,
            (count(*))::int                                                                     AS records,
            (count(*) FILTER (WHERE f.delivery_revenue IS NULL AND NOT f.amounts_partial))::int AS records_open,
            (count(*) FILTER (WHERE f.delivery_revenue IS NULL AND f.amounts_partial))::int     AS records_partial,
            (count(*) FILTER (WHERE f.source = 'daily'))::int                                   AS daily_records,
            (count(*) FILTER (WHERE f.source = 'weekly'))::int                                  AS weekly_records,
            (COALESCE(sum(f.delivered) FILTER (WHERE f.revenue_complete), 0))::bigint           AS deliveries_with_amounts,
            (count(DISTINCT f.driver_id) FILTER (WHERE f.delivered > 0))::int                   AS active_drivers,
            (count(DISTINCT (f.driver_id, f.business_date)) FILTER (WHERE f.delivered > 0))::int AS active_driver_days,
            (count(DISTINCT f.business_date))::int                                              AS days_with_records,
            (COALESCE(sum(f.delivery_revenue) FILTER (WHERE f.revenue_complete), 0))::numeric(16,2) AS revenue_on_complete,
            (COALESCE(sum(f.delivery_margin) FILTER (WHERE f.revenue_complete), 0))::numeric(16,2)  AS margin_on_complete,
            ${REVENUE_AGGREGATES}
       FROM ${FACTS} WHERE ${SCOPE}`,
    [startDate, endDate, cityIds, source]
  );
  const r = rows[0];
  const unallocated = await unallocatedFor(db, { startDate, endDate }, cityIds, source);
  const hasUnallocated = unallocated.groups > 0;
  const known = r.records_with_revenue > 0 || hasUnallocated;
  const withAmounts = r.records_with_amounts > 0;
  const driverCents = toCents(r.driver_earnings);
  const revenueCents = known ? toCents(r.revenue) + unallocated.cents : null;
  const marginCents = known ? toCents(r.margin) + unallocated.cents : null;
  const deliveries = BigInt(r.deliveries);
  const activeDays = BigInt(r.active_driver_days);
  const financialDeliveries = BigInt(r.deliveries_with_amounts);
  // Divisions are done on exact integers (cents), rounded half up to cents / hundredths.
  const ratio = (numerator, denominator, scale) => {
    if (numerator === null || denominator <= 0n) return null;
    const scaled = numerator * scale;
    return (scaled * 2n + denominator) / (denominator * 2n);
  };
  const basis = basisCounts(r, unallocated.groups);
  return {
    raw: r,
    unallocated,
    basis,
    revenueBasis: basisOf({ ...basis, unallocated: unallocated.groups }),
    deliveries: Number(deliveries),
    revenueCents,
    marginCents,
    driverCents: withAmounts ? driverCents : (hasUnallocated ? 0n : null),
    revenueText: centsToText(revenueCents),
    marginText: centsToText(marginCents),
    driverText: centsToText(withAmounts ? driverCents : (hasUnallocated ? 0n : null)),
    unallocatedText: hasUnallocated ? centsToText(unallocated.cents) : null,
    insuranceText: withAmounts ? centsToText(toCents(r.insurance_withheld)) : null,
    marginPercentage: revenueCents !== null && revenueCents > 0n ? centsToText(ratio(marginCents * 10000n, revenueCents, 1n)) : null,
    // Per-delivery figures use only the records that have both a revenue and driver earnings, so unallocated money cannot inflate them.
    revenuePerDelivery: centsToText(withAmounts ? ratio(toCents(r.revenue_on_complete), financialDeliveries, 1n) : null),
    marginPerDelivery: centsToText(withAmounts ? ratio(toCents(r.margin_on_complete), financialDeliveries, 1n) : null),
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
  if (r.records_with_revenue === 0 && agg.unallocated.groups === 0) warnings.push('No record in this period has stored amounts, so revenue and margin are not available.');
  if (r.records_estimated > 0) warnings.push(`${plural(r.records_estimated, 'weekly record is', 'weekly records are')} in a week with no verified carrier statement, so ${r.records_estimated === 1 ? 'its' : 'their'} revenue and margin are ESTIMATES from the route price fields, not what the carrier billed.`);
  if (agg.unallocated.groups > 0) warnings.push(`${plural(agg.unallocated.groups, 'carrier line group', 'carrier line groups')} (${agg.unallocatedText} of revenue) matched no NASA record. ${agg.unallocated.groups === 1 ? 'It is' : 'They are'} kept as unallocated revenue of ${agg.unallocated.statements === 1 ? 'its' : 'their'} city on the carrier's signing day, with no driver and no driver earnings.`);
  if (r.records_without_driver_earnings > 0) warnings.push(`${plural(r.records_without_driver_earnings, 'record covered by a carrier statement has', 'records covered by a carrier statement have')} no driver earnings calculated yet, so the carrier's fee is in revenue but ${r.records_without_driver_earnings === 1 ? 'its' : 'their'} margin is left out until pay is calculated.`);
  return warnings;
}

function summaryData(period, cityIds, agg) {
  const r = agg.raw;
  return {
    period: { startDate: period.startDate, endDate: period.endDate, days: period.days },
    cities: cityIds ?? 'all',
    deliveries: agg.deliveries,
    // The shared definition (revenueSql.js). The first three keep their older names for existing readers of this report.
    earnedDeliveryRevenue: agg.revenueText,
    grossDriverEarnings: agg.driverText,
    grossMarginBeforeOverheads: agg.marginText,
    deliveryRevenue: agg.revenueText,
    driverEarnings: agg.driverText,
    deliveryMargin: agg.marginText,
    unallocatedRevenue: agg.unallocatedText,
    driverEarningsAfterInsurance: agg.driverCents !== null && agg.insuranceText !== null ? centsToText(agg.driverCents - toCents(r.insurance_withheld)) : null,
    revenueBasis: agg.revenueBasis,
    revenueIsEstimated: r.records_estimated > 0,
    recordsByBasis: agg.basis,
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
  data.settlement = await settlementFor(db, period, cityIds);
  // Company-wide and by receipt date, apart from delivery revenue (the same work may already be in it). City and source filters do not apply to it.
  data.invoicePaymentsReceived = await invoicePaymentsFor(db, period);
  if (data.invoicePaymentsReceived) data.invoicePaymentsReceived.filtersApply = !(cityIds || source);

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
    `WITH base AS (
       SELECT f.city_id, f.city_name, f.city_code,
              (COALESCE(sum(f.delivered), 0))::bigint AS deliveries,
              (count(*))::int AS records,
              (count(*) FILTER (WHERE f.delivery_revenue IS NULL))::int AS records_without_amounts,
              ${REVENUE_AGGREGATES}
         FROM ${FACTS}
        WHERE f.business_date BETWEEN $1::date AND $2::date AND f.counts_for_city
          AND ($4::int[] IS NULL OR f.city_id = ANY($4::int[])) AND ($5::text IS NULL OR f.source = $5::text)
        GROUP BY f.city_id, f.city_name, f.city_code
     ), unalloc AS (
       SELECT u.city_id, (sum(u.revenue))::${MONEY} AS revenue, (sum(u.groups))::int AS groups
         FROM reporting.statement_unallocated u
        WHERE u.business_date BETWEEN $1::date AND $2::date AND ($4::int[] IS NULL OR u.city_id = ANY($4::int[])) AND ($5::text IS NULL OR $5::text = 'weekly')
        GROUP BY u.city_id
     ), per_city AS (
       SELECT COALESCE(b.city_id, u.city_id) AS city_id, COALESCE(b.city_name, c.city_name) AS city_name, COALESCE(b.city_code, c.city_code) AS city_code,
              COALESCE(b.deliveries, 0)::bigint AS deliveries, COALESCE(b.records, 0) AS records, COALESCE(b.records_without_amounts, 0) AS records_without_amounts,
              COALESCE(b.records_estimated, 0) AS records_estimated, COALESCE(u.groups, 0) AS unallocated_groups,
              u.revenue AS unallocated_revenue,
              CASE WHEN COALESCE(b.records_with_revenue, 0) > 0 OR u.revenue IS NOT NULL THEN (COALESCE(b.revenue, 0) + COALESCE(u.revenue, 0))::${MONEY} END AS revenue,
              CASE WHEN COALESCE(b.records_with_revenue, 0) > 0 OR u.revenue IS NOT NULL THEN (COALESCE(b.margin, 0) + COALESCE(u.revenue, 0))::${MONEY} END AS margin,
              CASE WHEN COALESCE(b.records_with_amounts, 0) > 0 THEN b.driver_earnings END AS driver_earnings
         FROM base b
         FULL JOIN unalloc u ON u.city_id = b.city_id
         LEFT JOIN reporting.cities c ON c.city_id = COALESCE(b.city_id, u.city_id)
     ), totals AS (
       SELECT sum(deliveries) AS t_deliveries, sum(revenue) AS t_revenue, sum(margin) AS t_margin, count(*)::int AS cities_with_data,
              sum(records)::int AS t_records, sum(records_without_amounts)::int AS t_without, sum(records_estimated)::int AS t_estimated
         FROM per_city
     )
     SELECT p.*, t.t_deliveries, t.t_revenue, t.t_margin, t.cities_with_data, t.t_records, t.t_without, t.t_estimated
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
      deliveryRevenue: r.revenue,
      driverEarnings: r.driver_earnings,
      deliveryMargin: r.margin,
      unallocatedRevenue: r.unallocated_revenue,
      revenueIsEstimated: r.records_estimated > 0,
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
  if (first && first.t_estimated > 0) warnings.push(`${plural(first.t_estimated, 'weekly record is', 'weekly records are')} in a week with no verified carrier statement: ${first.t_estimated === 1 ? 'its' : 'their'} revenue and margin are ESTIMATES from the route price fields, not what the carrier billed (revenueIsEstimated marks the cities).`);
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
