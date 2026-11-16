import React, { useEffect, useRef, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { newRequestId } from "../../../utils/requestId.js";
import { toLocalDateString } from "../../../utils/dateRange.js";
import { formatMoney } from "../../../utils/money.js";
import { Field, inputClass, buttonClass } from "../payroll/formParts.jsx";

export const REASON_MIN = 10;
export const REASON_MAX = 180;

// "Force mark as paid" for one driver of a pay run: a super admin records that the driver IS paid although the system cannot confirm it (a payment that is
// processing, unconfirmed, failed or held, or one made outside NASA). It needs a date, a written reason and an explicit confirmation, and it sends nothing to
// Everee or QuickBooks. The server checks the role again and decides; this only collects the answers and shows what the server says.
export default function ForcePaymentPanel({ runId, driver, onDone }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => toLocalDateString(new Date()));
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  // One request ID per attempt at the same answers: a repeated click or a lost reply cannot record the payment twice.
  const requestId = useRef(newRequestId());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const amount = formatMoney(driver.amounts.net);
  const valid = Boolean(date) && reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX && confirmed;
  const change = (setter) => (value) => { setter(value); requestId.current = newRequestId(); setErrors({}); setMessage(""); };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      await axios.post(`/admin/payroll/payments/runs/${runId}/force-paid`, {
        requestId: requestId.current, paidOn: date, reason: reason.trim(), confirmed: true, statementIds: [driver.statementId],
      });
      if (mounted.current) setOpen(false);
      onDone?.();
    } catch (error) {
      if (!mounted.current) return;
      setErrors(error.response?.data?.errors ?? {});
      setMessage(error.response?.data?.message || "The payment could not be marked as paid. Check your connection and try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-red-700 underline">
        Force mark as paid
      </button>
    );
  }
  // Enter inside these fields must not submit the payment dialog's own form.
  const keepForm = (event) => { if (event.key === "Enter" && event.target.tagName === "INPUT" && event.target.type !== "checkbox") event.preventDefault(); };
  return (
    <div role="group" aria-label={`Force mark ${driver.driverName} as paid`} onKeyDown={keepForm} className="mt-2 space-y-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
      <p className="font-semibold text-red-800">Force mark {driver.driverName} as paid</p>
      <p className="text-red-900">
        Use this only when {driver.driverName} has been paid, or will be paid, outside NASA. {amount} is recorded as paid and nothing is sent to Everee or QuickBooks.
        If an Everee payment is still processing, the driver could be paid twice.
      </p>
      <Field label="Date paid" error={errors.paidOn}>
        <input type="date" value={date} max={toLocalDateString(new Date())} disabled={busy} onChange={(e) => change(setDate)(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Reason" error={errors.reason}>
        <input type="text" value={reason} maxLength={REASON_MAX} disabled={busy} placeholder="For example: paid in cash at the depot on Friday"
          onChange={(e) => change(setReason)(e.target.value)} className={inputClass} />
      </Field>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => change(setConfirmed)(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
        <span>I confirm that {driver.driverName} is paid {amount} and that this cannot be undone here.</span>
      </label>
      {errors.confirmed && <p role="alert" className="text-red-700">{errors.confirmed}</p>}
      {message && <p role="alert" className="font-semibold text-red-700">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!valid || busy} onClick={submit}
          className="min-h-11 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Marking…" : "Mark as paid"}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className={buttonClass}>Cancel</button>
      </div>
    </div>
  );
}
