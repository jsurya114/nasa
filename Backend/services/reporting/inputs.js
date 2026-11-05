/**
 * Input checks and exact-number helpers for reports (issue #220). Plain functions, no Express or MCP types: the Insights page
 * and the connector's tools both call them. A bad input is rejected with an InputError that explains what to change; nothing
 * is guessed or silently clipped.
 */

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

export const MAX_RANGE_DAYS = 1096; // three years, so one question stays bounded
export const MAX_CITY_FILTER = 50;
export const RANK_METRICS = Object.freeze(['deliveries', 'revenue', 'gross_margin']);

const DAY_MS = 24 * 60 * 60 * 1000;

// A real calendar date written YYYY-MM-DD (business dates, no time zone).
export function parseBusinessDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError(`${label} must be a date written YYYY-MM-DD`);
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new InputError(`${label} is not a real calendar date`);
  const year = Number(value.slice(0, 4));
  if (year < 2000 || year > 2100) throw new InputError(`${label} must be between the years 2000 and 2100`);
  return ms;
}

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, days) => isoDay(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS);

export function parseRange({ start_date: start, end_date: end }) {
  const from = parseBusinessDate(start, 'start_date');
  const to = parseBusinessDate(end, 'end_date');
  if (from > to) throw new InputError('start_date must not be after end_date');
  const days = Math.round((to - from) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new InputError(`The period is ${days} days; the most one question can cover is ${MAX_RANGE_DAYS} days. Ask for a shorter period.`);
  return { startDate: start, endDate: end, days };
}

export function parseCityIds(ids) {
  if (ids === undefined || ids === null) return null;
  if (!Array.isArray(ids) || ids.length === 0) throw new InputError('city_ids must be a non-empty list, or left out for all cities');
  if (ids.length > MAX_CITY_FILTER) throw new InputError(`city_ids can hold at most ${MAX_CITY_FILTER} cities`);
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) throw new InputError('city_ids must be positive whole numbers; use list_reporting_cities to find them');
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function parseLimit(limit, { fallback = 10, max = 50 } = {}) {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new InputError(`limit must be a whole number from 1 to ${max}`);
  return limit;
}

export function parseRankBy(value) {
  if (!RANK_METRICS.includes(value)) throw new InputError(`rank_by must be one of: ${RANK_METRICS.join(', ')}`);
  return value;
}

// ---- exact arithmetic on money and counts: BigInt in cents, never floating point ----
export const toCents = (text) => {
  if (text === null || text === undefined) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text));
  if (!match) throw new Error('not a decimal number');
  const cents = BigInt(match[2]) * 100n + BigInt(((match[3] ?? '') + '00').slice(0, 2));
  return match[1] ? -cents : cents;
};

export const centsToText = (cents) => {
  if (cents === null) return null;
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

// Percentage change from `previous` to `current` as a 2-decimal string, or null when it has no meaning (no previous amount).
export function percentChange(current, previous) {
  if (current === null || previous === null || previous <= 0n) return null;
  const numerator = (current - previous) * 10000n;
  let quotient = numerator / previous;
  const remainder = numerator % previous;
  if ((remainder < 0n ? -remainder : remainder) * 2n >= previous) quotient += numerator < 0n ? -1n : 1n;
  const negative = quotient < 0n;
  const abs = negative ? -quotient : quotient;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
