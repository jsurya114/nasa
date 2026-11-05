import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import InfoTip from "../../../reuse/InfoTip.jsx";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import { describeChange, formatCount, formatDecimal, formatPercent, formatUsd } from "./insightsFormat.js";
import { daysInRange, describeRange, previousRange } from "./insightsDates.js";

const TONE = {
  up: { Icon: ArrowUpRight, className: "text-emerald-700" },
  down: { Icon: ArrowDownRight, className: "text-red-700" },
  flat: { Icon: Minus, className: "text-ink-muted" },
  none: { Icon: null, className: "text-ink-muted" },
};

// What a card says about the previous equal-length period. Colour is never the only signal: the arrow and the sign carry it too.
function Change({ comparison, field, kind, previousLabel }) {
  const { tone, text, note } = describeChange(comparison, field, kind);
  const { Icon, className } = TONE[tone];
  return (
    <p className={`mt-2 flex flex-wrap items-center gap-x-1 text-sm ${className}`}>
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      <span className="font-semibold tabular-nums">{text}</span>
      <span className="text-ink-muted">vs {previousLabel}</span>
      {note && <span className="w-full text-xs text-ink-muted">{note}</span>}
    </p>
  );
}

function Card({ id, label, value, tip, children, large = false }) {
  return (
    <div className="card-surface p-4" data-testid={`kpi-${id}`}>
      <h3 className="flex items-center text-sm font-medium text-ink-muted">{label}{tip && <InfoTip label={label} text={tip} />}</h3>
      <p className={`mt-1 font-bold tabular-nums text-ink ${large ? "text-3xl" : "text-2xl"}`} aria-label={`${label}: ${value}`}>{value}</p>
      {children}
    </div>
  );
}

const tipOf = (definitions, id) => {
  const d = definitions?.find((x) => x.id === id);
  return d ? [d.definition, ...(d.caveats ?? [])].join(" ") : undefined;
};

export default function KpiCards({ status, report, message, onRetry, range, definitions }) {
  if (status === "loading" || status === "idle") {
    return (
      <div aria-busy="true" role="status" aria-label="Loading figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="card-surface space-y-3 p-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-44" /></div>)}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="card-surface p-5">
        <p className="font-semibold text-ink">The figures could not be loaded</p>
        <p className="mt-1 text-sm text-ink-muted">{message}</p>
        <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20">Try again</button>
      </div>
    );
  }
  const d = report.data;
  if (d.records.total === 0) {
    return (
      <div className="card-surface p-6 text-center" data-testid="insights-empty">
        <p className="text-lg font-semibold text-ink">No delivery records in this period</p>
        <p className="mt-1 text-sm text-ink-muted">Nothing is shown as zero because of a measurement: there is simply no data for these filters. Try another period, city or source.</p>
      </div>
    );
  }
  const days = daysInRange(range);
  const previousLabel = `previous ${days} ${days === 1 ? "day" : "days"} (${describeRange(previousRange(range))})`;
  const cmp = d.comparison;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card id="revenue" large label="Earned delivery revenue" value={formatUsd(d.earnedDeliveryRevenue)} tip={tipOf(definitions, "earned_delivery_revenue")}>
        <Change comparison={cmp} field="earnedDeliveryRevenue" kind="money" previousLabel={previousLabel} />
      </Card>
      <Card id="deliveries" large label="Completed deliveries" value={formatCount(d.deliveries)} tip={tipOf(definitions, "completed_deliveries")}>
        <Change comparison={cmp} field="deliveries" kind="count" previousLabel={previousLabel} />
      </Card>
      <Card id="margin" large label="Gross profit before overheads" value={formatUsd(d.grossMarginBeforeOverheads)} tip={tipOf(definitions, "gross_margin")}>
        <p className="mt-1 text-sm text-ink-muted" data-testid="margin-percent">Margin {formatPercent(d.marginPercentage)} of revenue</p>
        <Change comparison={cmp} field="grossMarginBeforeOverheads" kind="money" previousLabel={previousLabel} />
      </Card>
      <Card id="drivers" label="Active drivers" value={formatCount(d.activeDrivers)} tip={tipOf(definitions, "active_drivers")} />
      <Card id="per-day" label="Deliveries per active driver-day" value={formatDecimal(d.deliveriesPerActiveDriverDay)} tip={tipOf(definitions, "deliveries_per_active_day")} />
      <Card id="per-delivery" label="Revenue and margin per delivery" value={`${formatUsd(d.revenuePerDelivery)} · ${formatUsd(d.marginPerDelivery)}`}>
        <p className="mt-1 text-xs text-ink-muted">Over the deliveries that have stored amounts.</p>
      </Card>
    </div>
  );
}
