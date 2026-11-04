import React, { useEffect, useMemo, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import InfoTip from "../../../reuse/InfoTip.jsx";
import Pagination from "../../../reuse/Pagination.jsx";
import { formatMoney } from "../../../utils/money.js";
import useDebouncedValue from "../../../hooks/useDebouncedValue.js";
import { inputClass } from "./formParts.jsx";

// Every record entered for the drivers of one city, newest first, with the driver and the admin who entered it (#166). Choosing a driver's name
// opens that driver below, where a record can be edited, marked complete or its history read. The server limits the list to the admin's cities.

const PAGE_SIZE = 10;
const TYPE_LABEL = { manual_claim: "Penalty", advance: "Advance", expense: "Expense", correction: "Correction", reimbursement: "Reimbursement", advance_repayment: "Repayment" };
const TIP = "Advances (cash in hand) and penalties entered for any driver of this city, and the admin who entered each. Choose a driver's name to work on that driver's records.";
const HEAD = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const CELL = "px-3 py-3 align-top text-sm text-ink";

const detailsOf = (e) => [e.claim_type, e.reason].filter(Boolean).join(" · ");

export default function CityRecordsTable({ cityId, refreshKey = 0, selectedDriverId = "", onPickDriver }) {
  const [state, setState] = useState({ status: "loading", entries: [] });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(search.trim().toLowerCase());

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));
    axios.get("/admin/payroll/ledger", { params: { cityId }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ status: "ready", entries: data?.entries ?? [] }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", entries: [] }); });
    return () => controller.abort();
  }, [cityId, refreshKey]);

  useEffect(() => setPage(1), [term, cityId]);

  const rows = useMemo(
    () => state.entries.filter((e) => e.entry_type !== "void" && !e.voided_by && (!term || String(e.driver_name ?? "").toLowerCase().includes(term))),
    [state.entries, term]
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section className="card-surface mt-6 p-4" aria-labelledby="city-records">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="city-records" className="flex items-center text-lg font-semibold text-ink">All records in this city<InfoTip label="all records" text={TIP} /></h2>
        <label className="block w-full text-sm font-medium text-gray-700 sm:w-64">
          Search driver
          <input type="search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Driver name" />
        </label>
      </div>

      {state.status === "loading" && state.entries.length === 0 && <p className="mt-4 text-sm text-ink-muted">Loading records…</p>}
      {state.status === "error" && <p role="alert" className="mt-4 text-sm text-red-700">The records could not be loaded.</p>}
      {state.status === "ready" && rows.length === 0 && (
        <p className="mt-4 rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">{term ? "No record matches that driver." : "No records have been entered for this city yet."}</p>
      )}
      {rows.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-canvas">
                <tr>
                  <th scope="col" className={HEAD}>Driver</th>
                  <th scope="col" className={HEAD}>Date</th>
                  <th scope="col" className={HEAD}>Type</th>
                  <th scope="col" className={HEAD}>Details</th>
                  <th scope="col" className={`${HEAD} text-right`}>Amount</th>
                  <th scope="col" className={`${HEAD} text-right`}>Still owed</th>
                  <th scope="col" className={HEAD}>Entered by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((e) => {
                  const owes = e.direction === "debit" && !e.exempt;
                  return (
                    <tr key={e.id} data-testid="city-record" className={String(e.driver_id) === String(selectedDriverId) ? "bg-brand-50/60" : undefined}>
                      <td className={CELL}>
                        <button type="button" onClick={() => onPickDriver?.(String(e.driver_id))} className="min-h-11 text-left font-semibold text-brand underline-offset-2 hover:underline">
                          {e.driver_name ?? `Driver ${e.driver_id}`}
                        </button>
                      </td>
                      <td className={`${CELL} whitespace-nowrap`}>{e.effective_date}</td>
                      <td className={`${CELL} whitespace-nowrap`}>{TYPE_LABEL[e.entry_type] ?? "Record"}</td>
                      <td className={`${CELL} min-w-48 break-words`}>{detailsOf(e)}{e.exempt ? " · not charged" : ""}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{formatMoney(e.amount)}</td>
                      <td className={`${CELL} text-right tabular-nums`}>{owes ? formatMoney(e.outstanding) : "–"}</td>
                      <td className={`${CELL} whitespace-nowrap`}>{e.entered_by ?? "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-muted">{rows.length} {rows.length === 1 ? "record" : "records"}</p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </section>
  );
}
