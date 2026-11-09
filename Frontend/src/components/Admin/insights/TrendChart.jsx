import React from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TEXT, GRID } from "./chartColors.js";

const MAX_DOTS = 90;

// What the tooltip says for the point under the pointer: the bucket, then each series' exact value, or that there are no records (never zero).
function TrendTooltip({ active, payload, series }) {
  const point = active && payload?.length ? payload[0].payload : null;
  if (!point) return null;
  return (
    <div className="max-w-64 rounded-xl border border-line bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-ink">{point.label}</p>
      {point.partial && <p className="text-xs text-ink-muted">Only part of this period is inside the chosen dates.</p>}
      {!point.hasRecords ? <p className="mt-1 text-ink-muted">No delivery records</p> : (
        <ul className="mt-1 space-y-0.5">
          {series.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-ink-muted"><span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ background: s.color }} />{s.label}</span>
              <span className="font-semibold text-ink">{s.text(point)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One line chart over the buckets of the period. A bucket without records is a gap in the line (null), never a zero. The exact values are in the
// tooltip and in the table view the section offers; the legend appears when there are two or more lines.
export default function TrendChart({ title, points, series, axisFormat, summary }) {
  return (
    <figure className="space-y-2" data-testid={`trend-${series[0].key}`}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{title}</span>
        {series.length > 1 && (
          <ul aria-label="Legend" className="flex flex-wrap gap-4 text-sm text-ink">
            {series.map((s) => <li key={s.key} className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-0.5 w-4" style={{ background: s.color }} />{s.label}</li>)}
          </ul>
        )}
      </figcaption>
      <div role="img" aria-label={summary} className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="tick" interval="preserveStartEnd" minTickGap={28} tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 12, fill: AXIS_TEXT }} />
            <YAxis width={64} domain={[0, "auto"]} allowDecimals={false} tickLine={false} axisLine={false} tickFormatter={axisFormat} tick={{ fontSize: 12, fill: AXIS_TEXT }} />
            <Tooltip content={<TrendTooltip series={series} />} cursor={{ stroke: AXIS_TEXT, strokeDasharray: "3 3" }} isAnimationActive={false} />
            {series.map((s) => (
              <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} connectNulls={false} isAnimationActive={false}
                dot={points.length <= MAX_DOTS ? { r: 3, fill: s.color, stroke: "#fff", strokeWidth: 1 } : false} activeDot={{ r: 5, fill: s.color, stroke: "#fff", strokeWidth: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
