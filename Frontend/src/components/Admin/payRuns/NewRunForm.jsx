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
  return { requestId: newRequestId(), periodStart: from_date, periodEnd: to_date };
};

// The city decides the pay data: a weekly city is paid from GOFO, any other city from daily SpeedX.
const PAY_DATA = { weekly: "Weekly (GOFO)", daily: "Daily (SpeedX)" };

export default function NewRunForm({ cityId, dataType = "daily", onDrafted }) {
  const [form, setForm] = useState(fresh);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const days = (Date.parse(form.periodEnd) - Date.parse(form.periodStart)) / 86400000 + 1;
  const rangeError = !Number.isFinite(days) ? "Choose a start and end date." : days < 1 ? "End date must be on or after start date." : days > 31 ? "Choose a period of 31 days or fewer." : null;

  const submit = async (e) => {
    e.preventDefault();
    if (rangeError) { setErrors({ periodEnd: rangeError }); return; }
    setSaving(true);
    setErrors({});
    try {
      const { data } = await axios.post("/admin/payroll/runs", { ...form, dataType, cityId });
      if (data.statements.length === 0) toast.warn("No payable earnings found. Check the dates, pay type and existing runs.");
      else toast.success(data.replay ? "This draft was already made; showing it" : `Draft made with ${data.statements.length} statement(s)`);
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
      <p id="run-period-help" className="text-sm text-ink-muted sm:col-span-4">Choose the <strong>delivery dates</strong> to pay, up to 31 days. An advance dated after the end date waits for a later run.</p>
      <div>
        <label className="block text-sm font-medium text-gray-700">From
          <input type="date" aria-describedby="run-period-help" className={inputClass} value={form.periodStart} max={form.periodEnd} onChange={set("periodStart")} />
        </label>
        {error("periodStart")}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">To
          <input type="date" aria-describedby="run-period-help run-range-status" aria-invalid={Boolean(rangeError)} className={inputClass} value={form.periodEnd} min={form.periodStart} onChange={set("periodEnd")} />
        </label>
        {error("periodEnd")}
      </div>
      <div>
        <p className="block text-sm font-medium text-gray-700">Pay data
          <span data-testid="pay-data" className={`${inputClass} flex items-center bg-gray-50 font-semibold text-ink`}>{PAY_DATA[dataType]}</span>
        </p>
        {error("dataType")}
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={saving} className="min-h-11 w-full rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-dark disabled:bg-gray-400">
          {saving ? "Drafting..." : "Draft pay run"}
        </button>
      </div>
      <p id="run-range-status" role={rangeError ? "alert" : "status"} className={`text-sm sm:col-span-4 ${rangeError ? "text-red-700" : "text-ink-muted"}`}>
        {rangeError ?? `${days} delivery day${days === 1 ? "" : "s"} selected.`} {dataType === "weekly" ? "Weekly GOFO includes matched delivery claims." : "Daily SpeedX includes manual advances and penalties, not imported GOFO claims."}
      </p>
    </form>
  );
}
