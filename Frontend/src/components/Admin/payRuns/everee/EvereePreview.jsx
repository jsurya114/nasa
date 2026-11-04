import React from "react";
import { formatMoney } from "../../../../utils/money.js";
import { primaryClass } from "../../payroll/formParts.jsx";
import { blockerLines, sentence } from "./evereeLabels.js";

// What the confirm click would pay: taken from the server, never from this page. The button names the exact count and total.
export default function EvereePreview({ preview, busy, message, onConfirm }) {
  const { summary, drivers, batchBlockers, confirm, environment } = preview;
  const canConfirm = preview.canSubmit && confirm.allowed && !busy;
  const eligible = drivers.filter((d) => d.eligible);
  const blocked = drivers.filter((d) => !d.eligible);
  const claims = summary.pendingClaims?.total ?? 0;
  return (
    <section aria-label="Everee payment preview" className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
      <h3 className="font-bold">Pay with Everee</h3>
      <p className="mt-1 text-sm">
        {environment === "production"
          ? "Live: these payments move real money once the payroll run is approved in Everee."
          : "Sandbox: Everee's test environment. No real money moves."}
      </p>
      {batchBlockers.map((b) => <p key={b.code} role="alert" className="mt-2 rounded-xl bg-white p-3 text-sm text-red-700">{sentence(b.message)}</p>)}
      {!confirm.allowed && <p role="alert" className="mt-2 rounded-xl bg-white p-3 text-sm text-red-700">{sentence(confirm.reason)}</p>}
      <p className="mt-3 text-sm">{summary.eligible} of {summary.drivers} drivers can be paid now, {formatMoney(summary.total)} in total.</p>
      {(claims > 0 || summary.withWarnings > 0) && (
        <div role="note" aria-label="Read before confirming" className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Read before confirming. These do not stop the payment.</p>
          {claims > 0 && <p className="mt-1">{claims} city {claims === 1 ? "claim is" : "claims are"} still unresolved. {claims === 1 ? "It is" : "They are"} not deducted in these payments.</p>}
          {summary.withWarnings > 0 && <p className="mt-1">{summary.withWarnings} of the drivers below {summary.withWarnings === 1 ? "has a warning" : "have warnings"}; they are paid unless you leave them out by fixing the cause first.</p>}
        </div>
      )}
      {eligible.length > 0 && (
        <ul aria-label="Drivers that will be paid" className="mt-2 divide-y divide-line rounded-xl bg-white px-3">
          {eligible.map((d) => (
            <li key={d.statementId} className="py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span>{d.driverName}</span>
                <span className="font-bold tabular-nums">{formatMoney(d.amount)}</span>
              </div>
              {blockerLines(d).map((line) => <p key={line} className="mt-0.5 text-xs text-amber-800">{line}</p>)}
            </li>
          ))}
        </ul>
      )}
      {blocked.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold">Not included ({blocked.length})</p>
          <ul aria-label="Drivers that will not be paid" className="mt-1 divide-y divide-line rounded-xl bg-white px-3">
            {blocked.map((d) => (
              <li key={d.statementId} className="py-2 text-sm">
                <span className="font-semibold">{d.driverName}</span> · <span className="tabular-nums">{formatMoney(d.amount)}</span>
                {blockerLines(d).map((line) => <p key={line} className="text-ink-muted">{line}</p>)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {message && <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-sm text-red-700">{message}</p>}
      <button type="button" disabled={!canConfirm} onClick={onConfirm} className={`${primaryClass} mt-4`}>
        {busy ? "Sending…" : `Confirm and pay ${summary.eligible} ${summary.eligible === 1 ? "driver" : "drivers"}, ${formatMoney(summary.total)}`}
      </button>
      <p className="mt-2 text-xs text-ink-muted">Marking payments paid by hand is separate: use “Mark as paid” for money you paid outside Everee.</p>
    </section>
  );
}
