// How Insights shows numbers the server sent as exact text (#227). Display only: nothing here recomputes a total. A missing value is "N/A",
// never a zero, and a comparison that cannot be made says so instead of showing a made-up change.
export const NA = "N/A";

const isMissing = (value) => value === null || value === undefined || value === "";

export function formatUsd(value) {
  if (isMissing(value)) return NA;
  const n = Number(value);
  if (!Number.isFinite(n)) return NA;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// A whole-dollar form for crowded places (axes and bars). Tooltips and tables always show the exact cents with formatUsd.
export function formatUsdCompact(value) {
  if (isMissing(value)) return NA;
  const n = Number(value);
  if (!Number.isFinite(n)) return NA;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: Math.abs(n) >= 100000 ? "compact" : "standard", maximumFractionDigits: Math.abs(n) >= 100000 ? 1 : 0 }).format(n);
}

export function formatCount(value) {
  if (isMissing(value)) return NA;
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US").format(n) : NA;
}

// "17.12" -> "17.12%"
export function formatPercent(value) {
  if (isMissing(value)) return NA;
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : NA;
}

// A per-unit figure with two decimals, such as deliveries per active driver-day.
export function formatDecimal(value) {
  if (isMissing(value)) return NA;
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : NA;
}

// The comparison with the previous equal-length period, as the card shows it. `comparison` is the server's object (status and change).
// kind: "money" or "count". Returns { tone, text, note }: tone is "up", "down", "flat" or "none".
export function describeChange(comparison, key, kind) {
  if (!comparison) return { tone: "none", text: "Comparison off", note: null };
  if (comparison.status === "insufficient_data" || !comparison.change) {
    return { tone: "none", text: "Insufficient data", note: comparison.note ?? "There is no data in the previous period to compare with." };
  }
  const change = comparison.change[key];
  if (!change || isMissing(change.absolute)) return { tone: "none", text: "Insufficient data", note: "This figure is not available for the previous period." };
  const absolute = Number(change.absolute);
  const tone = absolute > 0 ? "up" : absolute < 0 ? "down" : "flat";
  const amount = kind === "money" ? formatUsd(Math.abs(absolute).toFixed(2)) : formatCount(Math.abs(absolute));
  const sign = tone === "up" ? "+" : tone === "down" ? "−" : "";
  const percent = isMissing(change.percent) ? "" : ` (${Number(change.percent) > 0 ? "+" : Number(change.percent) < 0 ? "−" : ""}${Math.abs(Number(change.percent)).toFixed(2)}%)`;
  return { tone, text: `${sign}${amount}${percent}`, note: comparison.status === "incomplete" ? comparison.note : null };
}

// "2026-11-06T01:48:13.000Z" -> "Nov 6, 2026, 7:18 AM" in the viewer's own time zone.
export function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NA : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function formatBusinessDate(iso) {
  if (isMissing(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NA;
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
