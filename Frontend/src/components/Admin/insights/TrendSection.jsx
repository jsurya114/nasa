import React, { useState } from "react";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import TrendChart from "./TrendChart.jsx";
import { SERIES_BLUE, SERIES_ORANGE, BRAND } from "./chartColors.js";
import { seriesToPoints } from "./chartData.js";
import { DAILY_MAX } from "./insightsDates.js";
import { NA, formatCount, formatUsd, formatUsdCompact } from "./insightsFormat.js";

const CHOICES = [["auto", "Auto"], ["day", "Day"], ["week", "Week"], ["month", "Month"]];
const SIZE_WORD = { day: "day", week: "week", month: "month" };
const button = "min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

const VOLUME = [{ key: "deliveries", label: "Deliveries", color: BRAND, text: (p) => formatCount(p.deliveries) }];
const MONEY = [
  { key: "revenue", label: "Revenue", color: SERIES_BLUE, text: (p) => formatUsd(p.revenueText) },
  { key: "margin", label: "Gross margin", color: SERIES_ORANGE, text: (p) => formatUsd(p.marginText) },
];

const summaryOf = (what, points) => {
  const withRecords = points.filter((p) => p.hasRecords);
  if (withRecords.length === 0) return `${what}: no delivery records in this period.`;
  return `${what} from ${points[0].tick} to ${points.at(-1).tick}: ${withRecords.length} of ${points.length} periods have records. The values are in the table view.`;
};

// Deliveries, revenue and gross margin over time (#227), from GET /admin/insights/trends. The bucket size is the person's choice or chosen from the
// length of the period. Periods with no records are gaps. Everything shown is also available as a table with the exact figures.
export default function TrendSection({ status, report, message, onRetry, choice, onChoice, interval, days }) {
  const [asTable, setAsTable] = useState(false);
  const series = report?.data?.series ?? [];
  const points = seriesToPoints(series, report?.data?.interval ?? interval);
  const warnings = report?.meta?.warnings ?? [];
  const hasAny = points.some((p) => p.hasRecords);

  return (
    <section aria-labelledby="trends-title" className="card-surface space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="trends-title" className="text-lg font-bold text-ink">Trends</h2>
          <p className="text-sm text-ink-muted">Deliveries, revenue and gross margin by {SIZE_WORD[interval]}. A period with no records is a gap, not zero.</p>
        </div>
        <div role="group" aria-label="Group trends by" className="flex flex-wrap gap-2">
          {CHOICES.map(([id, label]) => {
            const blocked = id === "day" && days > DAILY_MAX;
            const on = choice === id;
            return (
              <button key={id} type="button" aria-pressed={on} disabled={blocked} title={blocked ? `A daily trend can cover at most ${DAILY_MAX} days` : undefined} onClick={() => onChoice(id)}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-50"}`}>{label}</button>
            );
          })}
        </div>
      </div>

      {(status === "loading" || status === "idle") && (
        <div aria-busy="true" role="status" aria-label="Loading trends" className="space-y-3"><Skeleton className="h-60 w-full rounded-xl" /><Skeleton className="h-60 w-full rounded-xl" /></div>
      )}
      {status === "error" && (
        <div role="alert"><p className="text-sm text-ink-muted">{message}</p><button type="button" onClick={onRetry} className={`mt-2 ${button}`}>Try again</button></div>
      )}
      {status === "ready" && !hasAny && <p className="text-sm text-ink-muted" data-testid="trends-empty">No delivery records in this period for these filters.</p>}

      {status === "ready" && hasAny && (
        <>
          <div className="flex justify-end">
            <button type="button" aria-pressed={asTable} aria-label={`${asTable ? "Show charts" : "Show as table"}, trends`} onClick={() => setAsTable((v) => !v)} className={button}>{asTable ? "Show charts" : "Show as table"}</button>
          </div>
          {!asTable ? (
            <div className="space-y-6">
              <TrendChart title="Deliveries" points={points} series={VOLUME} axisFormat={formatCount} summary={summaryOf("Deliveries", points)} />
              <TrendChart title="Revenue and gross margin (USD)" points={points} series={MONEY} axisFormat={formatUsdCompact} summary={summaryOf("Revenue and gross margin", points)} />
            </div>
          ) : (
            <div className="max-h-96 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm" data-testid="trends-table">
                <caption className="sr-only">Trends by {SIZE_WORD[interval]}</caption>
                <thead className="sticky top-0 bg-brand-50 text-xs uppercase text-ink-muted"><tr><th scope="col" className="p-2">Period</th><th scope="col" className="p-2 text-right">Deliveries</th><th scope="col" className="p-2 text-right">Revenue</th><th scope="col" className="p-2 text-right">Gross margin</th><th scope="col" className="p-2 text-right">Drivers</th></tr></thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.key} className="border-t border-line">
                      <th scope="row" className="p-2 font-medium text-ink">{p.label}{p.partial ? " (part)" : ""}</th>
                      <td className="p-2 text-right">{p.hasRecords ? formatCount(p.deliveries) : NA}</td>
                      <td className="p-2 text-right">{p.hasRecords ? formatUsd(p.revenueText) : NA}</td>
                      <td className="p-2 text-right">{p.hasRecords ? formatUsd(p.marginText) : NA}</td>
                      <td className="p-2 text-right">{p.hasRecords ? formatCount(p.activeDrivers) : NA}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-ink-muted" data-testid="trends-notes">{warnings.slice(0, 4).map((w) => <li key={w}>{w}</li>)}</ul>}
        </>
      )}
    </section>
  );
}
