import React from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import { AXIS_TEXT, BRAND, BRAND_STRONG, GRID } from "./chartColors.js";
import { NA, formatCount, formatDecimal } from "./insightsFormat.js";

const button = "min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

function WeekdayTooltip({ active, payload }) {
  const row = active && payload?.length ? payload[0].payload : null;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-line bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-ink">{row.weekday}</p>
      {row.days === 0 ? <p className="text-ink-muted">No delivery records on this weekday</p> : (
        <>
          <p className="text-ink">{formatDecimal(row.average)} deliveries on an average day</p>
          <p className="text-xs text-ink-muted">{formatCount(row.total)} deliveries over {formatCount(row.days)} day{row.days === 1 ? "" : "s"} with records</p>
        </>
      )}
    </div>
  );
}

// The average number of deliveries on each weekday, over the days that have records (so a day NASA does not work is blank, not zero), with the
// busiest weekday in the stronger shade. Data comes from the same trends answer as the line charts.
export default function WeekdayChart({ status, report, message, onRetry }) {
  const [asTable, setAsTable] = React.useState(false);
  const weekdays = report?.data?.weekdays ?? [];
  const rows = weekdays.map((w) => ({ weekday: w.weekday, short: w.weekday.slice(0, 3), average: w.averageDeliveriesPerDayWithRecords === null ? null : Number(w.averageDeliveriesPerDayWithRecords), total: w.totalDeliveries, days: w.daysWithRecords }));
  const busiest = report?.data?.busiestWeekday ?? null;
  const hasAny = rows.some((r) => r.days > 0);

  return (
    <section aria-labelledby="weekday-title" className="card-surface space-y-4 p-4 sm:p-5">
      <div>
        <h2 id="weekday-title" className="text-lg font-bold text-ink">Busiest weekdays</h2>
        <p className="text-sm text-ink-muted">Average deliveries on a day that has records. A weekday with no records is blank, not zero.</p>
      </div>
      {(status === "loading" || status === "idle") && <div aria-busy="true" role="status" aria-label="Loading weekdays"><Skeleton className="h-56 w-full rounded-xl" /></div>}
      {status === "error" && <div role="alert"><p className="text-sm text-ink-muted">{message}</p><button type="button" onClick={onRetry} className={`mt-2 ${button}`}>Try again</button></div>}
      {status === "ready" && !hasAny && <p className="text-sm text-ink-muted" data-testid="weekday-empty">No delivery records in this period for these filters.</p>}
      {status === "ready" && hasAny && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink" data-testid="weekday-busiest">{busiest ? <>Busiest weekday: <strong>{busiest}</strong></> : "Not enough records to name a busiest weekday."}</p>
            <button type="button" aria-pressed={asTable} aria-label={`${asTable ? "Show chart" : "Show as table"}, weekdays`} onClick={() => setAsTable((v) => !v)} className={button}>{asTable ? "Show chart" : "Show as table"}</button>
          </div>
          {!asTable ? (
            <div role="img" aria-label={`Average deliveries by weekday. Busiest: ${busiest ?? "none"}. The values are in the table view.`} className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="short" interval={0} tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 12, fill: AXIS_TEXT }} />
                  <YAxis width={48} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS_TEXT }} />
                  <Tooltip content={<WeekdayTooltip />} cursor={{ fill: "var(--color-brand-50)" }} isAnimationActive={false} />
                  <Bar dataKey="average" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                    {rows.map((r) => <Cell key={r.weekday} fill={r.weekday === busiest ? BRAND_STRONG : BRAND} fillOpacity={r.weekday === busiest ? 1 : 0.55} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <table className="w-full text-left text-sm" data-testid="weekday-table">
              <caption className="sr-only">Average deliveries by weekday</caption>
              <thead className="text-xs uppercase text-ink-muted"><tr><th scope="col" className="p-2">Weekday</th><th scope="col" className="p-2 text-right">Average per day</th><th scope="col" className="p-2 text-right">Days with records</th><th scope="col" className="p-2 text-right">Total</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.weekday} className="border-t border-line">
                    <th scope="row" className="p-2 font-medium text-ink">{r.weekday}</th>
                    <td className="p-2 text-right">{r.average === null ? NA : formatDecimal(r.average)}</td>
                    <td className="p-2 text-right">{formatCount(r.days)}</td>
                    <td className="p-2 text-right">{r.days === 0 ? NA : formatCount(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
