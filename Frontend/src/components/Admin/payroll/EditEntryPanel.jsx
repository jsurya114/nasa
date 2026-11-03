import React, { useEffect, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { newRequestId } from "../../../utils/requestId.js";
import { Field, buttonClass, inputClass, primaryClass } from "./formParts.jsx";

// Edit keeps the original (#166): the server voids it and records the corrected entry as one linked action, so the
// admin must say why. The form starts from the entry's latest saved version; only what changed is sent.
const FIELDS = [
  ["amount", "Amount (USD)", "amount"], ["effectiveDate", "Date", "effective_date"], ["intendedPayday", "Not before payday", "intended_payday"],
  ["recoveryPlan", "Repayment arrangement", "recovery_plan"], ["installmentAmount", "Instalment per payday (USD)", "installment_amount"],
  ["entryReason", "Entry reason", "reason"], ["claimType", "Claim type", "claim_type"], ["waybill", "Waybill", "waybill"],
];
const text = (v) => (v === null || v === undefined ? "" : String(v));

export default function EditEntryPanel({ entry, onDone, onCancel }) {
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({});
  const [reason, setReason] = useState("");
  const [requestId] = useState(newRequestId);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    axios.get(`/admin/payroll/ledger/${entry.id}/history`, { signal: controller.signal })
      .then(({ data }) => {
        const latest = data.versions[data.versions.length - 1].entry;
        setCurrent(latest);
        setForm(Object.fromEntries(FIELDS.map(([key, , column]) => [key, text(latest[column])])));
      })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [entry.id]);

  // Leaving instalments clears the instalment amount too: it is hidden then, and the server refuses an amount without a plan.
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value, ...(key === "recoveryPlan" && e.target.value !== "installments" && { installmentAmount: "" }) }));

  const submit = async (e) => {
    e.preventDefault();
    const changes = {};
    for (const [key, , column] of FIELDS) {
      if (form[key] !== text(current[column])) changes[key] = form[key] === "" && key !== "amount" ? null : form[key];
    }
    if (Object.keys(changes).length === 0) {
      setErrors({ changes: "Change at least one field" });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await axios.post(`/admin/payroll/ledger/${entry.id}/edit`, { requestId, reason, changes });
      toast.success("Entry corrected; the original is kept in its history");
      onDone();
    } catch (err) {
      setErrors(err.response?.data?.errors ?? {});
      toast.error(err.response?.data?.message ?? "It could not be saved; try again");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) return <p role="alert" className="mt-3 text-sm text-red-700">The entry could not be loaded. <button type="button" className="underline" onClick={onCancel}>Close</button></p>;
  if (!current) return <p className="mt-3 text-sm text-gray-600">Loading…</p>;
  const isClaim = current.entry_type === "manual_claim";
  const shown = FIELDS.filter(([key]) => (key === "claimType" || key === "waybill" ? isClaim : key === "installmentAmount" ? form.recoveryPlan === "installments" : true));
  // An error about a field that is not on screen must still be seen, or the admin is stuck with no way to fix it.
  const shownKeys = new Set([...shown.map(([key]) => key), "reason", "changes"]);
  const otherErrors = Object.entries(errors).filter(([key]) => !shownKeys.has(key));

  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-line bg-canvas p-3 sm:grid-cols-2" noValidate aria-label="Edit entry">
      {shown.map(([key, label]) => (
        <Field key={key} label={label} error={errors[key]}>
          {key === "recoveryPlan" ? (
            <select className={inputClass} value={form[key]} onChange={set(key)}>
              <option value="">None yet (needs review)</option>
              <option value="full_next_payday">All on the next payday</option>
              <option value="installments">Fixed instalments</option>
            </select>
          ) : (
            <input className={inputClass} type={key === "effectiveDate" || key === "intendedPayday" ? "date" : "text"} value={form[key]} onChange={set(key)} />
          )}
        </Field>
      ))}
      <div className="sm:col-span-2">
        <Field label="Why are you editing this?" error={errors.reason}>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={480} />
        </Field>
      </div>
      {errors.changes && <p className="text-sm text-red-600 sm:col-span-2">{errors.changes}</p>}
      {otherErrors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-600 sm:col-span-2">
          {otherErrors.map(([key, message]) => <li key={key}>{message}</li>)}
        </ul>
      )}
      <p className="text-xs text-gray-600 sm:col-span-2">The original stays in the entry's history. An entry already on a pay run, or with a repayment, cannot be edited.</p>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryClass} disabled={saving}>{saving ? "Saving…" : "Save correction"}</button>
        <button type="button" className={buttonClass} onClick={onCancel}>Close</button>
      </div>
    </form>
  );
}
