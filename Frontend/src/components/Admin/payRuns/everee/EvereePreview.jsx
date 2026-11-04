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
      {eligible.length > 0 && (
        <ul aria-label="Drivers that will be paid" className="mt-2 divide-y divide-line rounded-xl bg-white px-3">
          {eligible.map((d) => (
            <li key={d.statementId} className="flex justify-between gap-2 py-2 text-sm">
              <span>{d.driverName}</span>
              <span className="font-bold tabular-nums">{formatMoney(d.amount)}</span>
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
