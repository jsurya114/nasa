import React, { useState } from "react";
import Modal from "../../../reuse/Modal.jsx";
import { formatCount, formatUsd } from "../insights/insightsFormat.js";
import { listUnallocated, messageFor, rematchStatement, voidStatement } from "./statementsApi.js";
import { STATUS_LABELS } from "./statementText.js";

const BUTTON = "min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50";

function Figure({ label, value, id }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="font-semibold tabular-nums" data-testid={id}>{formatUsd(value)}</dd></div>;
}

// The unmatched money of one statement and why, largest first.
function Unallocated({ lines }) {
  if (lines.length === 0) return <p className="text-sm text-ink-muted">Everything on this statement matched NASA's records.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm" data-testid="unallocated-table">
        <caption className="sr-only">Unallocated carrier revenue</caption>
        <thead><tr className="border-b border-line text-ink-muted"><th scope="col" className="py-1 pr-3">Delivery ID</th><th scope="col" className="py-1 pr-3">Day</th><th scope="col" className="py-1 pr-3">Route</th><th scope="col" className="py-1 pr-3">Why</th><th scope="col" className="py-1 text-right">Revenue</th></tr></thead>
        <tbody>{lines.map((l) => <tr key={`${l.deliveryId}-${l.day}-${l.route}`} className="border-b border-line/60"><td className="py-1 pr-3">{l.deliveryId}</td><td className="py-1 pr-3">{l.day}</td><td className="py-1 pr-3">{l.route ?? "None"}</td><td className="py-1 pr-3">{l.reason}</td><td className="py-1 text-right tabular-nums">{formatUsd(l.revenue)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Statement({ statement: s, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [lines, setLines] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const e = s.economics;
  const published = s.status === "published";
  const run = async (action) => { setBusy(true); setNote(null); try { await action(); } catch (error) { setNote(messageFor(error)); } finally { setBusy(false); } };
  const toggleLines = () => (lines ? setLines(null) : run(async () => setLines(await listUnallocated(s.id))));
  const rematch = () => run(async () => { const matched = await rematchStatement(s.id); setNote(matched > 0 ? `${matched} group${matched === 1 ? "" : "s"} matched now.` : "Nothing new to match."); onChanged(); });
  const confirmVoid = () => run(async () => { await voidStatement(s.id, reason.trim()); setVoiding(false); onChanged(); });

  return (
    <li className="space-y-3 rounded-xl border border-line p-3 sm:p-4" data-testid={`statement-${s.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">{s.city} · {s.billingWeek} <span className="font-normal text-ink-muted">({s.periodStart} to {s.periodEnd})</span></h3>
        <span className="text-sm text-ink-muted">Bill {s.billNumber} · version {s.version} · {STATUS_LABELS[s.status]}{s.origin === "backfill" ? " · backfilled" : ""}</span>
      </div>
      {s.status === "voided" && <p className="text-sm text-ink-muted">Voided: {s.voidReason}</p>}
      {e && (
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2" aria-label="Statement figures">
          <Figure id="fig-revenue" label="Delivery revenue" value={e.deliveryRevenue} />
          <Figure id="fig-driver" label="Driver earnings" value={e.driverEarnings} />
          <Figure id="fig-margin" label={`Delivery margin (before claims and adjustments)${e.marginStatus === "provisional" ? " · provisional" : ""}`} value={e.deliveryMargin} />
          <Figure id="fig-claims" label="Carrier claims" value={e.carrierClaims} />
          <Figure id="fig-adjustments" label="Ledger adjustments" value={e.ledgerAdjustments} />
          <Figure id="fig-contribution" label={`Contribution${e.marginStatus === "provisional" ? " · provisional" : ""}`} value={e.contribution} />
          <Figure id="fig-payable" label="GOFO settlement payable" value={e.settlementPayable} />
          <Figure id="fig-after-insurance" label="Driver earnings after insurance" value={e.driverEarningsAfterInsurance} />
          <Figure id="fig-unallocated" label="Unallocated revenue" value={e.unallocatedRevenue} />
          <div className="flex justify-between gap-3"><dt className="text-ink-muted">NASA deliveries · carrier count</dt><dd className="font-semibold tabular-nums" data-testid="fig-deliveries">{formatCount(e.nasaDeliveries)} · {formatCount(e.carrierDeliveries)}</dd></div>
        </dl>
      )}
      {e?.economicsAvailable === false && <p className="text-xs text-ink-muted" data-testid="economics-unavailable">{e.unavailableReason}</p>}
      {e?.marginStatus === "provisional" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="margin-provisional">
          <p className="font-semibold">Margin and contribution are provisional: driver cost is not fully known.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{e.marginReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      {e?.recordsWithoutBilledFee > 0 && <p className="text-xs text-ink-muted">{e.recordsWithoutBilledFee} NASA record{e.recordsWithoutBilledFee === 1 ? "" : "s"} in this week had no fee on the statement (zero revenue). The carrier's count includes offset tickets; NASA keeps its own delivery count.</p>}
      {note && <p role="status" className="text-sm text-ink">{note}</p>}
      <div className="flex flex-wrap gap-2">
        {s.unallocatedGroups > 0 && <button type="button" className={BUTTON} disabled={busy} aria-expanded={Boolean(lines)} onClick={toggleLines}>{lines ? "Hide unallocated" : `Show unallocated (${s.unallocatedGroups})`}</button>}
        {published && s.unallocatedGroups > 0 && <button type="button" className={BUTTON} disabled={busy} onClick={rematch}>Match again</button>}
        {published && <button type="button" className={BUTTON} disabled={busy} onClick={() => { setReason(""); setVoiding(true); }}>Void</button>}
      </div>
      {lines && <Unallocated lines={lines} />}
      {voiding && (
        <Modal title="Void this statement" onClose={() => setVoiding(false)} busy={busy}>
          <p className="text-sm text-ink">Voiding keeps the statement as history but stops using it for revenue, and its weeks go back to estimated figures. Give a reason (at least 5 characters).</p>
          <label className="mt-3 block text-sm font-medium" htmlFor={`void-reason-${s.id}`}>Reason</label>
          <input id={`void-reason-${s.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3" />
          {note && <p role="alert" className="mt-2 text-sm text-red-700">{note}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={BUTTON} onClick={() => setVoiding(false)} disabled={busy}>Keep it</button>
            <button type="button" className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || reason.trim().length < 5} onClick={confirmVoid}>Void statement</button>
          </div>
        </Modal>
      )}
    </li>
  );
}

export default function StatementList({ statements, onChanged }) {
  return <ul className="space-y-3" aria-label="Carrier statements">{statements.map((s) => <Statement key={s.id} statement={s} onChanged={onChanged} />)}</ul>;
}
