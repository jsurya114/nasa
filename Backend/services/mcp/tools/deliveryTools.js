import * as z from 'zod/v4';
import { MCP_SCOPE } from '../config.js';
import { CURRENCY } from '../../reporting/metricDefinitions.js';
import { parseCityIds, parseLimit, parseRange, parseRankBy } from '../../reporting/inputs.js';
import { businessSummary, listReportingCities, rankCities } from '../../reporting/deliveryReports.js';
import { InputError, parseBusinessDate } from '../../reporting/inputs.js';
import { deliveryTrends, rankDrivers } from '../../reporting/trendReports.js';
import { claimExposure, paymentOverview } from '../../reporting/claimPaymentReports.js';
import { MAX_FORECAST_DAYS, forecastDeliveries } from '../../reporting/forecast.js';

const money = z.string().nullable().describe('Exact decimal USD string, or null when not available');
const percent = z.string().nullable().describe('Percentage with two decimals, or null when it has no meaning');
const period = z.object({ startDate: z.string(), endDate: z.string(), days: z.number().int() });
const change = z.object({ absolute: z.string().nullable(), percent });
const units = { currency: CURRENCY, deliveries: 'count', percentages: 'percent, two decimals', dates: 'business dates, YYYY-MM-DD' };

const basis = z.enum(['statement', 'recorded', 'estimated', 'mixed']).nullable().describe('Where the revenue comes from: the carrier statement, the stored daily figure, an estimate from route prices, or a mix');
const bucketFigures = {
  deliveryRevenue: money, driverEarnings: money, deliveryMargin: money, unallocatedRevenue: money,
  revenueIsEstimated: z.boolean().describe('True when some weekly records have no verified carrier statement and use an estimate'),
};
const dateArg = (name) => z.string().describe(`${name}: a calendar date written YYYY-MM-DD`);

export const listReportingCitiesTool = {
  name: 'list_reporting_cities',
  title: 'List NASA cities',
  description: 'Lists the cities NASA reports on, with their ids, type (DAILY or WEEKLY) and the first and last date that has delivery records. Read-only. Use the ids in other tools.',
  needsReporting: true,
  inputSchema: z.strictObject({}),
  dataSchema: z.object({
    cities: z.array(z.object({
      cityId: z.number().int(), name: z.string(), code: z.string(), type: z.string(), enabled: z.boolean(),
      firstDeliveryDate: z.string().nullable(), lastDeliveryDate: z.string().nullable(), records: z.number().int(),
    })),
  }),
  requiredScope: MCP_SCOPE,
  async run({ reporting, signal }) {
    const report = await reporting.run((db) => listReportingCities(db), { signal });
    return { ...report, units };
  },
};

export const getBusinessSummaryTool = {
  name: 'get_business_summary',
  title: 'NASA business summary',
  description: 'Summarises a period: completed deliveries, delivery revenue (weekly GOFO: what the carrier billed; otherwise the stored figure, labelled estimated when a week has no verified carrier statement), driver earnings, delivery margin (gross profit before overheads, not net profit), unallocated carrier revenue, the GOFO settlement payable by billing week, margin percentage, active drivers and per-delivery figures, with coverage and warnings. Optionally filter by city and compare with the previous period of equal length. Revenue is earned, not cash received. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({
    start_date: dateArg('First day of the period'),
    end_date: dateArg('Last day of the period (inclusive)'),
    city_ids: z.array(z.number().int()).max(50).optional().describe('Only these cities (ids from list_reporting_cities). Leave out for all cities.'),
    compare_previous_period: z.boolean().optional().describe('Also compare with the immediately preceding period of the same length'),
  }),
  dataSchema: z.object({
    period,
    cities: z.union([z.literal('all'), z.array(z.number().int())]),
    deliveries: z.number().int(),
    earnedDeliveryRevenue: money,
    grossDriverEarnings: money,
    grossMarginBeforeOverheads: money,
    deliveryRevenue: money,
    driverEarnings: money,
    deliveryMargin: money,
    unallocatedRevenue: money,
    driverEarningsAfterInsurance: money,
    revenueBasis: basis,
    revenueIsEstimated: z.boolean(),
    recordsByBasis: z.object({ statement: z.number().int(), recorded: z.number().int(), estimated: z.number().int(), unallocatedGroups: z.number().int() }),
    settlement: z.object({ statements: z.number().int(), deliveryRevenue: money, carrierClaims: money, ledgerAdjustments: money, payable: money, basis: z.string() }).nullable(),
    marginPercentage: percent,
    activeDrivers: z.number().int(),
    activeDriverDays: z.number().int(),
    deliveriesPerActiveDriverDay: z.string().nullable(),
    revenuePerDelivery: money,
    marginPerDelivery: money,
    records: z.object({ total: z.number().int(), withStoredAmounts: z.number().int(), open: z.number().int(), partialAmounts: z.number().int(), daily: z.number().int(), weekly: z.number().int() }),
    comparison: z.object({
      status: z.enum(['complete', 'incomplete', 'insufficient_data']),
      previousPeriod: period,
      previous: z.object({ deliveries: z.number().int(), earnedDeliveryRevenue: money, grossMarginBeforeOverheads: money }),
      change: z.object({ deliveries: change, earnedDeliveryRevenue: change, grossMarginBeforeOverheads: change }).nullable(),
      note: z.string(),
    }).optional(),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    const input = { period: parseRange(args), cityIds: parseCityIds(args.city_ids), comparePrevious: args.compare_previous_period === true };
    const report = await reporting.run((db) => businessSummary(db, input), { signal });
    return { ...report, units };
  },
};

export const rankCitiesTool = {
  name: 'rank_cities',
  title: 'Rank NASA cities',
  description: 'Ranks cities for a period by completed deliveries, earned delivery revenue or gross margin (gross profit before overheads), with each city\'s share of the total across all cities. Missing amounts are shown as missing, not zero. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({
    start_date: dateArg('First day of the period'),
    end_date: dateArg('Last day of the period (inclusive)'),
    rank_by: z.enum(['deliveries', 'revenue', 'gross_margin']).describe('What to rank by'),
    limit: z.number().int().min(1).max(50).optional().describe('How many cities to return (default 10)'),
  }),
  dataSchema: z.object({
    period,
    rankedBy: z.string(),
    ranking: z.array(z.object({
      rank: z.number().int(), cityId: z.number().int(), name: z.string(), code: z.string(),
      deliveries: z.number().int(),
      earnedDeliveryRevenue: money, grossMarginBeforeOverheads: money, ...bucketFigures, marginPercentage: percent,
      shareOfTotalPercent: percent,
      records: z.number().int(), recordsWithoutStoredAmounts: z.number().int(),
    })),
    totalsAllCities: z.object({ deliveries: z.number().int(), earnedDeliveryRevenue: money, grossMarginBeforeOverheads: money, citiesWithData: z.number().int() }),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    const input = { period: parseRange(args), rankBy: parseRankBy(args.rank_by), limit: parseLimit(args.limit) };
    const report = await reporting.run((db) => rankCities(db, input), { signal });
    return { ...report, units };
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Trends, drivers, claims, payments and the forecast.

const idList = z.array(z.number().int()).max(50).optional().describe('Only these cities (ids from list_reporting_cities). Leave out for all cities.');
const citiesField = z.union([z.literal('all'), z.array(z.number().int())]);
const nullableString = z.string().nullable();

export const getDeliveryTrendsTool = {
  name: 'get_delivery_trends',
  title: 'NASA delivery trends',
  description: 'Trend of completed deliveries, earned delivery revenue and gross margin by day, week or month for a period, plus the busiest weekdays and the five peak delivery dates. Days with no records are missing, not zero. Edge buckets are flagged when only partly inside the period. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({
    start_date: dateArg('First day of the period'),
    end_date: dateArg('Last day of the period (inclusive)'),
    interval: z.enum(['day', 'week', 'month']).describe('Bucket size. Weeks start on Monday. Daily trends cover at most 366 days.'),
    city_ids: idList,
  }),
  dataSchema: z.object({
    period,
    interval: z.string(),
    cities: citiesField,
    series: z.array(z.object({
      bucketStart: z.string(), bucketEnd: z.string(), deliveries: z.number().int(),
      earnedDeliveryRevenue: money, grossMarginBeforeOverheads: money, ...bucketFigures,
      activeDrivers: z.number().int(), recordsWithoutStoredAmounts: z.number().int(),
      daysWithRecords: z.number().int(), daysInBucketWithinPeriod: z.number().int(), partialBucket: z.boolean(),
    })),
    weekdays: z.array(z.object({
      weekday: z.string(), totalDeliveries: z.number().int(), daysWithRecords: z.number().int(),
      averageDeliveriesPerDayWithRecords: nullableString, rank: z.number().int().nullable(),
    })),
    busiestWeekday: nullableString,
    peakDates: z.array(z.object({ date: z.string(), weekday: z.string(), deliveries: z.number().int() })),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    const input = { period: parseRange(args), cityIds: parseCityIds(args.city_ids), interval: args.interval };
    const report = await reporting.run((db) => deliveryTrends(db, input), { signal });
    return { ...report, units };
  },
};

export const rankDriversTool = {
  name: 'rank_drivers',
  title: 'Rank NASA drivers',
  description: 'Ranks drivers for a period by completed deliveries (default) or by deliveries per active day, with each driver\'s main city, delivery count, active days and share of all deliveries. Returns names and cities only: no contact, bank, tax or login details. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({
    start_date: dateArg('First day of the period'),
    end_date: dateArg('Last day of the period (inclusive)'),
    rank_by: z.enum(['deliveries', 'deliveries_per_active_day']).optional().describe('Default deliveries'),
    limit: z.number().int().min(1).max(50).optional().describe('How many drivers to return (default 10)'),
    min_active_days: z.number().int().min(1).max(31).optional().describe('Only for deliveries_per_active_day: the fewest active days a driver needs (default 3)'),
    city_ids: idList,
  }),
  dataSchema: z.object({
    period,
    rankedBy: z.string(),
    cities: citiesField,
    minActiveDays: z.number().int(),
    ranking: z.array(z.object({
      rank: z.number().int(), driverId: z.number().int(), name: z.string(),
      primaryCity: z.object({ cityId: z.number().int(), name: z.string() }),
      citiesWorked: z.number().int(), deliveries: z.number().int(), activeDays: z.number().int(),
      deliveriesPerActiveDay: nullableString, shareOfAllDeliveriesPercent: nullableString,
    })),
    driversWithRecords: z.number().int(),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    const rankBy = args.rank_by ?? 'deliveries';
    const input = {
      period: parseRange(args), cityIds: parseCityIds(args.city_ids), rankBy, limit: parseLimit(args.limit),
      minActiveDays: args.min_active_days ?? (rankBy === 'deliveries_per_active_day' ? 3 : 1),
    };
    const report = await reporting.run((db) => rankDrivers(db, input), { signal });
    return { ...report, units };
  },
};

const claimBucket = z.object({ claims: z.number().int(), claimAmount: money });

export const getClaimExposureTool = {
  name: 'get_claim_exposure',
  title: 'NASA carrier claim exposure',
  description: 'Carrier claims by decision: chargeable (a driver owes it), exempt (owes nothing, including the agreed DFWGOFO + Tracking interruption exemption) and unmatched (not assigned to any driver yet, never deducted until decided), with counts, amounts and the oldest unmatched claim. A current snapshot; optionally limit by claim date and city. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({
    start_date: z.string().optional().describe('Only claims dated from this day (YYYY-MM-DD). Give both dates or neither.'),
    end_date: z.string().optional().describe('Only claims dated up to this day (YYYY-MM-DD)'),
    city_ids: idList,
  }),
  dataSchema: z.object({
    period: z.object({ startDate: z.string(), endDate: z.string() }).nullable(),
    cities: citiesField,
    totalClaims: z.number().int(),
    chargeable: z.object({ claims: z.number().int(), amountOwedByDrivers: money, deductedInApprovedPayRuns: money, stillToDeductBeforeRefunds: money }),
    exempt: z.object({ claims: z.number().int(), claimAmountNotCharged: money }),
    unmatched: z.object({
      claims: z.number().int(), claimAmount: money, oldestClaimDate: nullableString,
      byStatus: z.object({ unresolved: claimBucket, ambiguous: claimBucket, review: claimBucket }),
    }),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    let period = null;
    if (args.start_date !== undefined || args.end_date !== undefined) {
      if (args.start_date === undefined || args.end_date === undefined) throw new InputError('Give both start_date and end_date, or neither for claims of all dates');
      period = parseRange({ start_date: args.start_date, end_date: args.end_date });
    }
    const input = { period, cityIds: parseCityIds(args.city_ids) };
    const report = await reporting.run((db) => claimExposure(db, input), { signal });
    return { ...report, units };
  },
};

const payBucket = z.object({ statements: z.number().int(), drivers: z.number().int(), amount: money });

export const getPaymentOverviewTool = {
  name: 'get_payment_overview',
  title: 'NASA driver payment overview',
  description: 'Where driver pay stands right now: pending approval (draft runs), approved awaiting payment, processing, unconfirmed, failed, returned deposits and paid, with the cities and up to 20 payments that need attention. Current (as-of) figures, not delivery-period activity. Approved is not paid. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({ city_ids: idList }),
  dataSchema: z.object({
    asOf: z.string(),
    cities: citiesField,
    pendingApproval: payBucket, approvedAwaitingPayment: payBucket, processing: payBucket, unconfirmed: payBucket, failed: payBucket, returned: payBucket,
    returnedDepositsVisible: z.boolean(),
    paid: payBucket.extend({ paidInLast30Days: z.object({ statements: z.number().int(), amount: money }) }),
    byCity: z.array(z.object({ cityId: z.number().int(), name: z.string(), approvedAwaitingPayment: money, processing: money, failed: money, returned: money })),
    needsAttention: z.array(z.object({ statementId: z.number().int(), driver: z.string(), city: z.string(), periodStart: z.string(), periodEnd: z.string(), amount: money, state: z.string() })),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    const report = await reporting.run((db) => paymentOverview(db, { cityIds: parseCityIds(args.city_ids) }), { signal });
    return { ...report, units };
  },
};

const forecastDay = z.object({ date: z.string(), weekday: z.string(), estimate: z.number().int().nullable(), low: z.number().int().nullable(), high: z.number().int().nullable(), note: nullableString });

export const forecastDeliveriesTool = {
  name: 'forecast_deliveries',
  title: 'Estimate future NASA deliveries',
  description: 'An ESTIMATE of completed deliveries for the coming days (1 to 28, default 7) from past weekday patterns, tested on past weeks without using future data. Returns the method, training period, historical error and a prediction range when justified, or insufficient_data when history cannot support it. It starts after the last complete week of data. Not a promise: it ignores holidays and changes. Read-only.',
  needsReporting: true,
  inputSchema: z.strictObject({
    days: z.number().int().min(1).max(MAX_FORECAST_DAYS).optional().describe('How many days to estimate (default 7)'),
    start_date: z.string().optional().describe('First day to estimate (YYYY-MM-DD). Default: the first day after the last complete week of data.'),
    city_ids: idList,
  }),
  dataSchema: z.object({
    cities: citiesField,
    horizonDays: z.number().int(),
    status: z.enum(['ok', 'insufficient_data']),
    estimate: z.literal(true),
    reason: nullableString.optional(),
    method: z.object({ name: z.string(), description: z.string(), candidates: z.array(z.object({ name: z.string(), wape: z.number() })) }).optional(),
    trainingPeriod: z.object({ startDate: z.string(), endDate: z.string(), completeWeeks: z.number().int(), daysWithRecords: z.number().int() }).optional(),
    dataStartsOn: z.string().optional(),
    dataEndsOn: z.string().optional(),
    excludedWeeks: z.array(z.object({ weekStart: z.string(), daysWithRecords: z.number().int(), reason: z.string() })).optional(),
    forecast: z.array(forecastDay),
    total: z.object({ estimate: z.number().int(), daysEstimated: z.number().int(), range: z.object({ low: z.number().int(), high: z.number().int(), basis: z.string() }).nullable() }).optional(),
    backtest: z.object({
      testWeeks: z.number().int(), observations: z.number().int(),
      weightedAbsolutePercentError: z.number(), biasPercent: z.number(), naiveWeightedAbsolutePercentError: z.number(),
      rangeLevelPercent: z.number().nullable(), shareOfBacktestInsideRange: z.number().nullable(),
    }).optional(),
  }),
  requiredScope: MCP_SCOPE,
  async run({ args, reporting, signal }) {
    if (args.start_date !== undefined) parseBusinessDate(args.start_date, 'start_date');
    const input = { cityIds: parseCityIds(args.city_ids), days: args.days ?? 7, startDate: args.start_date ?? null, today: new Date().toISOString().slice(0, 10) };
    const report = await reporting.run((db) => forecastDeliveries(db, input), { signal });
    return { ...report, units: { ...units, deliveries: 'count (estimated)' } };
  },
};
