import React, { useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { confirmDialog } from "../../../utils/confirmDialog";
import { formatMoney } from "../../../utils/money.js";
import { describeLimit } from "./describeLimit.js";

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
  ["claim_deductions", "Claim deductions"], ["recoveries", "Recoveries"], ["net", "Net pay"], ["carried_forward", "Still owed after"],
];

export default function RunDetail({ detail, isSuperAdmin, onChanged, onClose, selectedCityId, cityName }) {
  const { run, totals, statements, waiting } = detail;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
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

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TOTALS.map(([key, label]) => (
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

      <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Statements ({statements.length})</h3>
      {statements.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-3 text-sm text-ink-muted">No closed, unpaid pay rows in this period that another run does not already hold.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {statements.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-ink">{s.driver_name}</p>
                <p className={`font-semibold tabular-nums ${Number(s.net) < 0 ? "text-red-700" : "text-ink"}`}>{money(s.net)}</p>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
                Earnings {money(s.gross)} · insurance {less(s.insurance)} · reimbursements {money(s.reimbursements)} · claims {less(s.claim_deductions)} · recoveries {less(s.recoveries)}
                {Number(s.carried_forward) > 0 && ` · still owed ${money(s.carried_forward)}`}
              </p>
              {[...new Set((s.flags ?? []).map((f) => f.message))].map((m) => (
                <p key={m} className="mt-1 text-xs font-medium text-amber-800">{m}</p>
              ))}
            </li>
          ))}
        </ul>
      )}

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
              <button type="button" disabled={busy || negative} onClick={() => act("finalize", { title: "Finalize this pay run?", text: "Its statements are frozen and drivers can see them. No money is sent by this step.", confirm: "Finalize" })}
                className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white disabled:bg-gray-400">Finalize</button>
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
