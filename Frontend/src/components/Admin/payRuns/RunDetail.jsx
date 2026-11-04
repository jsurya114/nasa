import React, { useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { confirmDialog } from "../../../utils/confirmDialog";
import { formatMoney } from "../../../utils/money.js";
import { describeLimit } from "./describeLimit.js";
import { Link } from "react-router-dom";

// One pay run as the server froze it (#143): totals, what is waiting outside it, each driver's statement with its
// flags, and the actions its status allows. Nothing here works out pay; every amount is the server's.
const STATUS_TONES = {
  draft: "bg-gray-100 text-gray-700 border-gray-300",
  finalized: "bg-blue-100 text-blue-800 border-blue-300",
  discarded: "bg-gray-100 text-gray-500 border-gray-300 line-through",
  voided: "bg-red-100 text-red-800 border-red-300",
};

const TOTALS = [
  ["gross", "Earnings"], ["insurance", "Insurance"], ["reimbursements", "Reimbursements"],
  ["claim_deductions", "Delivery claim deductions"],
];
const HERO_TOTALS = [
  ["net", "Driver pay for this run", "After insurance and this run’s deductions", "bg-brand text-white"],
  ["recoveries", "Advances & other deductions", "Taken from drivers’ pay in this run", "border border-line bg-white text-ink"],
  ["carried_forward", "Drivers still owe NASA", "Debt left after this run’s deductions", "border border-amber-200 bg-amber-50 text-amber-950"],
];
const BREAKDOWN = [
  ["gross", "Delivery earnings", false], ["insurance", "Insurance", true],
  ["reimbursements", "Added back to pay", false], ["claim_deductions", "Delivery claims", true],
  ["recoveries", "Advances & other deductions", true], ["net", "Driver pay", false],
];
const FLAG_HELP = {
  advance_not_disbursed: "Cash handover is not confirmed. Open the advance’s Edit form and confirm receipt once the money has been given.",
  not_yet_due: "This record starts after the run’s end date. Its repayment waits for a later period.",
  needs_review: "Choose how this record will be repaid: all on the next payday, or fixed instalments.",
};

export default function RunDetail({ detail, isSuperAdmin, onChanged, onClose, selectedCityId, cityName }) {
  const { run, totals, statements, waiting } = detail;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const money = (v) => formatMoney(v);
  const less = (v) => (Number(v) ? `−${money(v)}` : money(v)); // deductions are stored as positive totals

  // The run must belong to the city on screen. If not (it should never happen), nothing can be done to it here.
  const sameCity = String(run.city_id) === String(selectedCityId);

  const act = async (action, question, needsReason) => {
    if (!sameCity) return;
    if (needsReason && reason.trim().length < 3) {
      toast.error("Give a reason (at least 3 characters)");
      return;
    }
    if (!(await confirmDialog({ title: `${question.title} (${cityName}, ${run.period_start} – ${run.period_end})`, text: question.text, confirmText: question.confirm, tone: action === "finalize" ? "warning" : "danger" }))) return;
    setBusy(true);
    try {
      await axios.post(`/admin/payroll/runs/${run.id}/${action}`, needsReason ? { reason } : {});
      const { data } = await axios.get(`/admin/payroll/runs/${run.id}`);
      setReason("");
      onChanged(data);
      toast.success(`Pay run ${data.run.status}`);
    } catch (err) {
      toast.error(err.response?.data?.message ?? "The pay run could not be updated; try again");
    } finally {
      setBusy(false);
    }
  };

  const waitingParts = [
    waiting.pending_claims > 0 && `${waiting.pending_claims} unmatched claim(s), never deducted until matched`,
    waiting.entries_needing_review > 0 && `${waiting.entries_needing_review} ledger entr${waiting.entries_needing_review === 1 ? "y" : "ies"} with no repayment arrangement`,
  ].filter(Boolean);
  const negative = statements.some((s) => Number(s.net) < 0);
  const canClose = sameCity && (run.status === "draft" || (run.status === "finalized" && isSuperAdmin));
  const needsAttention = (s) => (s.flags ?? []).length > 0 || Number(s.net) < 0;
  const attentionCount = statements.filter(needsAttention).length;
  const visible = statements.filter((s) => s.driver_name.toLowerCase().includes(search.trim().toLowerCase()) && (!attentionOnly || needsAttention(s)));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink tabular-nums">
            <span className="whitespace-nowrap">{run.period_start}</span> – <span className="whitespace-nowrap">{run.period_end}</span>
          </h2>
          <p className="text-sm font-medium text-ink">{cityName}</p>
          <p className="text-sm text-ink-muted">{run.data_type === "weekly" ? "Weekly" : "Daily"} · run #{run.id} · {describeLimit(run.recovery_limit)}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[run.status] ?? STATUS_TONES.draft}`}>{run.status}</span>
      </div>
      {run.close_reason && <p className="mt-2 text-sm text-ink-muted">Reason: {run.close_reason}</p>}

      <p className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-dark">
        {run.status === "draft" ? "Saved preview. Later changes do not update this draft; discard it and create a new one. Approval sends no money." : run.status === "finalized" ? "These statements are approved. Payment is handled separately; approval does not send money." : "This run is kept for history only. Its work and deductions have been released for another run."}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {HERO_TOTALS.map(([key, label, note, style]) => (
          <div key={key} className={`rounded-2xl p-4 ${key === "net" ? "col-span-2 sm:col-span-1" : ""} ${style}`}>
            <dt className="text-sm font-medium">{label}</dt><dd className="mt-2 text-2xl font-bold tabular-nums">{money(totals[key])}</dd>
            <p className="mt-2 text-xs">{note}</p>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink-muted">Totals cover the {statements.length} drivers in this run. Remaining debt is separate from driver pay and is not deducted again.</p>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TOTALS.filter(([key]) => key === "gross" || key === "insurance" || Number(totals[key]) !== 0).map(([key, label]) => (
          <div key={key} className="rounded-xl border border-line bg-white px-3 py-2">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-semibold tabular-nums text-ink">{money(totals[key])}</dd>
          </div>
        ))}
      </dl>

      {waitingParts.length > 0 && (
        <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Waiting outside this run: {waitingParts.join("; ")}.
        </p>
      )}

      <div className="mb-3 mt-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">Driver statements ({statements.length})</h3>
        {statements.length > 0 && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />Needs attention ({attentionCount})</label>}
      </div>
      {statements.length > 0 && <input type="search" aria-label="Find a driver in this run" placeholder="Find a driver…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base sm:max-w-sm" />}
      {statements.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-4 text-sm text-ink-muted">
          <p className="font-semibold text-ink">No earnings were included in this draft.</p>
          <p className="mt-2">Check the delivery dates and Daily/Weekly selection. Work must have its payment calculated, be closed and unpaid, and not already held by another draft or approved run.</p>
          <Link to="/admin/dashboard" className="mt-2 inline-flex min-h-11 items-center font-semibold text-brand underline">Check earnings in Dashboard</Link>
          {run.status === "draft" && <p>After correcting the data, discard this empty draft and create a new one.</p>}
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {visible.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-ink">{s.driver_name}</p>
                <div className="text-right"><p className="text-xs text-ink-muted">Driver pay</p><p className={`text-lg font-bold tabular-nums ${Number(s.net) < 0 ? "text-red-700" : "text-brand"}`}>{money(s.net)}</p></div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                {[["gross", "Earned"], ["recoveries", "Advances & other deductions"], ["carried_forward", "Still owes NASA"]].map(([key, label]) => <div key={key}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{money(s[key])}</dd></div>)}
              </dl>
              {(s.flags ?? []).length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">Why a deduction was held or limited</p>
                {[...new Set(s.flags.map((f) => FLAG_HELP[f.code] ?? f.message))].map((m) => <p key={m} className="mt-1">{m}</p>)}
                {sameCity && s.driver_id && <Link className="mt-2 inline-flex min-h-11 items-center font-semibold underline" to={`/admin/payroll?cityId=${run.city_id}&driverId=${s.driver_id}`}>Review this driver’s records →</Link>}
              </div>}
              <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium text-brand">Full payment breakdown</summary>
                <dl className="mt-2 space-y-2">
                  {BREAKDOWN.map(([key, label, deduction]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt>{label}</dt><dd className="font-medium tabular-nums">{deduction ? less(s[key]) : money(s[key])}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
      {statements.length > 0 && visible.length === 0 && <p role="status" className="p-4 text-sm text-ink-muted">No drivers match these filters.</p>}

      <div className="mt-5 space-y-3">
        {canClose && (
          <label className="block text-sm font-medium text-gray-700">Reason (needed to discard or void)
            <input className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
        )}
        {!sameCity && <p role="alert" className="text-sm text-red-700">This run is not in the city selected above, so it cannot be changed here.</p>}
        {negative && run.status === "draft" && <p className="text-sm text-red-700">A statement is below zero; it must be reviewed before this run can be finalized.</p>}
        <div className="flex flex-wrap gap-2">
          {sameCity && run.status === "draft" && (
            <>
              <button type="button" disabled={busy || negative || statements.length === 0} onClick={() => act("finalize", { title: "Approve this pay run?", text: "Its statements are frozen and drivers can see them. No money is sent by this step.", confirm: "Approve statements" })}
                className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white disabled:bg-gray-400">Approve statements</button>
              <button type="button" disabled={busy} onClick={() => act("discard", { title: "Discard this draft?", text: "Its rows, claims and entries are released for another run.", confirm: "Discard" }, true)}
                className="min-h-11 rounded-xl border border-red-300 bg-white px-4 font-semibold text-red-700">Discard draft</button>
            </>
          )}
          {sameCity && run.status === "finalized" && isSuperAdmin && (
            <button type="button" disabled={busy} onClick={() => act("void", { title: "Void this finalized run?", text: "Only possible while no payout is sent, paid or unconfirmed. Its deductions are released.", confirm: "Void run" }, true)}
              className="min-h-11 rounded-xl border border-red-300 bg-white px-4 font-semibold text-red-700">Void run</button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-line bg-white px-4 font-semibold text-ink">Back to runs</button>
        </div>
      </div>
    </div>
  );
}
