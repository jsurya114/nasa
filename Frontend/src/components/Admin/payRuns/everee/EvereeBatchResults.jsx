import React from "react";
import { formatMoney } from "../../../../utils/money.js";
import { buttonClass } from "../../payroll/formParts.jsx";
import { ITEM_STATUS, TONE_CLASS } from "./evereeLabels.js";

// What happened to one payment batch, driver by driver. A sent payment is never called paid until Everee confirms the deposit.
export default function EvereeBatchResults({ view, busy, onCheck, onRetry }) {
  const { batch, counts, items } = view;
  const waiting = counts.submitted + counts.unconfirmed;
  const returned = items.filter((i) => i.everee?.depositReturned);
  const successful = Math.max(0, counts.paid - returned.filter((i) => i.status === "paid").length);
  const needsCheck = waiting > 0 || returned.length > 0;
  return (
    <section aria-label="Everee payment results" className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">
            Sent {new Date(batch.createdAt).toLocaleString()} · {batch.drivers} {batch.drivers === 1 ? "driver" : "drivers"} · {formatMoney(batch.total)}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            {successful} successful · {counts.submitted} sent, waiting · {counts.unconfirmed} unconfirmed · {counts.failed} not sent
            {returned.length > 0 && ` · ${returned.length} returned`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {needsCheck && <button type="button" disabled={busy} onClick={onCheck} className={buttonClass}>Check now</button>}
          {view.canRetry && <button type="button" disabled={busy} onClick={onRetry} className={buttonClass}>Retry what failed</button>}
        </div>
      </div>
      {needsCheck && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {waiting > 0 ? "Approve the payroll run in the Everee portal." : "The returned deposit needs attention in Everee."}{" "}
          A payment is successful only when Everee confirms settlement. Everee is checked every 15 minutes and this window refreshes by itself every minute; or press Check now.
        </p>
      )}
      <ul className="mt-3 divide-y divide-line">
        {items.map((i) => {
          const s = ITEM_STATUS[i.everee?.depositReturned ? "returned" : i.status] ?? ITEM_STATUS.not_submitted;
          return (
            <li key={i.itemId} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-semibold">{i.driverName}</p>
                <p className="text-ink-muted">{s.help}</p>
                {i.everee?.depositReturned && <p className="font-semibold text-red-700">A bank returned this deposit. Everee retries it once the driver fixes their bank details.</p>}
                {i.error && <p className="text-red-700">{i.error}</p>}
                {i.note && <p className="text-ink-muted">{i.note}</p>}
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{formatMoney(i.amount)}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[s.tone]}`}>{s.label}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
