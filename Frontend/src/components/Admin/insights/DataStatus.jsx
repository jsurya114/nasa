import React from "react";
import { Info } from "lucide-react";
import { formatBusinessDate, formatCount, formatDateTime } from "./insightsFormat.js";

// Where the numbers come from and what to keep in mind: when they were made, how far the delivery data goes, and the server's own warnings
// (open records, missing days, a partly covered comparison). Nothing here is invented: every line is the server's or a fixed definition.
export default function DataStatus({ report }) {
  if (!report) return null;
  const { meta, data } = report;
  const coverage = meta.coverage?.[0] ?? {};
  const warnings = meta.warnings ?? [];
  const withoutAmounts = (data.records?.open ?? 0) + (data.records?.partialAmounts ?? 0);
  return (
    <section aria-label="About these figures" className="card-surface space-y-3 p-4 sm:p-5">
      <p className="text-sm text-ink" data-testid="data-as-of">
        <span className="font-semibold">Data as of {formatDateTime(meta.generatedAt)}.</span>{" "}
        Delivery records for these filters run {formatBusinessDate(coverage.firstDate)} to {formatBusinessDate(coverage.lastDate)}.
        {data.records && ` ${formatCount(data.records.total)} records in this period${withoutAmounts > 0 ? `, ${formatCount(withoutAmounts)} without stored amounts yet` : ""}.`}
      </p>
      <p className="flex gap-2 text-sm text-ink-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Delivery revenue for weekly GOFO is what the carrier billed on its verified statements; daily figures are the amounts stored when each record was calculated, and weekly records without a verified statement are marked estimated. Delivery margin is delivery revenue minus driver earnings: no overheads or operating costs are recorded, so it is not net profit. Revenue is earned from deliveries, not cash received from the carrier.</span>
      </p>
      {warnings.length > 0 && (
        <details className="rounded-xl border border-line bg-brand-50/50 p-3">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">{warnings.length} {warnings.length === 1 ? "note" : "notes"} about this data</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
