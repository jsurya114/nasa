import React, { useState } from "react";
import { formatMoney } from "../../../utils/money.js";
import { buttonClass } from "./formParts.jsx";
import EditEntryPanel from "./EditEntryPanel.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import SettlePanel from "./SettlePanel.jsx";

const TYPE_LABEL = { manual_claim: "Penalty", advance: "Advance", expense: "Expense", correction: "Correction" };

// What the driver owes entry by entry (#166), each with Edit, Mark complete and History. Exempt claims owe nothing and are
// left out. The server decides what is allowed; its message is shown when it refuses.
export default function EntryManager({ entries, isSuperAdmin, onChanged }) {
  const [open, setOpen] = useState(null); // { id, panel }
  const debts = entries.filter((e) => e.direction === "debit" && !e.exempt);
  if (debts.length === 0) return null;

  const done = () => { setOpen(null); onChanged(); };
  const toggle = (id, panel) => setOpen((o) => (o?.id === id && o.panel === panel ? null : { id, panel }));

  return (
    <section aria-labelledby="manage-entries" className="mb-6">
      <h3 id="manage-entries" className="mb-2 text-sm font-semibold text-ink">Manage entries</h3>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {debts.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words text-sm font-medium text-ink">{TYPE_LABEL[e.entry_type] ?? "Entry"}: {e.reason}</p>
              <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-ink">{formatMoney(e.outstanding)}</p>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">{e.effective_date} · original {formatMoney(e.amount)}{Number(e.outstanding) === 0 ? " · settled" : " · outstanding"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={buttonClass} onClick={() => toggle(e.id, "edit")} aria-expanded={open?.id === e.id && open.panel === "edit"}>Edit</button>
              {Number(e.outstanding) > 0 && <button type="button" className={buttonClass} onClick={() => toggle(e.id, "settle")} aria-expanded={open?.id === e.id && open.panel === "settle"}>Mark complete</button>}
              <button type="button" className={buttonClass} onClick={() => toggle(e.id, "history")} aria-expanded={open?.id === e.id && open.panel === "history"}>History</button>
            </div>
            {open?.id === e.id && open.panel === "edit" && <EditEntryPanel entry={e} onDone={done} onCancel={() => setOpen(null)} />}
            {open?.id === e.id && open.panel === "settle" && <SettlePanel entry={e} isSuperAdmin={isSuperAdmin} onDone={done} onCancel={() => setOpen(null)} />}
            {open?.id === e.id && open.panel === "history" && <HistoryPanel entry={e} onChanged={onChanged} onCancel={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
