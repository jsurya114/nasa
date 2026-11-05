// Date ranges for the Insights page (#227), in the owner's own local calendar and as whole business dates (YYYY-MM-DD), never as times.
// The report period is chosen by a preset or by two dates; the previous period is the same number of days immediately before it.
import { toLocalDateString } from "../../../utils/dateRange.js";

// The server accepts at most three years in one question (1096 days); the page says so instead of sending a request that will be refused.
export const MAX_RANGE_DAYS = 1096;
export const DEFAULT_PRESET = "last30";
export const PRESETS = Object.freeze([
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "custom", label: "Custom" },
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// A real calendar date written YYYY-MM-DD.
export const isRealDate = (value) => typeof value === "string" && DATE_TEXT.test(value) && isoOf(dayOf(value)) === value;

export const daysInRange = ({ start, end }) => Math.round((dayOf(end) - dayOf(start)) / DAY_MS) + 1;

// The range a preset means on `now`'s local date. "Custom" has no range of its own: it keeps the dates the person chose.
export function rangeForPreset(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (preset === "last7") return { start: toLocalDateString(new Date(y, m, d - 6)), end: toLocalDateString(now) };
  if (preset === "last30") return { start: toLocalDateString(new Date(y, m, d - 29)), end: toLocalDateString(now) };
  if (preset === "thisMonth") return { start: toLocalDateString(new Date(y, m, 1)), end: toLocalDateString(now) };
  if (preset === "lastMonth") return { start: toLocalDateString(new Date(y, m - 1, 1)), end: toLocalDateString(new Date(y, m, 0)) };
  return null;
}

// Why a range cannot be asked for, in words, or null when it can.
export function rangeProblem({ start, end }) {
  if (!isRealDate(start) || !isRealDate(end)) return "Choose a start and an end date.";
  if (start > end) return "The start date must not be after the end date.";
  if (daysInRange({ start, end }) > MAX_RANGE_DAYS) return `One question can cover at most ${MAX_RANGE_DAYS} days (three years). Choose a shorter period.`;
  return null;
}

// The same number of days immediately before the range: 1 to 30 Oct is compared with 1 to 30 Sep, 21 Aug to 30 Sep is not.
export function previousRange({ start, end }) {
  const days = daysInRange({ start, end });
  const prevEnd = dayOf(start) - DAY_MS;
  return { start: isoOf(prevEnd - (days - 1) * DAY_MS), end: isoOf(prevEnd) };
}

// "Oct 1 – Oct 30, 2026" for a heading. Parsed as a calendar date, so the time zone cannot move it by a day.
export function describeRange({ start, end }) {
  const fmt = (iso, withYear) => new Date(dayOf(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear && { year: "numeric" }), timeZone: "UTC" });
  return start.slice(0, 4) === end.slice(0, 4) ? `${fmt(start, false)} – ${fmt(end, true)}` : `${fmt(start, true)} – ${fmt(end, true)}`;
}
