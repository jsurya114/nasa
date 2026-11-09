/**
 * What the Insights page asks for (issue #227), turned from query-string text into the plain reporting functions' inputs, and their results into one
 * response shape: { meta, data }. No Express here. Nothing is guessed: a missing or bad date, city, source or ranking is an InputError that says what to
 * change. All figures come from the shared reporting layer (Backend/services/reporting/), the same one the Claude connector uses.
 */
import { InputError, parseCityIdsText, parseLimit, parseRange, parseRankBy, parseSource } from '../reporting/inputs.js';
import { businessSummary, listReportingCities, rankCities } from '../reporting/deliveryReports.js';
import { claimLosses } from '../reporting/lossReports.js';
import { parseInterval, trendSeries } from './trendSeries.js';
import { CURRENCY, DEFINITIONS_VERSION, METRIC_DEFINITIONS, REPORTING_LIMITATIONS } from '../reporting/metricDefinitions.js';

const UNITS = Object.freeze({ currency: CURRENCY, deliveries: 'count', percentages: 'percent, two decimals', dates: 'business dates, YYYY-MM-DD' });

// The same envelope for every report: what was asked (scope), what the data covers, what is missing, when it was made.
const respond = (report, now = new Date()) => ({
  meta: {
    generatedAt: now.toISOString(),
    definitionsVersion: DEFINITIONS_VERSION,
    units: UNITS,
    scope: report.scope,
    coverage: report.coverage,
    warnings: report.warnings,
  },
  data: report.data,
});

// Filters shared by every report. Dates are required: the page chooses its default period, the server never does.
export function parseFilters(query = {}) {
  return {
    period: parseRange({ start_date: query.start_date, end_date: query.end_date }),
    cityIds: parseCityIdsText(query.city_ids),
    source: parseSource(query.source),
  };
}

const wholeNumber = (value) => (value === undefined ? undefined : /^\d{1,4}$/.test(String(value)) ? Number(value) : NaN);

export async function getOverview(run, query, options) {
  const filters = parseFilters(query);
  const comparePrevious = query.compare !== 'false';
  return respond(await run((db) => businessSummary(db, { ...filters, comparePrevious }), options));
}

export async function getCityRanking(run, query, options) {
  const filters = parseFilters(query);
  const rankBy = parseRankBy(query.rank_by ?? 'revenue');
  const limit = parseLimit(wholeNumber(query.limit), { fallback: 10, max: 50 });
  return respond(await run((db) => rankCities(db, { period: filters.period, rankBy, limit, cityIds: filters.cityIds, source: filters.source }), options));
}

export async function getTrends(run, query, options) {
  const filters = parseFilters(query);
  // The interval is required: the page chooses it from the length of the period, the server never guesses.
  const interval = parseInterval(query.interval, filters.period);
  return respond(await run((db) => trendSeries(db, { ...filters, interval }), options));
}

// Claim losses and the margin after them: what the carrier charged NASA and has not been taken back from drivers (see lossReports.js).
export async function getLosses(run, query, options) {
  const filters = parseFilters(query);
  return respond(await run((db) => claimLosses(db, filters), options));
}

export async function getCities(run, options) {
  return respond(await run((db) => listReportingCities(db), options));
}

// The words the page shows beside each number; the connector reads the same file.
export function getDefinitions(now = new Date()) {
  return respond({
    data: { definitionsVersion: DEFINITIONS_VERSION, definitions: METRIC_DEFINITIONS, limitations: REPORTING_LIMITATIONS },
    scope: { description: 'Definitions only. No business data is read.' },
    coverage: [],
    warnings: [],
  }, now);
}

export { InputError };
