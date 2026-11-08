// Turning the server's trend series into what the charts draw (#227). Pure functions: no figure is computed here beyond picking and grouping what the
// server sent. A bucket with no records stays null, so a line has a gap and a calendar cell says "no records", never zero.
import { formatBusinessDate } from "./insightsFormat.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const num = (text) => (text === null || text === undefined || text === "" || !Number.isFinite(Number(text)) ? null : Number(text));
const dayMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// The short label under an axis tick: "Oct 8", "Oct 5" for the week that began on the 5th, "Oct 2026" for a month.
export const tickLabel = (interval, start) => {
  const month = MONTHS[Number(start.slice(5, 7)) - 1];
  return interval === "month" ? `${month} ${start.slice(0, 4)}` : `${month} ${Number(start.slice(8, 10))}`;
};

// The label a tooltip and a table row show: one date, or the dates a week or month covers.
export const bucketLabel = (interval, bucket) => (interval === "day" ? formatBusinessDate(bucket.bucketStart) : `${formatBusinessDate(bucket.bucketStart)} – ${formatBusinessDate(bucket.bucketEnd)}`);

// One chart point per bucket. The exact text the server sent is kept beside the number the chart plots, so a tooltip shows the exact value.
export function seriesToPoints(series, interval) {
  return series.map((b) => ({
    key: b.bucketStart,
    tick: tickLabel(interval, b.bucketStart),
    label: bucketLabel(interval, b),
    hasRecords: b.hasRecords,
    partial: b.partialBucket,
    deliveries: b.deliveries,
    revenue: num(b.earnedDeliveryRevenue),
    margin: num(b.grossMarginBeforeOverheads),
    revenueText: b.earnedDeliveryRevenue,
    marginText: b.grossMarginBeforeOverheads,
    activeDrivers: b.activeDrivers,
    withoutAmounts: b.recordsWithoutStoredAmounts,
    estimated: b.revenueIsEstimated === true,
    unallocatedText: b.unallocatedRevenue ?? null,
  }));
}

// The calendar heatmap: one column per week (Monday to Sunday), one row per weekday. `days` are the server's daily buckets. A cell is "outside"
// before the period starts or after it ends, "empty" for a day with no records (not zero), or carries its deliveries.
export function heatmapWeeks(days, range) {
  const byDate = new Map(days.map((d) => [d.bucketStart, d]));
  const firstMonday = dayMs(range.start) - ((new Date(dayMs(range.start)).getUTCDay() + 6) % 7) * 86400000;
  const lastMs = dayMs(range.end);
  const weeks = [];
  for (let monday = firstMonday; monday <= lastMs; monday += 7 * 86400000) {
    const cells = [];
    for (let i = 0; i < 7; i += 1) {
      const date = isoOf(monday + i * 86400000);
      if (date < range.start || date > range.end) cells.push({ date, status: "outside", deliveries: null });
      else {
        const d = byDate.get(date);
        cells.push(d?.hasRecords ? { date, status: "records", deliveries: d.deliveries, withoutAmounts: d.recordsWithoutStoredAmounts } : { date, status: "empty", deliveries: null });
      }
    }
    weeks.push({ monday: isoOf(monday), cells });
  }
  return weeks;
}

// Five shades from the busiest days: the thresholds are quarters of the busiest day, so the legend can say what each shade means.
export function heatLevels(values) {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  return { max, thresholds: max > 0 ? [0.25, 0.5, 0.75].map((q) => Math.ceil(max * q)) : [] };
}
export const heatLevel = (value, { max, thresholds }) => {
  if (!Number.isFinite(value) || max <= 0) return 0;
  if (value <= 0) return 0;
  return 1 + thresholds.filter((t) => value > t).length; // 1 to 4
};

// The month label above each calendar column that begins a new month. A column belongs to the month of its Thursday (the ISO rule), so a month
// that starts in the middle of a week is still labelled exactly once, and no month is skipped.
export function monthMarks(weeks) {
  const marks = [];
  let last = "";
  weeks.forEach((w, i) => {
    const key = w.cells[3].date.slice(0, 7);
    if (key !== last) { marks.push({ column: i, label: MONTHS[Number(key.slice(5, 7)) - 1] }); last = key; }
  });
  return marks;
}
