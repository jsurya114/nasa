import React, { useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { newRequestId } from "../../../utils/requestId.js";
import { lastDaysRange } from "../../../utils/dateRange.js";

// Drafts a pay run for one city and period (#143). Drafting moves no money and marks nothing paid; it only
// holds the rows until the run is finalized or discarded. One request ID per draft, so a retry returns the same run.
const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

const fresh = () => {
  const { from_date, to_date } = lastDaysRange(7);
  return { requestId: newRequestId(), periodStart: from_date, periodEnd: to_date, dataType: "daily" };
};

export default function NewRunForm({ cityId, onDrafted }) {
  const [form, setForm] = useState(fresh);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const { data } = await axios.post("/admin/payroll/runs", { ...form, cityId });
      toast.success(data.replay ? "This draft was already made; showing it" : `Draft made with ${data.statements.length} statement(s)`);
      setForm(fresh());
      onDrafted(data);
    } catch (err) {
      setErrors(err.response?.data?.errors ?? {});
      toast.error(err.response?.data?.message ?? "The draft could not be made; try again");
    } finally {
      setSaving(false);
    }
  };

  const error = (key) => errors[key] && <p className="mt-1 text-sm text-red-600">{errors[key]}</p>;

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-4" noValidate>
      <div>
        <label className="block text-sm font-medium text-gray-700">From
          <input type="date" className={inputClass} value={form.periodStart} max={form.periodEnd} onChange={set("periodStart")} />
        </label>
        {error("periodStart")}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">To
          <input type="date" className={inputClass} value={form.periodEnd} min={form.periodStart} onChange={set("periodEnd")} />
        </label>
        {error("periodEnd")}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Pay data
          <select className={inputClass} value={form.dataType} onChange={set("dataType")}>
            <option value="daily">Daily (SpeedX)</option>
            <option value="weekly">Weekly (GOFO)</option>
          </select>
        </label>
        {error("dataType")}
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={saving} className="min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark disabled:bg-gray-400">
          {saving ? "Drafting..." : "Draft pay run"}
        </button>
      </div>
    </form>
  );
}
