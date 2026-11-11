import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import InfoTip from "../../../reuse/InfoTip.jsx";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import { describeChange, formatCount, formatDecimal, formatPercent, formatUsd } from "./insightsFormat.js";
import { daysInRange, describeRange, previousRange } from "./insightsDates.js";
import { ESTIMATED, basisNote, deliveryMarginOf, deliveryRevenueOf, driverEarningsOf, settlementLines } from "./revenueFigures.js";

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

// "Estimated" as a word on a badge, never colour alone.
function EstimatedBadge() {
  return <span data-testid="estimated-badge" className="ml-2 rounded-full border border-amber-600 bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-800">{ESTIMATED}</span>;
}

const tipOf = (definitions, id) => {
  const d = definitions?.find((x) => x.id === id);
  return d ? [d.definition, ...(d.caveats ?? [])].join(" ") : undefined;
};

// Invoice payments received: the saved total of every invoice marked Payment received, once each, by the date it was received. Kept apart from
// delivery revenue (it is not added to it, nor to the margin). Company-wide: invoices have no city or source, so those filters do not narrow it.
function InvoicePayments({ figure, tip }) {
  if (!figure) return null;
  return (
    <Card id="invoice-payments" label="Invoice payments received" value={formatUsd(figure.amount)} tip={tip}>
      <p className="mt-1 text-sm text-ink-muted" data-testid="invoice-payments-basis">
        {figure.invoices} {figure.invoices === 1 ? "invoice" : "invoices"} paid in this period, by payment received date. Not part of delivery revenue.
      </p>
      <p className="mt-1 text-xs text-ink-muted" data-testid="invoice-payments-scope">
        {figure.filtersApply === false ? "Company-wide: the city and source filters do not apply to this figure." : "Company-wide."}
      </p>
    </Card>
  );
}

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
        {Number(d.invoicePaymentsReceived?.amount) > 0 && (
          <p className="mt-2 text-sm text-ink" data-testid="invoice-payments-empty">Invoice payments received in this period (company-wide): {formatUsd(d.invoicePaymentsReceived.amount)}.</p>
        )}
      </div>
    );
  }
  const days = daysInRange(range);
  const previousLabel = `previous ${days} ${days === 1 ? "day" : "days"} (${describeRange(previousRange(range))})`;
  const cmp = d.comparison;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card id="revenue" large label="Delivery revenue" value={formatUsd(deliveryRevenueOf(d))} tip={tipOf(definitions, "delivery_revenue") ?? tipOf(definitions, "earned_delivery_revenue")}>
        {d.revenueIsEstimated && <p className="mt-1"><EstimatedBadge /></p>}
        {basisNote(d) && <p className="mt-1 text-sm text-ink-muted" data-testid="revenue-basis">{basisNote(d)}</p>}
        {d.unallocatedRevenue && <p className="mt-1 text-sm text-ink-muted" data-testid="unallocated-revenue">Includes {formatUsd(d.unallocatedRevenue)} of carrier revenue that matched no driver (unallocated).</p>}
        <Change comparison={cmp} field="earnedDeliveryRevenue" kind="money" previousLabel={previousLabel} />
      </Card>
      <Card id="deliveries" large label="Completed deliveries" value={formatCount(d.deliveries)} tip={tipOf(definitions, "completed_deliveries")}>
        <Change comparison={cmp} field="deliveries" kind="count" previousLabel={previousLabel} />
      </Card>
      <Card id="margin" large label="Delivery margin" value={formatUsd(deliveryMarginOf(d))} tip={tipOf(definitions, "delivery_margin") ?? tipOf(definitions, "gross_margin")}>
        {d.revenueIsEstimated && <p className="mt-1"><EstimatedBadge /></p>}
        <p className="mt-1 text-sm text-ink-muted" data-testid="margin-percent">Margin {formatPercent(d.marginPercentage)} of revenue</p>
        <Change comparison={cmp} field="grossMarginBeforeOverheads" kind="money" previousLabel={previousLabel} />
      </Card>
      <Card id="driver-earnings" label="Driver earnings" value={formatUsd(driverEarningsOf(d))} tip={tipOf(definitions, "gross_driver_earnings")}>
        <p className="mt-1 text-sm text-ink-muted" data-testid="driver-earnings-net">
          {d.driverEarningsAfterInsurance ? `${formatUsd(d.driverEarningsAfterInsurance)} after insurance withholding.` : "Gross, before insurance, claims and advances."}
        </p>
      </Card>
      {d.settlement && (
        <Card id="settlement" label="GOFO settlement payable" value={formatUsd(d.settlement.payable)} tip={tipOf(definitions, "gofo_settlement_payable")}>
          <dl className="mt-1 space-y-0.5 text-sm text-ink-muted" data-testid="settlement-lines">
            {settlementLines(d).map((line) => (
              <div key={line.id} className="flex justify-between gap-3"><dt>{line.label}</dt><dd className="tabular-nums">{formatUsd(line.value)}</dd></div>
            ))}
          </dl>
          <p className="mt-1 text-xs text-ink-muted">By billing week, {d.settlement.statements} statement{d.settlement.statements === 1 ? "" : "s"}. Prepayments and withdrawal fees are not included.</p>
        </Card>
      )}
      <InvoicePayments figure={d.invoicePaymentsReceived} tip={tipOf(definitions, "invoice_payments_received")} />
      <Card id="drivers" label="Active drivers" value={formatCount(d.activeDrivers)} tip={tipOf(definitions, "active_drivers")} />
      <Card id="per-day" label="Deliveries per active driver-day" value={formatDecimal(d.deliveriesPerActiveDriverDay)} tip={tipOf(definitions, "deliveries_per_active_day")} />
      <Card id="per-delivery" label="Revenue and margin per delivery" value={`${formatUsd(d.revenuePerDelivery)} · ${formatUsd(d.marginPerDelivery)}`}>
        <p className="mt-1 text-xs text-ink-muted">Over the deliveries that have stored amounts.</p>
      </Card>
    </div>
  );
}
