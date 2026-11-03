import React, { useCallback, useEffect, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import { toast } from "../../../utils/toast";
import { newRequestId } from "../../../utils/requestId.js";
import { formatMoney } from "../../../utils/money.js";
import { buttonClass, inputClass } from "./formParts.jsx";

const KIND = { outside_repayment: "Repaid outside payroll", waiver: "Waived by NASA", reversal: "Reversal" };
const when = (v) => String(v ?? "").slice(0, 16).replace("T", " ");

// Every version of one entry with the edit that made it, every repayment, waiver and reversal, and the pay runs that used
// it (#166). Read from the server's permanent history; a mistaken settlement is reversed with a reason, never deleted.
export default function HistoryPanel({ entry, onChanged, onCancel }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [version, setVersion] = useState(0);
  const [reversing, setReversing] = useState(null); // { id, requestId, reason }
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    axios.get(`/admin/payroll/ledger/${entry.id}/history`, { signal: controller.signal })
      .then(({ data }) => setState({ status: "ready", data }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", data: null }); });
    return () => controller.abort();
  }, [entry.id, version]);

  const reverse = async () => {
    try {
      await axios.post(`/admin/payroll/ledger/settlements/${reversing.id}/reverse`, { requestId: reversing.requestId, reason: reversing.reason });
      toast.success("Settlement reversed");
      setReversing(null);
      reload();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message ?? "It could not be reversed; try again");
    }
  };

  if (state.status === "loading") return <p className="mt-3 text-sm text-gray-600">Loading…</p>;
  if (state.status === "error") return <p role="alert" className="mt-3 text-sm text-red-700">The history could not be loaded.</p>;
  const { versions, settlements, payRuns } = state.data;
  const reversed = new Set(settlements.filter((s) => s.reverses_settlement_id).map((s) => String(s.reverses_settlement_id)));

  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas p-3 text-sm" aria-label="History">
      <h4 className="font-semibold text-ink">Versions</h4>
      <ol className="mt-1 space-y-2">
        {versions.map((v, i) => (
          <li key={v.entry.id}>
            <p className="font-medium">Version {i + 1}{i === versions.length - 1 && !v.entry.voided_by ? " (current)" : v.entry.voided_by ? " (replaced or voided)" : ""}: {formatMoney(v.entry.amount)}</p>
            <p className="text-xs text-gray-600">{v.entry.effective_date} · {v.entry.reason} · admin #{v.entry.created_by} · {when(v.entry.created_at)}</p>
            {v.edit && <p className="text-xs text-gray-600">Edited because: {v.edit.reason}</p>}
          </li>
        ))}
      </ol>
      <h4 className="mt-3 font-semibold text-ink">Repaid, waived and reversed</h4>
      {settlements.length === 0 ? <p className="text-xs text-gray-600">None.</p> : (
        <ul className="mt-1 space-y-2">
          {settlements.map((s) => (
            <li key={s.id}>
              <p className="font-medium">{KIND[s.kind]}: {formatMoney(s.amount)} on {s.settled_on}</p>
              <p className="text-xs text-gray-600">{s.reference ? `Ref ${s.reference} · ` : ""}{s.reason} · admin #{s.created_by}</p>
              {s.kind !== "reversal" && !reversed.has(String(s.id)) && (reversing?.id === s.id ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <input aria-label="Reason for the reversal" className={inputClass} value={reversing.reason} onChange={(e) => setReversing({ ...reversing, reason: e.target.value })} maxLength={500} />
                  <button type="button" className={buttonClass} onClick={reverse}>Confirm reversal</button>
                </div>
              ) : <button type="button" className={`${buttonClass} mt-1`} onClick={() => setReversing({ id: s.id, requestId: newRequestId(), reason: "" })}>Reverse</button>)}
            </li>
          ))}
        </ul>
      )}
      <h4 className="mt-3 font-semibold text-ink">Pay runs</h4>
      {payRuns.length === 0 ? <p className="text-xs text-gray-600">Not on a pay run yet.</p> : (
        <ul className="mt-1 text-xs text-gray-700">
          {payRuns.map((p) => <li key={`${p.run_id}-${p.line_type}`}>{p.period_start} – {p.period_end} · {p.run_status} · {p.line_type} {formatMoney(Math.abs(Number(p.amount)))}</li>)}
        </ul>
      )}
      <button type="button" className={`${buttonClass} mt-3`} onClick={onCancel}>Close</button>
    </div>
  );
}
