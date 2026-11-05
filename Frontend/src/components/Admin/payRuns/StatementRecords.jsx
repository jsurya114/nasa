import React from "react";
import { formatMoney } from "../../../utils/money.js";

// The advances, penalties and other records one statement touched, for the "Full payment breakdown". Each shows its
// repayment arrangement, what this run took from it, and why nothing (or less) was taken. The server sends the facts;
// nothing here works out pay.
const TYPE_LABEL = { manual_claim: "Penalty", advance: "Advance", expense: "Expense", correction: "Correction", reimbursement: "Reimbursement", advance_repayment: "Repayment" };

const planText = (r) => {
  if (r.direction !== "debit") return null;
  if (r.recovery_plan === "installments") return `repaid in instalments of ${formatMoney(r.installment_amount)}`;
  if (r.recovery_plan === "full_next_payday") return "repaid in full on the next payday";
  return "no repayment arrangement yet";
};

const flagsOf = (flags, id) => (flags ?? []).filter((f) => String(f.entryId) === id || (f.entryIds ?? []).map(String).includes(id));

const reasonText = (flags, runEnd) => flags.map((f) => {
  if (f.code === "not_yet_due") return `Dated after this run ends (${runEnd}), so it is taken from a later pay run.`;
  if (f.code === "recovery_limit_not_set") return "No recovery limit is set, so nothing is taken automatically.";
  return f.message;
}).filter(Boolean);

export default function StatementRecords({ records, flags, runEnd }) {
  if (!records?.length) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="font-medium">Advances, penalties and other records</p>
      <ul className="mt-2 space-y-3">
        {records.map((r) => {
          const debit = r.direction === "debit";
          const taken = Number(r.taken);
          const reasons = debit && taken === 0 ? reasonText(flagsOf(flags, r.id), runEnd) : [];
          return (
            <li key={r.id} className="rounded-xl bg-gray-50 p-3">
              <p className="flex justify-between gap-3"><span>{TYPE_LABEL[r.entry_type] ?? r.entry_type} · dated {r.effective_date}</span><span className="font-medium tabular-nums">{formatMoney(r.amount)}</span></p>
              {planText(r) && <p className="text-ink-muted">{planText(r)}</p>}
              <p className="mt-1 flex justify-between gap-3"><span>{debit ? "Taken in this run" : "Added to the driver’s pay in this run"}</span><span className="font-medium tabular-nums">{debit ? formatMoney(r.taken) : formatMoney(r.amount)}</span></p>
              {reasons.map((m) => <p key={m} className="mt-1 text-amber-900">{m}</p>)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
