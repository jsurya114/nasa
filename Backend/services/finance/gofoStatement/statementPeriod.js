import { StatementError } from './statementMoney.js';

// The carrier writes the billing week as "Week 43-2026". It is the ISO week: Monday to Sunday, and week 1 is the week that holds 4 January.
// The dates are worked out here, never taken from the file name or from the first line signed.

const DAY_MS = 86400000;
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

const mondayOfWeekOne = (year) => {
  const jan4 = Date.UTC(year, 0, 4);
  const weekday = (new Date(jan4).getUTCDay() + 6) % 7; // 0 = Monday
  return jan4 - weekday * DAY_MS;
};

const weeksInYear = (year) => Math.round((mondayOfWeekOne(year + 1) - mondayOfWeekOne(year)) / (7 * DAY_MS));

export const billingWeekDates = (text) => {
  const match = /^week\s*(\d{1,2})\s*-\s*(\d{4})$/i.exec(String(text ?? '').trim());
  if (!match) throw new StatementError(`The billing period "${String(text ?? '').trim()}" is not a week like "Week 43-2026"`);
  const week = Number(match[1]);
  const year = Number(match[2]);
  if (week < 1 || week > weeksInYear(year)) throw new StatementError(`Week ${week} does not exist in ${year}`);
  const start = mondayOfWeekOne(year) + (week - 1) * 7 * DAY_MS;
  return { start: isoOf(start), end: isoOf(start + 6 * DAY_MS), label: `Week ${week}-${year}` };
};
