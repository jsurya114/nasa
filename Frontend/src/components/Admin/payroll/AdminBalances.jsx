import React, { useState } from "react";
import { formatMoney } from "../../../utils/money.js";
import InfoTip from "../../../reuse/InfoTip.jsx";
import { buttonClass } from "./formParts.jsx";
import EditEntryPanel from "./EditEntryPanel.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import SettlePanel from "./SettlePanel.jsx";
import { describeStanding } from "./describeStanding.js";

const TYPE_LABEL = { manual_claim: "Penalty", advance: "Advance", expense: "Expense", correction: "Correction", reimbursement: "Reimbursement", advance_repayment: "Repayment" };
const TIPS = {
  owes: "What the driver still owes NASA for advances and other debts (not penalties), after anything repaid, waived or already taken from pay.",
  penalties: "What the driver still owes for penalties: those entered by hand and the carrier claims from the Excel, after anything repaid, waived or already taken from pay.",
  records: "Every advance and penalty entered for this driver. Use Edit to correct one (the original is kept), Mark complete when it was repaid or waived, and History to see what happened to it.",
};

function Card({ title, info, value }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-3">
      <dt className="flex items-center text-xs font-medium text-ink-muted">{title}<InfoTip label={title} text={info} /></dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

// One record with its own Edit, Mark complete and History, opening under it. The server decides what is allowed.
function Record({ entry, isSuperAdmin, onChanged }) {
  const [panel, setPanel] = useState(null);
  const toggle = (name) => setPanel((p) => (p === name ? null : name));
  const done = () => { setPanel(null); onChanged(); };
  const isDebit = entry.direction === "debit" && !entry.exempt;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-sm font-medium text-ink">{TYPE_LABEL[entry.entry_type] ?? "Record"}: {entry.reason}</p>
        <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-ink">{formatMoney(entry.outstanding)}</p>
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">
        {entry.effective_date} · original {formatMoney(entry.amount)}{isDebit ? ` · ${describeStanding(entry, formatMoney)}` : entry.exempt ? " · not charged" : " · owed to the driver"}
      </p>
      {isDebit && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => toggle("edit")} aria-expanded={panel === "edit"}>Edit</button>
          {Number(entry.outstanding) > 0 && <button type="button" className={buttonClass} onClick={() => toggle("settle")} aria-expanded={panel === "settle"}>Mark complete</button>}
          <button type="button" className={buttonClass} onClick={() => toggle("history")} aria-expanded={panel === "history"}>History</button>
        </div>
      )}
      {panel === "edit" && <EditEntryPanel entry={entry} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === "settle" && <SettlePanel entry={entry} isSuperAdmin={isSuperAdmin} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === "history" && <HistoryPanel entry={entry} onChanged={onChanged} onCancel={() => setPanel(null)} />}
    </li>
  );
}

// The left side of the Payroll page: two cards (what the driver owes, and penalties) and the list of records, each with Edit, Mark
// complete and History inside the list. A record added on the right shows here straight away (the page reloads after saving).
export default function AdminBalances({ balances, isSuperAdmin, onChanged }) {
  if (!balances) return null;
  const owedCents = Math.round(Number(balances.totals.owedOther ?? balances.totals.owedByDriver) * 100);
  const penaltyCents = Math.round(Number(balances.totals.owedPenalties ?? 0) * 100);
  const entries = balances.entries.filter((e) => e.entry_type !== "advance_repayment");
  const claims = balances.claims.filter((c) => c.status === "exempt" || Number(c.outstanding) > 0);

  return (
    <section aria-labelledby="records-title" className="mb-6">
      <dl className="grid grid-cols-2 gap-3">
        <Card title="Driver owes NASA" info={TIPS.owes} value={formatMoney(owedCents / 100)} />
        <Card title="Penalty charges" info={TIPS.penalties} value={formatMoney(penaltyCents / 100)} />
      </dl>
      {penaltyCents > 0 && (
        <p className="mt-2 text-xs text-ink-muted">Total owed: <span className="font-semibold tabular-nums">{formatMoney((owedCents + penaltyCents) / 100)}</span></p>
      )}

      <h3 id="records-title" className="mb-2 mt-5 flex items-center text-sm font-semibold text-ink">Records<InfoTip label="records" text={TIPS.records} /></h3>
      {entries.length + claims.length === 0 ? (
        <p className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">No records yet. Add one on the right.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {entries.map((e) => <Record key={`e${e.id}`} entry={e} isSuperAdmin={isSuperAdmin} onChanged={onChanged} />)}
          {claims.map((c) => (
            <li key={`c${c.id}`} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-medium text-ink">Carrier claim: {c.claim_type} · {c.waybill}</p>
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-ink">{formatMoney(c.outstanding)}</p>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{c.claim_at} · carrier charge {formatMoney(c.source_charge)}{c.status === "exempt" ? " · not charged" : ""}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
