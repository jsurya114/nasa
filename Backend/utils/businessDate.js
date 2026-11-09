// "Today" in the dashboard means the admin's own calendar date. The screen sends it as YYYY-MM-DD.
// The server clock is UTC, which is already tomorrow for US evenings, so it is only a fallback.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// Time zones are at most about one day away from UTC, so two days is a safe sanity limit.
const MAX_DAYS_FROM_SERVER = 2;

const utcDay = (date) => date.toISOString().slice(0, 10);

// Returns the date as YYYY-MM-DD when it is real and close to the server date, otherwise null.
export const parseClientDate = (value, now = new Date()) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;

  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || utcDay(new Date(ms)) !== value) return null;

  const serverMs = Date.parse(`${utcDay(now)}T00:00:00Z`);
  if (Math.abs(ms - serverMs) > MAX_DAYS_FROM_SERVER * DAY_MS) return null;

  return value;
};

export const resolveToday = (value, now = new Date()) => parseClientDate(value, now) || utcDay(now);
