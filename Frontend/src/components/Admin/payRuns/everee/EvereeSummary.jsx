import React from "react";
import { formatMoney } from "../../../../utils/money.js";
import { blockerLines, sentence } from "./evereeLabels.js";

// What paying the chosen drivers through Everee would do, taken from the server's preview, never from this page: how many can be paid, the
// total, what stops anyone, and what to read first. The Pay button of the dialog sends exactly this preview.
export default function EvereeSummary({ preview, loading, error }) {
  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (loading || !preview) return <p role="status" className="text-sm text-ink-muted">Checking these drivers with Everee…</p>;
  const { summary, drivers, batchBlockers, environment } = preview;
  const eligible = drivers.filter((d) => d.eligible);
  const blocked = drivers.filter((d) => !d.eligible);
  const claims = summary.pendingClaims?.total ?? 0;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {environment === "production"
          ? "Live: these payments move real money once the payroll run is approved in Everee."
          : "Sandbox: Everee's test environment. No real money moves."}
      </p>
      {batchBlockers.map((b) => <p key={b.code} role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{sentence(b.message)}</p>)}
      <p>{summary.eligible} of {summary.drivers} selected {summary.drivers === 1 ? "driver" : "drivers"} can be paid now, {formatMoney(summary.total)} in total.</p>
      {blocked.map((d) => (
        <div key={d.statementId} className="rounded-xl bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">{d.driverName} cannot be paid yet</p>
          {blockerLines(d).map((line) => <p key={line}>{line}</p>)}
          {d.worker && !d.worker.linked && <p className="mt-1 text-xs">Drivers are matched to Everee by email and phone number, never by name. Check this driver's details first.</p>}
        </div>
      ))}
      {(claims > 0 || summary.withWarnings > 0) && (
        <div role="note" aria-label="Read before paying" className="rounded-xl bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">Read before paying. These do not stop the payment.</p>
          {claims > 0 && <p className="mt-1">{claims} city {claims === 1 ? "claim is" : "claims are"} still unresolved. {claims === 1 ? "It is" : "They are"} not deducted in these payments.</p>}
          {summary.withWarnings > 0 && <p className="mt-1">{summary.withWarnings} of the drivers {summary.withWarnings === 1 ? "has a warning" : "have warnings"}; they are paid unless you leave them out by fixing the cause first.</p>}
        </div>
      )}
      {eligible.length > 0 && (
        <ul aria-label="Drivers that will be paid" className="divide-y divide-line rounded-xl border border-line bg-white px-3">
          {eligible.map((d) => (
            <li key={d.statementId} className="py-2">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{d.driverName}</span>
                <span className="font-bold tabular-nums">{formatMoney(d.amount)}</span>
              </div>
              {blockerLines(d).map((line) => <p key={line} className="mt-1 text-amber-800">{line}</p>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
