import React, { useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { newRequestId } from "../../../utils/requestId.js";
import { toLocalDateString } from "../../../utils/dateRange.js";
import { formatMoney } from "../../../utils/money.js";
import InfoTip from "../../../reuse/InfoTip.jsx";
import { Field, inputClass } from "./formParts.jsx";
import { cleanMoneyInput } from "./moneyInput.js";

// Records one manual entry for the chosen driver and city: an advance or a penalty. The server checks everything again; this form
// only helps fill it in. The request ID is kept until the entry is saved, so a retry is never doubled.
const TYPES = [
  { value: "advance", label: "Advance" },
  { value: "manual_claim", label: "Penalty" },
];
// A refund chosen from "Refunds due" arrives as a correction. It is not something to pick by hand, so it is offered only then.
const REFUND_TYPE = { value: "correction", label: "Refund for a claim" };

const TIPS = {
  type: "Advance: money given to the driver early that they pay back. Penalty: a charge taken from the driver, for example for a damaged or lost parcel.",
  amount: "How much, in US dollars. It must be more than zero. If it is more than the driver's payment, say how it is repaid.",
  date: "The day this happened. It is shown in the driver's records.",
  reason: "A short note saying why, for example what the penalty was for. The driver can see it.",
  payday: "Optional. Nothing is taken before this payday. Leave it empty to start from the next pay run.",
  arrangement: "How it is taken back from the driver's pay: everything on the next payday, or a fixed amount each payday (instalments).",
  installment: "The amount taken each payday. It must be less than the whole amount.",
  paidOut: "Tick this if the advance was already handed to the driver outside payroll, so recording it does not pay it again.",
  claimType: "What kind of penalty this is, for example Damaged Item or Fake POD.",
  waybill: "Optional. The package's waybill number, if the penalty is about one parcel. It stops the same claim being entered twice.",
};

// prefill: fields to start from, for example a refund for a claim listed under "Refunds due".
const blank = (prefill = {}) => ({
  requestId: newRequestId(), type: "advance", direction: "debit", amount: "", reason: "", effectiveDate: toLocalDateString(new Date()),
  intendedPayday: "", disbursedOutsidePayroll: false, recoveryPlan: "", installmentAmount: "", claimType: "", waybill: "", claimCourier: "",
  ...prefill,
});

const MAX_AMOUNT = 10000;

export default function LedgerEntryForm({ cityId, driverId, onSaved, prefill, payable = "0.00" }) {
  const [form, setForm] = useState(() => blank(prefill));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isRefund = form.type === "correction";
  const types = isRefund ? [...TYPES, REFUND_TYPE] : TYPES;
  const type = types.find((t) => t.value === form.type) ?? REFUND_TYPE;
  const isDebit = !isRefund || form.direction === "debit";
  const amount = Number(form.amount);
  // More than the driver's payment: it has to be repaid on the next payday or by instalments, so "none yet" is not offered.
  const needsArrangement = !isRefund && form.amount !== "" && amount > Number(payable);
  const namesClaim = isRefund && Boolean(form.claimCourier || form.waybill || form.claimType);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setMoney = (key) => (e) => setForm((f) => ({ ...f, [key]: cleanMoneyInput(e.target.value) }));

  const check = () => {
    const found = {};
    if (!(amount > 0)) found.amount = "Amount must be more than 0";
    else if (amount > MAX_AMOUNT) found.amount = `Amount must be at most ${MAX_AMOUNT}`;
    if (needsArrangement && !form.recoveryPlan) found.recoveryPlan = "Choose how it is repaid: all on the next payday, or fixed instalments.";
    if (form.recoveryPlan === "installments") {
      const per = Number(form.installmentAmount);
      if (!(per > 0)) found.installmentAmount = "Give the amount taken each payday";
      else if (per >= amount) found.installmentAmount = "An instalment must be less than the whole amount; use all on the next payday instead";
    }
    return found;
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = check();
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setSaving(true);
    setErrors({});
    const body = {
      requestId: form.requestId, cityId, driverId, type: form.type, amount: form.amount, reason: form.reason,
      effectiveDate: form.effectiveDate, intendedPayday: form.intendedPayday || null,
      ...(isRefund && { direction: form.direction }),
      ...(form.type === "advance" && { disbursedOutsidePayroll: form.disbursedOutsidePayroll }),
      ...(isDebit && form.recoveryPlan && { recoveryPlan: form.recoveryPlan }),
      ...(isDebit && form.recoveryPlan === "installments" && { installmentAmount: form.installmentAmount }),
      ...(form.type === "manual_claim" && { claimType: form.claimType, waybill: form.waybill }),
      ...(namesClaim && { claimType: form.claimType, waybill: form.waybill, claimCourier: form.claimCourier }),
    };
    try {
      await axios.post("/admin/payroll/ledger", body);
      toast.success("Record added");
      setForm(blank());
      onSaved();
    } catch (err) {
      setErrors(err.response?.data?.errors ?? {});
      toast.error(err.response?.data?.message ?? "The record could not be saved; try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <Field label="Type" info={TIPS.type} error={errors.type}>
        {isRefund ? (
          <select className={inputClass} value={form.type} disabled><option value="correction">{type.label}</option></select>
        ) : (
          <select className={inputClass} value={form.type} onChange={set("type")}>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}
      </Field>
      <Field label="Amount (USD)" info={TIPS.amount} error={errors.amount}>
        <input className={inputClass} inputMode="decimal" value={form.amount} onChange={setMoney("amount")} placeholder="0.00" />
      </Field>
      <Field label="Date" info={TIPS.date} error={errors.effectiveDate}>
        <input type="date" className={inputClass} value={form.effectiveDate} onChange={set("effectiveDate")} />
      </Field>
      <Field label="Reason" info={TIPS.reason} error={errors.reason}>
        <input className={inputClass} value={form.reason} onChange={set("reason")} maxLength={500} />
      </Field>
      <Field label="Not before payday (optional)" info={TIPS.payday} error={errors.intendedPayday}>
        <input type="date" className={inputClass} value={form.intendedPayday} onChange={set("intendedPayday")} />
      </Field>
      {form.type === "manual_claim" && (
        <>
          <Field label="Claim type" info={TIPS.claimType} error={errors.claimType}>
            <input className={inputClass} value={form.claimType} onChange={set("claimType")} maxLength={100} />
          </Field>
          <Field label="Waybill (optional)" info={TIPS.waybill} error={errors.waybill}>
            <input className={inputClass} value={form.waybill} onChange={set("waybill")} maxLength={64} />
          </Field>
        </>
      )}
      {isRefund && (
        <fieldset className="grid grid-cols-1 gap-4 rounded-xl border border-line p-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium text-gray-700">Refund for a claim</legend>
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
          <InfoTip label="already paid out" text={TIPS.paidOut} />
        </label>
      )}
      {isDebit && (
        <>
          <Field label="Repayment arrangement" info={TIPS.arrangement} error={errors.recoveryPlan}>
            <select className={inputClass} value={form.recoveryPlan} onChange={set("recoveryPlan")}>
              {!needsArrangement && <option value="">None yet (needs review)</option>}
              {needsArrangement && form.recoveryPlan === "" && <option value="" disabled>Choose one</option>}
              <option value="full_next_payday">All on the next payday</option>
              <option value="installments">Fixed instalments</option>
            </select>
          </Field>
          {form.recoveryPlan === "installments" && (
            <Field label="Instalment per payday (USD)" info={TIPS.installment} error={errors.installmentAmount}>
              <input className={inputClass} inputMode="decimal" value={form.installmentAmount} onChange={setMoney("installmentAmount")} placeholder="0.00" />
            </Field>
          )}
          {needsArrangement && (
            <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 sm:col-span-2">
              This is more than the driver's payment ({formatMoney(payable)}), so it has to be repaid on the next payday or by instalments.
            </p>
          )}
        </>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-dark disabled:bg-gray-400">
          {saving ? "Saving..." : "Add record"}
        </button>
      </div>
    </form>
  );
}
