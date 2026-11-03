import React, { useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { newRequestId } from "../../../utils/requestId.js";
import { toLocalDateString } from "../../../utils/dateRange.js";
import { Field, buttonClass, inputClass, primaryClass } from "./formParts.jsx";

const METHODS = [
  { value: "payroll", label: "Deducted through payroll" },
  { value: "outside_repayment", label: "Repaid outside payroll" },
  { value: "waiver", label: "Waived by NASA" },
];

// "Mark complete" is never a bare checkbox (#166): the admin says how the amount was settled, and for how much. Payroll
// deductions settle on their own when a pay run is finalized; the other two are recorded here, against this entry only.
export default function SettlePanel({ entry, isSuperAdmin, onDone, onCancel }) {
  const [method, setMethod] = useState("outside_repayment");
  const [form, setForm] = useState({ requestId: newRequestId(), amount: String(entry.outstanding), settledOn: toLocalDateString(new Date()), reference: "", reason: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await axios.post(`/admin/payroll/ledger/${entry.id}/settlements`, {
        requestId: form.requestId, kind: method, amount: form.amount, settledOn: form.settledOn, reason: form.reason,
        ...(method === "outside_repayment" && { reference: form.reference }),
      });
      toast.success(method === "waiver" ? "Waiver recorded" : "Repayment recorded");
      onDone();
    } catch (err) {
      setErrors(err.response?.data?.errors ?? {});
      toast.error(err.response?.data?.message ?? "It could not be saved; try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-line bg-canvas p-3 sm:grid-cols-2" noValidate aria-label="Mark complete">
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-gray-700">How was it settled?</legend>
        {METHODS.map((m) => {
          const blocked = m.value === "waiver" && !isSuperAdmin;
          return (
            <label key={m.value} className={`flex min-h-11 items-center gap-2 text-sm ${blocked ? "text-gray-400" : "text-gray-800"}`}>
              <input type="radio" name={`method-${entry.id}`} className="h-5 w-5" checked={method === m.value} disabled={blocked} onChange={() => setMethod(m.value)} />
              {m.label}{blocked && " (super admin only)"}
            </label>
          );
        })}
      </fieldset>
      {method === "payroll" ? (
        <p className="text-sm text-gray-700 sm:col-span-2">
          A deduction through payroll is allocated when a pay run is finalized, and counts as settled only once the payment is confirmed.
          Nothing is recorded here, and an amount allocated to an approved pay run cannot also be recorded as repaid or waived.
        </p>
      ) : (
        <>
          <Field label="Amount settled (USD)" error={errors.amount}>
            <input className={inputClass} inputMode="decimal" value={form.amount} onChange={set("amount")} />
          </Field>
          <Field label="Date" error={errors.settledOn}>
            <input type="date" className={inputClass} value={form.settledOn} onChange={set("settledOn")} />
          </Field>
          {method === "outside_repayment" && (
            <Field label="Payment reference" error={errors.reference}>
              <input className={inputClass} value={form.reference} onChange={set("reference")} maxLength={200} />
            </Field>
          )}
          <Field label={method === "waiver" ? "Reason for the waiver" : "Reason"} error={errors.reason}>
            <input className={inputClass} value={form.reason} onChange={set("reason")} maxLength={500} />
          </Field>
          <p className="text-xs text-gray-600 sm:col-span-2">Only this amount clears; the rest of the entry stays outstanding. It cannot also be taken from pay.</p>
        </>
      )}
      <div className="flex gap-2 sm:col-span-2">
        {method !== "payroll" && <button type="submit" className={primaryClass} disabled={saving}>{saving ? "Saving…" : method === "waiver" ? "Record waiver" : "Record repayment"}</button>}
        <button type="button" className={buttonClass} onClick={onCancel}>Close</button>
      </div>
    </form>
  );
}
