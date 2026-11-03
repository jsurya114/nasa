import React, { cloneElement, useId, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { newRequestId } from "../../../utils/requestId.js";
import { toLocalDateString } from "../../../utils/dateRange.js";

// Records one manual ledger entry for the chosen driver and city (#142). The server checks everything again;
// this form only helps fill it in. The request ID is kept until the entry is saved, so a retry is never doubled.
const TYPES = [
  { value: "advance", label: "Advance (driver owes)", debit: true },
  { value: "expense", label: "Expense charged to driver", debit: true },
  { value: "manual_claim", label: "Penalty (entered by hand)", debit: true },
  { value: "advance_repayment", label: "Advance repaid outside payroll", debit: false },
  { value: "reimbursement", label: "Reimbursement (owed to driver)", debit: false },
  { value: "correction", label: "Correction", debit: null },
];

// prefill: fields to start from, for example a refund for a claim listed under "Refunds due".
const blank = (prefill = {}) => ({
  requestId: newRequestId(), type: "advance", direction: "debit", amount: "", reason: "", effectiveDate: toLocalDateString(new Date()),
  intendedPayday: "", disbursedOutsidePayroll: false, recoveryPlan: "", installmentAmount: "", claimType: "", waybill: "", claimCourier: "",
  ...prefill,
});

const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

// The error sits outside the label, so the field keeps its short name; it is linked with aria-describedby.
function Field({ label, error, children }) {
  const errorId = useId();
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {cloneElement(children, { "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined })}
      </label>
      {error && <p id={errorId} className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function LedgerEntryForm({ cityId, driverId, onSaved, prefill }) {
  const [form, setForm] = useState(() => blank(prefill));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const type = TYPES.find((t) => t.value === form.type);
  const isDebit = type.debit === null ? form.direction === "debit" : type.debit;
  // Only a refund (a credit correction) may name the claim it refunds: courier, waybill and claim type together (#149).
  const isRefund = form.type === "correction" && form.direction === "credit";
  const namesClaim = isRefund && Boolean(form.claimCourier || form.waybill || form.claimType);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const body = {
      requestId: form.requestId, cityId, driverId, type: form.type, amount: form.amount, reason: form.reason,
      effectiveDate: form.effectiveDate, intendedPayday: form.intendedPayday || null,
      ...(form.type === "correction" && { direction: form.direction }),
      ...(form.type === "advance" && { disbursedOutsidePayroll: form.disbursedOutsidePayroll }),
      ...(isDebit && form.recoveryPlan && { recoveryPlan: form.recoveryPlan }),
      ...(isDebit && form.recoveryPlan === "installments" && { installmentAmount: form.installmentAmount }),
      ...(form.type === "manual_claim" && { claimType: form.claimType, waybill: form.waybill }),
      ...(namesClaim && { claimType: form.claimType, waybill: form.waybill, claimCourier: form.claimCourier }),
    };
    try {
      await axios.post("/admin/payroll/ledger", body);
      toast.success("Entry recorded");
      setForm(blank());
      onSaved();
    } catch (err) {
      setErrors(err.response?.data?.errors ?? {});
      toast.error(err.response?.data?.message ?? "The entry could not be saved; try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <Field label="Type" error={errors.type}>
        <select className={inputClass} value={form.type} onChange={set("type")}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      {form.type === "correction" && (
        <Field label="Direction" error={errors.direction}>
          <select className={inputClass} value={form.direction} onChange={set("direction")}>
            <option value="debit">Driver owes more</option>
            <option value="credit">Driver owes less / is owed</option>
          </select>
        </Field>
      )}
      <Field label="Amount (USD)" error={errors.amount}>
        <input className={inputClass} inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="0.00" />
      </Field>
      <Field label="Date" error={errors.effectiveDate}>
        <input type="date" className={inputClass} value={form.effectiveDate} onChange={set("effectiveDate")} />
      </Field>
      <Field label="Reason" error={errors.reason}>
        <input className={inputClass} value={form.reason} onChange={set("reason")} maxLength={500} />
      </Field>
      <Field label="Not before payday (optional)" error={errors.intendedPayday}>
        <input type="date" className={inputClass} value={form.intendedPayday} onChange={set("intendedPayday")} />
      </Field>
      {form.type === "manual_claim" && (
        <>
          <Field label="Claim type" error={errors.claimType}>
            <input className={inputClass} value={form.claimType} onChange={set("claimType")} maxLength={100} />
          </Field>
          <Field label="Waybill (optional)" error={errors.waybill}>
            <input className={inputClass} value={form.waybill} onChange={set("waybill")} maxLength={64} />
          </Field>
        </>
      )}
      {isRefund && (
        <fieldset className="grid grid-cols-1 gap-4 rounded-xl border border-line p-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium text-gray-700">Refund for a claim (optional: all three, or none)</legend>
          <Field label="Courier" error={errors.claimCourier}>
            <select className={inputClass} value={form.claimCourier} onChange={set("claimCourier")}>
              <option value="">Not for a claim</option>
              <option value="gofo">GOFO</option>
              <option value="speedx">SpeedX</option>
            </select>
          </Field>
          <Field label="Claim waybill" error={errors.waybill}>
            <input className={inputClass} value={form.waybill} onChange={set("waybill")} maxLength={64} />
          </Field>
          <Field label="Claim type" error={errors.claimType}>
            <input className={inputClass} value={form.claimType} onChange={set("claimType")} maxLength={100} />
          </Field>
        </fieldset>
      )}
      {form.type === "advance" && (
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5" checked={form.disbursedOutsidePayroll} onChange={set("disbursedOutsidePayroll")} />
          Already paid out to the driver outside payroll
        </label>
      )}
      {isDebit && (
        <>
          <Field label="Repayment arrangement" error={errors.recoveryPlan}>
            <select className={inputClass} value={form.recoveryPlan} onChange={set("recoveryPlan")}>
              <option value="">None yet (needs review)</option>
              <option value="full_next_payday">All on the next payday</option>
              <option value="installments">Fixed instalments</option>
            </select>
          </Field>
          {form.recoveryPlan === "installments" && (
            <Field label="Instalment per payday (USD)" error={errors.installmentAmount}>
              <input className={inputClass} inputMode="decimal" value={form.installmentAmount} onChange={set("installmentAmount")} placeholder="0.00" />
            </Field>
          )}
        </>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-dark disabled:bg-gray-400">
          {saving ? "Saving..." : "Record entry"}
        </button>
      </div>
    </form>
  );
}
