import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { Badge } from "./fields.jsx";
import { INPUT } from "./fieldStyles.js";
import PaymentDialog from "./PaymentDialog.jsx";
import { STATUS_LABEL, TYPE_LABEL } from "./invoiceTemplate.js";
import { getInvoice, listInvoices, problemOf } from "./invoiceApi.js";
import { amountText, periodText, usDate } from "./invoiceRules.js";

const SORTS = [
  { id: "invoice_date", label: "Invoice date" },
  { id: "payment_date", label: "Payment received date" },
  { id: "amount", label: "Amount" },
];
const START = { search: "", vendorId: "", type: "", status: "", from: "", to: "", sort: "invoice_date", dir: "desc", page: 1 };
// Only what is set goes to the server (it pages, filters and sorts; nothing is filtered here).
const paramsOf = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== "" && v !== null));

// Every saved invoice, newest first, a page of 20 at a time. Search by invoice number or vendor; filter by vendor, type, status and invoice date;
// sort by invoice date, payment received date or amount. Open one to view or change it, download its PDF, or record its payment.
export default function InvoiceHistory({ vendors, onOpen, refreshKey }) {
  const [query, setQuery] = useState(START);
  const [searchText, setSearchText] = useState("");
  const [state, setState] = useState({ status: "loading", data: null, message: "" });
  const [paying, setPaying] = useState(null);
  const [note, setNote] = useState("");
  const [reload, setReload] = useState(0);

  // Typing in the search box asks the server once the typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQuery((q) => (q.search === searchText.trim() ? q : { ...q, search: searchText.trim(), page: 1 })), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));
    listInvoices(paramsOf(query), controller.signal)
      .then((data) => setState({ status: "ready", data, message: "" }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", data: null, message: problemOf(error, "The invoices could not be loaded. Check your connection and try again.").message });
      });
    return () => controller.abort();
  }, [query, reload, refreshKey]);

  const set = (field) => (e) => setQuery((q) => ({ ...q, [field]: e.target.value, page: 1 }));
  const reset = () => { setSearchText(""); setQuery(START); };
  const filtered = Object.keys(START).some((k) => k !== "page" && k !== "sort" && k !== "dir" && query[k] !== START[k]);

  const download = async (row) => {
    setNote("");
    try {
      const [invoice, { downloadInvoice }] = await Promise.all([getInvoice(row.id), import("./buildInvoicePdf.js")]);
      await downloadInvoice(invoice);
    } catch {
      setNote(`The PDF for invoice ${row.invoiceNumber} could not be made. Try again.`);
    }
  };

  const data = state.data;
  return (
    <section className="flex flex-col gap-4" data-testid="invoice-history">
      <div className="card-surface flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm font-semibold text-ink">Search</span>
            <Search className="pointer-events-none absolute bottom-3.5 left-3 h-4 w-4 text-ink-muted" aria-hidden="true" />
            <input type="search" className={`${INPUT} pl-9`} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Invoice number or vendor" maxLength={80} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Vendor</span>
            <select className={INPUT} value={query.vendorId} onChange={set("vendorId")}>
              <option value="">All vendors</option>
              {(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.billingName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Type</span>
            <select className={INPUT} value={query.type} onChange={set("type")}>
              <option value="">All types</option>
              <option value="hourly">Hourly</option>
              <option value="item">Item-based</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Status</span>
            <select className={INPUT} value={query.status} onChange={set("status")}>
              <option value="">Any status</option>
              <option value="pending">Pending</option>
              <option value="paid">Payment received</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Invoice date from</span>
            <input type="date" className={INPUT} value={query.from} max={query.to || undefined} onChange={set("from")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-ink">Invoice date to</span>
            <input type="date" className={INPUT} value={query.to} min={query.from || undefined} onChange={set("to")} />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-semibold text-ink">Sort by</span>
              <select className={INPUT} value={query.sort} onChange={set("sort")}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-white text-ink hover:bg-brand-50"
              onClick={() => setQuery((q) => ({ ...q, dir: q.dir === "desc" ? "asc" : "desc", page: 1 }))}
              aria-label={query.dir === "desc" ? "Newest or largest first. Switch to oldest or smallest first" : "Oldest or smallest first. Switch to newest or largest first"}>
              {query.dir === "desc" ? <ArrowDown className="h-4 w-4" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        {filtered && <div><button type="button" className="min-h-11 text-sm font-semibold text-brand underline" onClick={reset}>Clear filters</button></div>}
      </div>

      {note && <p role="alert" className="text-sm text-red-600">{note}</p>}

      {state.status === "error" ? (
        <div role="alert" className="card-surface p-5">
          <p className="font-semibold text-ink">The invoices could not be loaded</p>
          <p className="mt-1 text-sm text-ink-muted">{state.message}</p>
          <button type="button" className="ui-btn ui-btn-ghost mt-3" onClick={() => setReload((n) => n + 1)}>Try again</button>
        </div>
      ) : !data ? (
        <div className="card-surface p-5 text-sm text-ink-muted" role="status">Loading invoices...</div>
      ) : data.invoices.length === 0 ? (
        <div className="card-surface p-6 text-center" data-testid="history-empty">
          <p className="font-semibold text-ink">{filtered ? "No invoices match these filters" : "No invoices yet"}</p>
          <p className="mt-1 text-sm text-ink-muted">{filtered ? "Try another search or clear the filters." : "Saved invoices are listed here."}</p>
        </div>
      ) : (
        <div className="card-surface overflow-hidden" aria-busy={state.status === "loading"}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm" data-testid="history-table">
              <thead className="bg-canvas text-xs uppercase text-ink-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Number</th>
                  <th scope="col" className="px-3 py-2">Vendor</th>
                  <th scope="col" className="px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2">Invoice date</th>
                  <th scope="col" className="px-3 py-2">Billing period</th>
                  <th scope="col" className="px-3 py-2 text-right">Total</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Payment received</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((row) => (
                  <tr key={row.id} className="border-t border-line" data-testid={`history-row-${row.invoiceNumber}`}>
                    <td className="px-3 py-2 font-semibold">
                      <button type="button" className="min-h-11 text-brand underline" onClick={() => onOpen(row.id)}>{row.invoiceNumber}</button>
                    </td>
                    <td className="px-3 py-2">{row.vendorName}</td>
                    <td className="whitespace-nowrap px-3 py-2">{TYPE_LABEL[row.type]}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{usDate(row.invoiceDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{periodText(row.periodStart, row.periodEnd)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{amountText(row.total)}</td>
                    <td className="px-3 py-2"><Badge tone={row.status === "paid" ? "paid" : "pending"}>{STATUS_LABEL[row.status]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{row.paymentReceivedOn ? usDate(row.paymentReceivedOn) : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button type="button" className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-white hover:bg-brand-50" onClick={() => download(row)} aria-label={`Download invoice ${row.invoiceNumber}`}>
                          <Download className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {row.status === "pending" && (
                          <button type="button" className="ui-btn ui-btn-ghost whitespace-nowrap" onClick={() => setPaying(row)}>Mark payment received</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3 text-sm">
            <p className="text-ink-muted" data-testid="history-count">{data.total} {data.total === 1 ? "invoice" : "invoices"} · page {data.page} of {Math.max(1, data.totalPages)}</p>
            <div className="flex gap-2">
              <button type="button" className="ui-btn ui-btn-ghost" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>Previous</button>
              <button type="button" className="ui-btn ui-btn-ghost" disabled={data.page >= data.totalPages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>Next</button>
            </div>
          </div>
        </div>
      )}

      {paying && (
        <PaymentDialog invoice={paying} onClose={() => setPaying(null)} onRecorded={() => { setPaying(null); setReload((n) => n + 1); }} />
      )}
    </section>
  );
}
