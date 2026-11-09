import React from "react";
import { formatMoney } from "../../../../utils/money.js";

// What recording the chosen Desi drivers in QuickBooks would do, taken from the server's preview, never from this page: how many can be recorded, the total, and
// what stops anyone. The Pay button of the dialog sends exactly this preview.
export default function QuickbooksSummary({ preview, loading, error }) {
  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (loading || !preview) return <p role="status" className="text-sm text-ink-muted">Checking these drivers with QuickBooks…</p>;
  const { summary, drivers, batchBlockers, environment } = preview;
  const eligible = drivers.filter((d) => d.eligible);
  const blocked = drivers.filter((d) => !d.eligible);
  const claims = summary.pendingClaims?.total ?? 0;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {environment === "production"
          ? "Live: this records a bill and a bill payment in your real QuickBooks company, which feeds the 1099 reports."
          : "Sandbox: QuickBooks' test company. Nothing reaches your real books."}
      </p>
      {batchBlockers.map((b) => <p key={b.code} role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{b.message}</p>)}
      <p>{summary.eligible} of {summary.drivers} selected {summary.drivers === 1 ? "driver" : "drivers"} can be recorded now, {formatMoney(summary.total)} in total.</p>
      {blocked.map((d) => (
        <div key={d.statementId} className="rounded-xl bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">{d.driverName} cannot be recorded yet</p>
          {d.blockers.filter((b) => b.severity === "blocking").map((b) => <p key={b.code}>{b.message}</p>)}
        </div>
      ))}
      {claims > 0 && <p role="note" className="rounded-xl bg-amber-50 p-3 text-amber-900">{claims} city {claims === 1 ? "claim is" : "claims are"} still unresolved. {claims === 1 ? "It is" : "They are"} not deducted in these payments.</p>}
      {eligible.length > 0 && (
        <ul aria-label="Drivers that will be recorded" className="divide-y divide-line rounded-xl border border-line bg-white px-3">
          {eligible.map((d) => (
            <li key={d.statementId} className="flex justify-between gap-2 py-2">
              <span className="font-semibold">{d.driverName}</span>
              <span className="font-bold tabular-nums">{formatMoney(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
