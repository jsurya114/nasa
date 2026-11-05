import * as z from 'zod/v4';
import { MCP_SCOPE } from '../config.js';
import { CURRENCY } from '../../reporting/metricDefinitions.js';
import { parseCityIds, parseLimit, parseRange, parseRankBy } from '../../reporting/inputs.js';
import { businessSummary, listReportingCities, rankCities } from '../../reporting/deliveryReports.js';

const money = z.string().nullable().describe('Exact decimal USD string, or null when not available');
const percent = z.string().nullable().describe('Percentage with two decimals, or null when it has no meaning');
const period = z.object({ startDate: z.string(), endDate: z.string(), days: z.number().int() });
const change = z.object({ absolute: z.string().nullable(), percent });
const units = { currency: CURRENCY, deliveries: 'count', percentages: 'percent, two decimals', dates: 'business dates, YYYY-MM-DD' };

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
  description: 'Summarises a period: completed deliveries, earned delivery revenue, gross margin (gross profit before overheads, not net profit), margin percentage, active drivers and per-delivery figures, with coverage and warnings. Optionally filter by city and compare with the previous period of equal length. Revenue is earned, not cash received. Read-only.',
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
      earnedDeliveryRevenue: money, grossMarginBeforeOverheads: money, marginPercentage: percent,
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
