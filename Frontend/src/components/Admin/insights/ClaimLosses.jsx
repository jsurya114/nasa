import React from "react";
import InfoTip from "../../../reuse/InfoTip.jsx";
import { Skeleton } from "../../../reuse/Skeleton.jsx";
import { formatCount, formatUsd } from "./insightsFormat.js";

const tipOf = (definitions, id) => {
  const d = definitions?.find((x) => x.id === id);
  return d ? [d.definition, ...(d.caveats ?? [])].join(" ") : undefined;
};

const isZero = (value) => value === null || value === undefined || Number(value) === 0;

// The lines of the breakdown, in the order the owner reads them. `level` 1 is indented under the line above it. Nothing is added up here: every amount
// is the server's exact text, and the total row is the server's total too.
function lossLines(d) {
  const claims = d.claimLosses;
  const lines = [
    { id: "unrecovered", label: "Claims not taken back from drivers", amount: claims.unrecovered.amount, count: claims.unrecovered.claims, note: "The carrier charged NASA, and no finalized pay run has deducted it from the driver yet." },
    { id: "likely-lost", level: 1, label: `Driver gone or not delivering for ${d.inactiveDays}+ days (likely lost)`, amount: claims.unrecovered.likelyLost.amount, count: claims.unrecovered.likelyLost.claims },
    { id: "recoverable", level: 1, label: "Driver still working (still recoverable)", amount: claims.unrecovered.stillRecoverable.amount, count: claims.unrecovered.stillRecoverable.claims },
    { id: "unmatched", label: "Claims no driver is matched to", amount: claims.unmatched.amount, count: claims.unmatched.claims, note: claims.unmatched.oldestClaimDate ? `Nobody can be charged until they are matched. Oldest: ${claims.unmatched.oldestClaimDate}.` : "Nobody can be charged until they are matched." },
    { id: "exempt", label: "Claims NASA absorbs by agreement", amount: claims.exemptAbsorbed.amount, count: claims.exemptAbsorbed.claims, note: "DFW GOFO + Tracking interruption: paid to the carrier, never charged to a driver." },
  ];
  if (d.insurance.available) {
    lines.push({
      id: "insurance", label: "Driver insurance not recovered", amount: d.insurance.notRecovered,
      note: d.insurance.statements === 0 ? "No carrier statement with a Driver Service Fee ends in this period."
        : `The carrier charged ${formatUsd(d.insurance.carrierPremium)} and ${formatUsd(d.insurance.withheldFromDrivers)} was withheld from drivers.`,
    });
  }
  return lines;
}

function Figure({ id, label, value, tip, tone = "ink", large = false, children }) {
  const colour = tone === "loss" ? "text-red-700" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-white p-4" data-testid={`loss-${id}`}>
      <h3 className="flex items-center text-sm font-medium text-ink-muted">{label}{tip && <InfoTip label={label} text={tip} />}</h3>
      <p className={`mt-1 font-bold tabular-nums ${colour} ${large ? "text-3xl" : "text-2xl"}`} aria-label={`${label}: ${value}`}>{value}</p>
      {children}
    </div>
  );
}

// "Claim losses": what the carrier charged NASA and has not been taken back from a driver (plus claims nobody can be charged and unrecovered driver
// insurance), with the approved delivery margin beside the margin after those losses. Read only; it changes no claim, pay run or payment.
export default function ClaimLosses({ status, report, message, onRetry, definitions }) {
  return (
    <section aria-labelledby="claim-losses-title" className="card-surface space-y-4 p-4 sm:p-5" data-testid="claim-losses">
      <div>
        <h2 id="claim-losses-title" className="text-lg font-bold text-ink">Claim losses and profit</h2>
        <p className="text-sm text-ink-muted">What the carrier charged NASA that has not come back from drivers. The delivery margin above is not changed; the line below takes these losses off it.</p>
      </div>

      {(status === "loading" || status === "idle") && (
        <div aria-busy="true" role="status" aria-label="Loading claim losses" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {status === "error" && (
        <div role="alert">
          <p className="font-semibold text-ink">The claim losses could not be loaded</p>
          <p className="mt-1 text-sm text-ink-muted">{message}</p>
          <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20">Try again</button>
        </div>
      )}

      {status === "ready" && report && <Ready d={report.data} warnings={report.meta?.warnings ?? []} definitions={definitions} />}
    </section>
  );
}

function Ready({ d, warnings, definitions }) {
  const lines = lossLines(d);
  const margin = d.margin;
  const none = isZero(margin.totalLosses);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure id="margin" label="Delivery margin" value={formatUsd(margin.grossMarginBeforeOverheads)} tip={tipOf(definitions, "delivery_margin")}>
          <p className="mt-1 text-xs text-ink-muted">Gross profit before overheads, as approved.</p>
        </Figure>
        <Figure id="total" label="Claim losses" value={formatUsd(margin.totalLosses)} tone={none ? "ink" : "loss"} tip={tipOf(definitions, "claim_losses")}>
          <p className="mt-1 text-xs text-ink-muted">{none ? "Nothing is outstanding in this period." : "Taken off the margin."}</p>
        </Figure>
        <Figure id="profit" large label="Profit after claim losses" value={formatUsd(margin.profitAfterClaimLosses)} tip={tipOf(definitions, "profit_after_claim_losses")}>
          <p className="mt-1 text-xs text-ink-muted">{margin.profitAfterClaimLosses === null ? "No delivery margin in this period, so no profit is shown." : "Not net profit: overheads are not recorded."}</p>
        </Figure>
      </div>

      {none ? (
        <p className="text-sm text-ink-muted" data-testid="losses-empty">No claim losses for these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm" data-testid="loss-breakdown">
            <caption className="sr-only">Where the claim losses come from</caption>
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Loss</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Claims</th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line/60 align-top" data-testid={`loss-line-${line.id}`}>
                  <th scope="row" className={`py-2 pr-3 font-medium text-ink ${line.level ? "pl-6 font-normal" : ""}`}>
                    {line.label}
                    {line.note && <span className="block text-xs font-normal text-ink-muted">{line.note}</span>}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{line.count === undefined ? "" : formatCount(line.count)}</td>
                  <td className="py-2 pl-3 text-right font-semibold tabular-nums text-ink">{formatUsd(line.amount)}</td>
                </tr>
              ))}
              <tr className="font-bold" data-testid="loss-line-total">
                <th scope="row" className="py-2 pr-3 text-ink">Total claim losses</th>
                <td className="px-3 py-2" />
                <td className="py-2 pl-3 text-right tabular-nums text-red-700">{formatUsd(margin.totalLosses)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {d.byCity.length > 0 && (
        <details className="rounded-xl border border-line bg-white p-3" data-testid="loss-by-city">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-brand">Claim losses by city</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">City</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Not taken back</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">No driver</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Absorbed</th>
                  <th scope="col" className="py-2 pl-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.byCity.map((c) => (
                  <tr key={c.cityId} className="border-b border-line/60">
                    <th scope="row" className="py-2 pr-3 font-medium text-ink">{c.name}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(c.unrecovered)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(c.unmatched)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(c.exemptAbsorbed)}</td>
                    <td className="py-2 pl-3 text-right font-semibold tabular-nums">{formatUsd(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Insurance is not split by city here.</p>
        </details>
      )}

      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-muted" data-testid="loss-notes">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
    </>
  );
}
