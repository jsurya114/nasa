import React, { useEffect, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { describeLimit } from "./describeLimit.js";

// The payday recovery limit (#143). Empty means nothing is recovered automatically, which is how it starts:
// the policy is still to be confirmed with the client. Only a super admin can change it, with a reason.

const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

export default function RecoveryLimitPanel({ isSuperAdmin }) {
  const [limit, setLimit] = useState(undefined);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ type: "", value: "", reason: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get("/admin/payroll/settings").then(({ data }) => setLimit(data?.recoveryLimit ?? null)).catch(() => setLimit(undefined));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const recoveryLimit = form.type ? { type: form.type, value: form.type === "percent_of_available" ? Number(form.value) : form.value } : null;
    try {
      const { data } = await axios.put("/admin/payroll/settings/recovery-limit", { recoveryLimit, reason: form.reason });
      setLimit(data?.recoveryLimit ?? null);
      setEditing(false);
      toast.success("Recovery limit saved. It applies to runs drafted from now on.");
    } catch (err) {
      toast.error(err.response?.data?.message ?? "The recovery limit could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <section className="card-surface p-4" aria-labelledby="recovery-limit">
      <h2 id="recovery-limit" className="text-base font-semibold text-ink">Deduction limit per driver</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {limit === undefined ? "Could not load the setting." : describeLimit(limit)}
      </p>
      <p className="mt-1 text-sm text-ink-muted">The most taken for claims, advances and other debts from each driver’s pay. When not set, these deductions are paused.</p>
      <p className="mt-1 text-xs text-ink-muted">Changes apply to new drafts. Existing drafts keep their saved limit.</p>
      {isSuperAdmin && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="mt-3 min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand">
          Change
        </button>
      )}
      {isSuperAdmin && editing && (
        <form onSubmit={save} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-gray-700">Limit
            <select className={inputClass} value={form.type} onChange={set("type")}>
              <option value="">Not set (no automatic recovery)</option>
              <option value="percent_of_available">Percent of available pay</option>
              <option value="fixed_amount">Fixed amount per payday</option>
            </select>
          </label>
          {form.type && (
            <label className="block text-sm font-medium text-gray-700">{form.type === "percent_of_available" ? "Percent (0 to 100)" : "Amount (USD)"}
              <input className={inputClass} inputMode="decimal" value={form.value} onChange={set("value")} />
            </label>
          )}
          <label className="block text-sm font-medium text-gray-700">Reason
            <input className={inputClass} value={form.reason} onChange={set("reason")} maxLength={500} />
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white disabled:bg-gray-400">{saving ? "Saving..." : "Save limit"}</button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-11 rounded-xl border border-line bg-white px-4 font-semibold text-ink">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
