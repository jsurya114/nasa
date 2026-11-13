import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "../../../../redux/slice/axiosInstance";
import { formatMoney } from "../../../../utils/money.js";
import { buttonClass } from "../../payroll/formParts.jsx";

// What was recorded on the payment decides the words: a check says "by check", an older cash payment keeps saying "in cash".
const paidWords = (paidBy) => (paidBy === "check" ? "Paid by check" : "Paid in cash");
const interruptedText = (paidBy) => `${paidWords(paidBy)}; sending to QuickBooks was interrupted. Retry`;
const statusText = (status, paidBy) => ({ paid: "Recorded in QuickBooks", submitted: "Being recorded in QuickBooks…", unconfirmed: `${paidWords(paidBy)}; not confirmed in QuickBooks yet. Retry`, failed: `${paidWords(paidBy)}; not recorded in QuickBooks yet. Retry` })[status];
const TONE = { paid: "text-green-700", submitted: "text-ink-muted", interrupted: "font-semibold text-amber-800", unconfirmed: "font-semibold text-amber-800", failed: "font-semibold text-red-700" };

// The QuickBooks record of a payment batch, read back from the server. The drivers were paid (by check, or in cash for older payments) when it was confirmed; this only shows whether QuickBooks has the record. Retry is always safe: the server asks QuickBooks for the bill by its number first, so a
// bill or payment that did land is found and never made twice.
export default function QuickbooksResult({ batchId, onChanged }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(() => axios.get(`/admin/payroll/quickbooks-batches/${batchId}`)
    .then(({ data }) => { if (mounted.current) { setView(data); setError(""); } })
    .catch((e) => { if (mounted.current) setError(e.response?.data?.message ?? "The result could not be loaded."); }), [batchId]);
  useEffect(() => { load(); }, [load]);

  const retry = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`/admin/payroll/quickbooks-batches/${batchId}/retry`);
      if (mounted.current) { setView(data); setError(""); }
      onChanged?.();
    } catch (e) {
      if (mounted.current) setError(e.response?.data?.message ?? "The retry could not be completed. Look at the result before trying again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (error && !view) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!view) return <p role="status" className="text-sm text-ink-muted">Loading the result…</p>;
  const { counts, items, batch } = view;
  return (
    <div className="space-y-3 text-sm">
      <p>{counts.paid} of {batch.drivers} in QuickBooks · {formatMoney(batch.total)} · paid on {batch.paidOn}</p>
      <ul aria-label="QuickBooks results" className="divide-y divide-line rounded-xl border border-line">
        {items.map((i) => (
          <li key={i.itemId} className="p-3">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{i.driverName}</span>
              <span className="font-bold tabular-nums">{formatMoney(i.amount)}</span>
            </div>
            <p className={TONE[i.interrupted ? "interrupted" : i.status]}>{i.interrupted ? interruptedText(i.paidBy) : statusText(i.status, i.paidBy)}</p>
            {i.quickbooks.billId && <p className="text-xs text-ink-muted">QuickBooks bill {i.quickbooks.billId} · number {i.quickbooks.docNumber}</p>}
            {i.error && <p className="text-xs text-amber-800">{i.error}</p>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {view.canRetry && <button type="button" onClick={retry} disabled={busy} className={buttonClass}>{busy ? "Retrying…" : "Retry the QuickBooks record"}</button>}
    </div>
  );
}
