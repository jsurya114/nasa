import React, { useState } from "react";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import { NA, formatCount, formatPercent, formatUsd } from "./insightsFormat.js";
import { RANK_METRICS } from "./rankMetrics.js";

const valueText = (metric, row) => (metric.money ? formatUsd(row[metric.field]) : formatCount(row[metric.field]));

// Top cities as horizontal bars, with the exact value and share in text beside each bar (the bar is only a picture of it), and the same data as a
// table on request. Clicking a city filters the whole page to it; the page offers a way back.
export default function CityRanking({ status, report, message, onRetry, metricId, onMetric, selectedCityIds, onSelectCity }) {
  const [asTable, setAsTable] = useState(false);
  const metric = RANK_METRICS.find((m) => m.id === metricId) ?? RANK_METRICS[0];
  const rows = report?.data?.ranking ?? [];
  const numbers = rows.map((r) => Number(r[metric.field])).filter(Number.isFinite);
  const largest = Math.max(0, ...numbers);

  return (
    <section aria-labelledby="city-ranking-title" className="card-surface space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="city-ranking-title" className="text-lg font-bold text-ink">Top cities</h2>
          <p className="text-sm text-ink-muted">Ranked by {metric.label.toLowerCase()}. Choose a city to filter the whole page.</p>
        </div>
        <div role="group" aria-label="Rank cities by" className="flex flex-wrap gap-2">
          {RANK_METRICS.map((m) => (
            <button key={m.id} type="button" aria-pressed={m.id === metric.id} onClick={() => onMetric(m.id)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/20 ${m.id === metric.id ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-50"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {(status === "loading" || status === "idle") && (
        <div aria-busy="true" role="status" aria-label="Loading city ranking" className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
        </div>
      )}
      {status === "error" && (
        <div role="alert">
          <p className="text-sm text-ink-muted">{message}</p>
          <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20">Try again</button>
        </div>
      )}
      {status === "ready" && rows.length === 0 && <p className="text-sm text-ink-muted" data-testid="ranking-empty">No city has delivery records for these filters.</p>}

      {status === "ready" && rows.length > 0 && (
        <>
          <div className="flex justify-end">
            <button type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20">
              {asTable ? "Show bars" : "Show as table"}
            </button>
          </div>
          {!asTable ? (
            <ol aria-label={`Cities ranked by ${metric.label.toLowerCase()}`} className="space-y-3">
              {rows.map((row) => {
                const n = Number(row[metric.field]);
                const width = Number.isFinite(n) && largest > 0 ? Math.max(n > 0 ? 2 : 0, (n / largest) * 100) : 0;
                const selected = selectedCityIds.includes(row.cityId);
                return (
                  <li key={row.cityId}>
                    <button type="button" aria-pressed={selected} onClick={() => onSelectCity(row.cityId)}
                      className={`w-full rounded-xl border p-3 text-left focus:outline-none focus:ring-4 focus:ring-brand-500/20 ${selected ? "border-brand bg-brand-50" : "border-line bg-white hover:bg-brand-50/60"}`}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 break-words font-semibold text-ink"><span className="mr-2 tabular-nums text-ink-muted">{row.rank}.</span>{row.name}</span>
                        <span className="whitespace-nowrap font-bold tabular-nums text-ink">{valueText(metric, row)}</span>
                      </span>
                      <span aria-hidden="true" className="mt-2 block h-2.5 overflow-hidden rounded-full bg-brand-100">
                        <span className="block h-full rounded-full bg-brand-600" style={{ width: `${width}%` }} />
                      </span>
                      <span className="mt-1 block text-xs text-ink-muted">
                        {row.shareOfTotalPercent === null || row.shareOfTotalPercent === undefined ? `Share ${NA}` : `${formatPercent(row.shareOfTotalPercent)} of ${selectedCityIds.length > 0 ? "the selected cities" : "all cities"}`}
                        {row.recordsWithoutStoredAmounts > 0 && ` · ${row.recordsWithoutStoredAmounts} record(s) without stored amounts`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Cities ranked by {metric.label.toLowerCase()}</caption>
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th scope="col" className="py-2 pr-3">#</th><th scope="col" className="py-2 pr-3">City</th>
                    <th scope="col" className="py-2 pr-3 text-right">Deliveries</th><th scope="col" className="py-2 pr-3 text-right">Revenue</th>
                    <th scope="col" className="py-2 pr-3 text-right">Gross margin</th><th scope="col" className="py-2 pr-3 text-right">Margin %</th><th scope="col" className="py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cityId} className="border-b border-line/60">
                      <td className="py-2 pr-3 tabular-nums">{r.rank}</td><th scope="row" className="py-2 pr-3 font-semibold">{r.name}</th>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCount(r.deliveries)}</td><td className="py-2 pr-3 text-right tabular-nums">{formatUsd(r.earnedDeliveryRevenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatUsd(r.grossMarginBeforeOverheads)}</td><td className="py-2 pr-3 text-right tabular-nums">{formatPercent(r.marginPercentage)}</td>
                      <td className="py-2 text-right tabular-nums">{formatPercent(r.shareOfTotalPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
