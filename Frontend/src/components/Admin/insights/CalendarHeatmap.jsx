import React, { useMemo, useState } from "react";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import { HEAT_COLORS } from "./chartColors.js";
import { heatLevel, heatLevels, heatmapWeeks, monthMarks } from "./chartData.js";
import { DAILY_MAX } from "./insightsDates.js";
import { NA, formatBusinessDate, formatCount } from "./insightsFormat.js";

const CELL = 14;
const GAP = 3;
const button = "min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20";
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

const describe = (cell) => (cell.status === "records" ? `${formatBusinessDate(cell.date)}: ${formatCount(cell.deliveries)} deliveries` : `${formatBusinessDate(cell.date)}: no delivery records`);

// A calendar of deliveries per day, one column per week (Monday to Sunday). A day with no records is an empty dashed square, never the lightest
// shade, so "no records" and "records but 0 deliveries" differ. Shades are quarters of the busiest day. Needs the daily trend; the exact numbers
// are in the table view and in the readout under the grid.
export default function CalendarHeatmap({ status, report, message, onRetry, range, days }) {
  const [asTable, setAsTable] = useState(false);
  const [readout, setReadout] = useState("");
  const tooLong = days > DAILY_MAX;
  const series = report?.data?.series;
  const weeks = useMemo(() => (series && !tooLong ? heatmapWeeks(series, range) : []), [series, range, tooLong]);
  const cells = weeks.flatMap((w) => w.cells);
  const levels = heatLevels(cells.filter((c) => c.status === "records").map((c) => c.deliveries));
  const hasAny = cells.some((c) => c.status === "records");

  return (
    <section aria-labelledby="calendar-title" className="card-surface space-y-4 p-4 sm:p-5">
      <div>
        <h2 id="calendar-title" className="text-lg font-bold text-ink">Calendar</h2>
        <p className="text-sm text-ink-muted">Deliveries per day. Darker means busier. A dashed square is a day with no records.</p>
      </div>
      {tooLong && <p className="text-sm text-ink-muted" data-testid="calendar-too-long">The calendar shows up to {DAILY_MAX} days. Choose a shorter period to see it.</p>}
      {!tooLong && (status === "loading" || status === "idle") && <div aria-busy="true" role="status" aria-label="Loading calendar"><Skeleton className="h-32 w-full rounded-xl" /></div>}
      {!tooLong && status === "error" && <div role="alert"><p className="text-sm text-ink-muted">{message}</p><button type="button" onClick={onRetry} className={`mt-2 ${button}`}>Try again</button></div>}
      {!tooLong && status === "ready" && !hasAny && <p className="text-sm text-ink-muted" data-testid="calendar-empty">No delivery records in this period for these filters.</p>}
      {!tooLong && status === "ready" && hasAny && (
        <>
          <div className="flex justify-end">
            <button type="button" aria-pressed={asTable} aria-label={`${asTable ? "Show calendar" : "Show as table"}, calendar`} onClick={() => setAsTable((v) => !v)} className={button}>{asTable ? "Show calendar" : "Show as table"}</button>
          </div>
          {!asTable ? (
            <>
              <div className="overflow-x-auto pb-2">
                <div role="img" aria-label={`Calendar of deliveries per day, ${weeks.length} weeks. The values are in the table view.`} className="inline-flex gap-2" data-testid="calendar-grid">
                  <div aria-hidden="true" className="flex flex-col pt-5 text-xs text-ink-muted" style={{ gap: GAP }}>
                    {DAY_LABELS.map((d, i) => <span key={i} style={{ height: CELL, lineHeight: `${CELL}px` }}>{d}</span>)}
                  </div>
                  <div>
                    <div className="flex" style={{ gap: GAP, height: 20 }}>
                      {weeks.map((w, i) => {
                        const mark = monthMarks(weeks).find((m) => m.column === i);
                        return <div key={w.monday} className="relative" style={{ width: CELL }}>{mark && <span className="absolute left-0 top-0 whitespace-nowrap text-xs text-ink-muted">{mark.label}</span>}</div>;
                      })}
                    </div>
                    <div className="flex" style={{ gap: GAP }}>
                      {weeks.map((w) => (
                        <div key={w.monday} className="flex flex-col" style={{ gap: GAP }}>
                          {w.cells.map((c) => (c.status === "outside" ? <span key={c.date} style={{ width: CELL, height: CELL }} /> : (
                            <span key={c.date} data-date={c.date} data-status={c.status} data-level={c.status === "records" ? heatLevel(c.deliveries, levels) : undefined}
                              onMouseEnter={() => setReadout(describe(c))} onClick={() => setReadout(describe(c))}
                              className={`rounded-sm ${c.status === "empty" ? "border border-dashed border-line" : "border border-brand-100"}`}
                              style={{ width: CELL, height: CELL, background: c.status === "records" ? HEAT_COLORS[heatLevel(c.deliveries, levels)] : "transparent" }} />
                          )))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <p role="status" aria-live="polite" className="min-h-5 text-sm text-ink" data-testid="calendar-readout">{readout || "Point at a day to see its deliveries."}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted" data-testid="calendar-legend">
                <span className="inline-block rounded-sm border border-dashed border-line" style={{ width: CELL, height: CELL }} />No records
                <span className="ml-3">Fewer</span>
                {HEAT_COLORS.map((c, i) => <span key={c} className="inline-block rounded-sm border border-brand-100" style={{ width: CELL, height: CELL, background: c }} title={i === 0 ? "0 deliveries" : undefined} />)}
                <span>More (busiest day: {formatCount(levels.max)})</span>
              </div>
            </>
          ) : (
            <div className="max-h-96 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm" data-testid="calendar-table">
                <caption className="sr-only">Deliveries per day</caption>
                <thead className="sticky top-0 bg-brand-50 text-xs uppercase text-ink-muted"><tr><th scope="col" className="p-2">Day</th><th scope="col" className="p-2 text-right">Deliveries</th></tr></thead>
                <tbody>
                  {cells.filter((c) => c.status !== "outside").map((c) => (
                    <tr key={c.date} className="border-t border-line"><th scope="row" className="p-2 font-medium text-ink">{formatBusinessDate(c.date)}</th><td className="p-2 text-right">{c.status === "records" ? formatCount(c.deliveries) : NA}</td></tr>
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
