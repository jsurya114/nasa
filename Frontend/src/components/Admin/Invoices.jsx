import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FilePlus2, History, Building } from "lucide-react";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import InvoiceEditor from "./invoice/InvoiceEditor.jsx";
import InvoiceHistory from "./invoice/InvoiceHistory.jsx";
import VendorManager from "./invoice/VendorManager.jsx";
import { listVendors, problemOf } from "./invoice/invoiceApi.js";

const TABS = [
  { id: "create", label: "Create invoice", Icon: FilePlus2 },
  { id: "history", label: "Invoice history", Icon: History },
  { id: "vendors", label: "Manage vendors", Icon: Building },
];

// Invoices: create an invoice for a saved vendor (Hourly or Item-based), find earlier ones, record a payment received, and keep the vendor list.
// Super admin only (the route and every server call check). Every invoice is saved; its PDF is made in the browser from what was saved.
// The open tab and invoice are in the address (?tab=...&invoice=...), so a reload comes back to the same place.
export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "create";
  const invoiceId = /^\d+$/.test(params.get("invoice") ?? "") ? Number(params.get("invoice")) : null;
  const [vendors, setVendors] = useState(null);
  const [vendorState, setVendorState] = useState({ status: "loading", message: "" });
  const [historyKey, setHistoryKey] = useState(0);

  const loadVendors = useCallback(async () => {
    setVendorState({ status: "loading", message: "" });
    try {
      setVendors(await listVendors());
      setVendorState({ status: "ready", message: "" });
    } catch (error) {
      setVendorState({ status: "error", message: problemOf(error, "The vendors could not be loaded. Check your connection and try again.").message });
    }
  }, []);
  useEffect(() => { loadVendors(); }, [loadVendors]);

  const go = (next, id = null) => setParams(() => {
    const p = new URLSearchParams();
    if (next !== "create") p.set("tab", next);
    if (id) p.set("invoice", String(id));
    return p;
  });

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto max-w-6xl space-y-4 p-3 pb-28 sm:p-6 sm:pb-40">
        <div>
          <h1 className="text-2xl font-bold text-brand">Invoices</h1>
          <p className="text-sm text-ink-muted">Create, find and download invoices, and record when a payment was received. Nothing here sends or moves money.</p>
        </div>

        <div role="tablist" aria-label="Invoices" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => go(t.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${tab === t.id ? "border-brand-500 bg-brand-50 text-brand" : "border-line bg-white text-ink hover:bg-brand-50"}`}>
              <t.Icon className="h-4 w-4" aria-hidden="true" /> {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === "create" && (
            <InvoiceEditor vendors={vendors} vendorsProblem={vendorState.status === "error" ? vendorState.message : null} invoiceId={invoiceId}
              onSaved={(invoice) => { setHistoryKey((n) => n + 1); if (invoice.id !== invoiceId) go("create", invoice.id); }}
              onNew={() => go("create")} onManageVendors={() => go("vendors")} />
          )}
          {tab === "history" && <InvoiceHistory vendors={vendors} refreshKey={historyKey} onOpen={(id) => go("create", id)} />}
          {tab === "vendors" && (
            <VendorManager vendors={vendors} status={vendorState.status} message={vendorState.message} onRetry={loadVendors} onChanged={loadVendors} />
          )}
        </div>
      </main>
      <Nav />
    </div>
  );
}
