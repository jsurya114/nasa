import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, FilePlus2, Lock, Save } from "lucide-react";
import { Badge, ConfirmDialog, Field } from "./fields.jsx";
import { INPUT, invalid } from "./fieldStyles.js";
import HourlyLines from "./HourlyLines.jsx";
import ItemLines from "./ItemLines.jsx";
import PaymentDialog from "./PaymentDialog.jsx";
import { TYPE_LABEL } from "./invoiceTemplate.js";
import { createInvoice, getInvoice, newRequestId, nextInvoiceNumber, problemOf, updateInvoice } from "./invoiceApi.js";
import {
  LIMITS, amountText, blankRow, chicagoToday, checkInvoice, clean, entriesOutside, fileNameFor, formFromInvoice, hasErrors, isBlankHourly, isBlankItem, usDate,
} from "./invoiceRules.js";

const EMPTY_BILL_TO = { name: "", line1: "", line2: "", contactName: "", contactEmail: "" };
const newForm = () => ({ invoiceNumber: "", vendorId: null, type: null, periodStart: "", periodEnd: "", billTo: EMPTY_BILL_TO, includeSignature: true, rows: [blankRow()], entries: {} });
const billToOf = (v) => ({ name: v.billingName, line1: v.addressLine1, line2: v.addressLine2, contactName: v.contactName, contactEmail: v.contactEmail });
const sameBillTo = (a, b) => Object.keys(EMPTY_BILL_TO).every((k) => clean(a[k]) === clean(b[k]));
const linesEntered = (form) => (form.type === "hourly" ? form.rows.filter((r) => !isBlankHourly(r)).length : Object.values(form.entries).filter((r) => !isBlankItem(r)).length);

// Loads the PDF builder (and its fonts) only when a PDF is wanted.
const pdf = () => import("./buildInvoicePdf.js");

// Create a new invoice, or open a saved one. Choosing a vendor fills in Bill to and picks the form (Hourly or Item-based). Saving stores it; the PDF
// is always made from what was saved. A pending invoice can be changed and saved again under the same number (never a second invoice); a paid one
// is locked and can only be viewed and downloaded.
export default function InvoiceEditor({ vendors, vendorsProblem, invoiceId, onSaved, onNew, onManageVendors }) {
  const [status, setStatus] = useState(invoiceId ? "loading" : "ready");
  const [loadProblem, setLoadProblem] = useState("");
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(newForm);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone: "ok" | "error", text, code }
  const [confirm, setConfirm] = useState(null);
  const [paying, setPaying] = useState(false);
  const requestId = useRef(newRequestId());
  const formRef = useRef(null);

  const load = async (id) => {
    setStatus("loading");
    try {
      const invoice = await getInvoice(id);
      setSaved(invoice);
      setForm(formFromInvoice(invoice));
      setDirty(false);
      setShowErrors(false);
      setServerErrors(null);
      setStatus("ready");
    } catch (error) {
      setLoadProblem(problemOf(error, "The invoice could not be loaded. Check your connection and try again.").message);
      setStatus("error");
    }
  };

  useEffect(() => {
    let live = true;
    if (invoiceId) {
      // The invoice just saved here is already open (its id has only now reached the address): keep it and its "Saved" message.
      if (saved?.id !== invoiceId) { setNote(null); load(invoiceId); }
    } else {
      setNote(null);
      setSaved(null);
      setForm(newForm());
      setDirty(false);
      setShowErrors(false);
      setServerErrors(null);
      setStatus("ready");
      requestId.current = newRequestId();
      // The next number after the highest one used; it can be changed.
      nextInvoiceNumber().then((n) => live && setForm((f) => (f.invoiceNumber ? f : { ...f, invoiceNumber: n }))).catch(() => {});
    }
    return () => { live = false; };
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const paid = saved?.status === "paid";
  const locked = paid || busy;
  const { errors: clientErrors } = checkInvoice(form);
  const errors = showErrors ? (serverErrors ?? clientErrors) : {};
  const vendor = vendors?.find((v) => v.id === form.vendorId) ?? null;
  const outside = form.type === "item" ? entriesOutside(form.periodStart, form.periodEnd, form.entries) : [];

  useEffect(() => {
    if (showErrors) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [showErrors, serverErrors]);

  const change = (patch) => {
    setDirty(true);
    setNote(null);
    setServerErrors(null);
    setForm((f) => ({ ...f, ...(typeof patch === "function" ? patch(f) : patch) }));
  };
  const setBill = (field) => (e) => change((f) => ({ billTo: { ...f.billTo, [field]: e.target.value } }));

  // Choosing a vendor fills Bill to from it and opens its form. Anything that would be thrown away is asked about first.
  const chooseVendor = (id) => {
    const next = vendors.find((v) => v.id === Number(id));
    if (!next || next.id === form.vendorId) return;
    const apply = () => {
      setConfirm(null);
      change((f) => ({
        vendorId: next.id, type: next.billingType, billTo: billToOf(next),
        ...(f.type !== next.billingType && { rows: [blankRow()], entries: {} }),
      }));
    };
    const typeChanges = form.type && form.type !== next.billingType;
    const lost = [];
    const count = linesEntered(form);
    if (typeChanges && count > 0) lost.push(`the ${count} ${count === 1 ? "line" : "lines"} you entered (${next.billingName} is billed ${TYPE_LABEL[next.billingType]}, a different form)`);
    if (vendor && !sameBillTo(form.billTo, billToOf(vendor))) lost.push("the changes you made to Bill to");
    if (lost.length === 0) { apply(); return; }
    setConfirm({
      title: `Switch to ${next.billingName}?`,
      body: <p>This replaces {lost.join(" and ")}.</p>,
      confirmLabel: "Switch vendor",
      onConfirm: apply,
    });
  };

  const download = async (invoice) => {
    const { downloadInvoice } = await pdf();
    await downloadInvoice(invoice);
  };

  const save = async (then, { dropOutside = false } = {}) => {
    if (busy || paid) return;
    const { errors: found, body } = checkInvoice(form);
    setServerErrors(null);
    if (hasErrors(found)) {
      setShowErrors(true);
      setNote({ tone: "error", text: "Check the highlighted fields." });
      return;
    }
    if (outside.length > 0 && !dropOutside) {
      setConfirm({
        title: "Leave out lines outside the billing period?",
        body: <p>{outside.length} {outside.length === 1 ? "line" : "lines"} ({outside.map(usDate).join(", ")}) {outside.length === 1 ? "is" : "are"} outside {usDate(form.periodStart)} to {usDate(form.periodEnd)} and will be removed when you save.</p>,
        confirmLabel: "Save without them",
        onConfirm: () => { setConfirm(null); save(then, { dropOutside: true }); },
      });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const invoice = saved ? await updateInvoice(saved.id, body, saved.version) : await createInvoice(body, requestId.current);
      requestId.current = newRequestId();
      setSaved(invoice);
      setForm(formFromInvoice(invoice));
      setDirty(false);
      setShowErrors(false);
      onSaved(invoice);
      let text = `Saved invoice ${invoice.invoiceNumber} (${amountText(invoice.total)}).`;
      if (then === "download") {
        try {
          await download(invoice);
          text = `Saved and downloaded ${fileNameFor(invoice.invoiceNumber)}.`;
        } catch {
          text = `Saved invoice ${invoice.invoiceNumber}, but the PDF could not be made. Use Download PDF to try again.`;
        }
      }
      setNote({ tone: "ok", text });
    } catch (error) {
      const problem = problemOf(error, "The invoice could not be saved. Check your connection and try again.");
      if (problem.errors) {
        setServerErrors(problem.errors);
        setShowErrors(true);
      }
      setNote({ tone: "error", text: problem.message, code: problem.code });
    } finally {
      setBusy(false);
    }
  };

  const fromSaved = async (action) => {
    if (!saved) return;
    // A tab opened now, before the PDF is made, so the browser does not treat it as an unwanted pop-up.
    const tab = action === "preview" ? window.open("", "_blank") : null;
    setBusy(true);
    try {
      const module = await pdf();
      if (action === "preview") await module.previewInvoice(saved, tab);
      else await module.downloadInvoice(saved);
    } catch {
      tab?.close();
      setNote({ tone: "error", text: "The PDF could not be made. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const vendorOptions = useMemo(() => vendors ?? [], [vendors]);

  if (status === "loading") return <div className="card-surface p-5 text-sm text-ink-muted" role="status">Loading the invoice...</div>;
  if (status === "error") {
    return (
      <div className="card-surface p-5" role="alert">
        <p className="font-semibold text-ink">The invoice could not be opened</p>
        <p className="mt-1 text-sm text-ink-muted">{loadProblem}</p>
        <div className="mt-3 flex gap-3">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => load(invoiceId)}>Try again</button>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onNew}>New invoice</button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="card-surface flex flex-col gap-5 p-4 sm:p-5" data-testid="invoice-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">{saved ? `Invoice ${saved.invoiceNumber}` : "New invoice"}</h2>
          <p className="text-sm text-ink-muted">
            {saved ? `Saved ${usDate(saved.invoiceDate)}. ` : ""}
            {paid ? "Payment received: this invoice is locked." : saved ? "Pending: changes are saved under the same number." : "Choose a vendor to start."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {form.type && <Badge tone="brand" testId="invoice-format">Format: {TYPE_LABEL[form.type]}</Badge>}
          {saved && <Badge tone={paid ? "paid" : "pending"} testId="invoice-status">{paid ? "Payment received" : "Pending"}</Badge>}
          {saved && <button type="button" onClick={onNew} className="ui-btn ui-btn-ghost"><FilePlus2 className="h-4 w-4" aria-hidden="true" /> New invoice</button>}
        </div>
      </div>

      {paid && (
        <p className="flex items-start gap-2 rounded-xl border border-emerald-700 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="paid-banner">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Payment of {amountText(saved.total)} received on {usDate(saved.paymentReceivedOn)}{saved.paymentReference ? ` (reference ${saved.paymentReference})` : ""}. It can be viewed and downloaded, but no longer changed.</span>
        </p>
      )}

      <fieldset disabled={locked} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="invoice-vendor" label="Vendor" error={errors.vendorId ?? errors.type}
            hint={vendorsProblem ?? (vendorOptions.length === 0 ? "No vendors yet: add one under Manage vendors." : saved ? "A saved invoice keeps its format: only vendors billed the same way can be chosen." : undefined)}>
            <select id="invoice-vendor" className={INPUT} value={form.vendorId ?? ""} onChange={(e) => chooseVendor(e.target.value)} {...invalid("invoice-vendor", errors.vendorId ?? errors.type)}>
              <option value="" disabled>Choose a vendor</option>
              {vendorOptions.map((v) => (
                <option key={v.id} value={v.id} disabled={Boolean(saved) && v.billingType !== saved.type}>{v.billingName} ({TYPE_LABEL[v.billingType]})</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button type="button" onClick={onManageVendors} className="min-h-11 text-sm font-semibold text-brand underline">Manage vendors</button>
          </div>
        </div>

        {form.type && (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field id="invoice-number" label="Invoice number" error={errors.invoiceNumber} hint="Filled in with the next number; you can change it.">
                <input id="invoice-number" className={INPUT} value={form.invoiceNumber} onChange={(e) => change({ invoiceNumber: e.target.value })} maxLength={LIMITS.invoiceNumber} autoComplete="off" {...invalid("invoice-number", errors.invoiceNumber)} />
              </Field>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold text-ink">Invoice date</span>
                <p className="flex min-h-11 items-center text-sm text-ink" data-testid="invoice-date">{saved ? usDate(saved.invoiceDate) : `${usDate(chicagoToday())} (set when first saved)`}</p>
              </div>
              <Field id="period-start" label="Billing period from" error={errors.periodStart}>
                <input id="period-start" type="date" className={INPUT} value={form.periodStart} onChange={(e) => change({ periodStart: e.target.value })} {...invalid("period-start", errors.periodStart)} />
              </Field>
              <Field id="period-end" label="Billing period to" error={errors.periodEnd}>
                <input id="period-end" type="date" className={INPUT} value={form.periodEnd} min={form.periodStart || undefined} onChange={(e) => change({ periodEnd: e.target.value })} {...invalid("period-end", errors.periodEnd)} />
              </Field>
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-bold text-ink">Bill to</legend>
              <p className="-mt-1 text-xs text-ink-muted">Filled in from the vendor. Changes here apply to this invoice only.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="bill-name" label="Billing name" error={errors["billTo.name"]} className="sm:col-span-2">
                  <input id="bill-name" className={INPUT} value={form.billTo.name} onChange={setBill("name")} maxLength={LIMITS.name} autoComplete="off" {...invalid("bill-name", errors["billTo.name"])} />
                </Field>
                <Field id="bill-line1" label="Address line 1" error={errors["billTo.line1"]}>
                  <input id="bill-line1" className={INPUT} value={form.billTo.line1} onChange={setBill("line1")} maxLength={LIMITS.address} autoComplete="off" {...invalid("bill-line1", errors["billTo.line1"])} />
                </Field>
                <Field id="bill-line2" label="Address line 2" error={errors["billTo.line2"]}>
                  <input id="bill-line2" className={INPUT} value={form.billTo.line2} onChange={setBill("line2")} maxLength={LIMITS.address} autoComplete="off" {...invalid("bill-line2", errors["billTo.line2"])} />
                </Field>
                <Field id="bill-contact" label="Contact name (optional)" error={errors["billTo.contactName"]}>
                  <input id="bill-contact" className={INPUT} value={form.billTo.contactName} onChange={setBill("contactName")} maxLength={LIMITS.contactName} autoComplete="off" {...invalid("bill-contact", errors["billTo.contactName"])} />
                </Field>
                <Field id="bill-email" label="Contact email (optional)" error={errors["billTo.contactEmail"]}>
                  <input id="bill-email" type="email" className={INPUT} value={form.billTo.contactEmail} onChange={setBill("contactEmail")} maxLength={LIMITS.email} autoComplete="off" {...invalid("bill-email", errors["billTo.contactEmail"])} />
                </Field>
              </div>
            </fieldset>

            {form.type === "hourly"
              ? <HourlyLines rows={form.rows} onChange={(rows) => change({ rows })} errors={errors} disabled={locked} />
              : <ItemLines start={form.periodStart} end={form.periodEnd} entries={form.entries} onChange={(entries) => change({ entries })} errors={errors} disabled={locked} />}

            <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-800)]" checked={form.includeSignature} onChange={(e) => change({ includeSignature: e.target.checked })} />
              Include the signature
            </label>
          </>
        )}
      </fieldset>

      <div aria-live="polite" className="min-h-5 text-sm">
        {note && (
          <p className={note.tone === "ok" ? "text-green-700" : "text-red-600"} role={note.tone === "ok" ? "status" : "alert"} data-testid="invoice-note">
            {note.text}{" "}
            {note.code === "stale" && <button type="button" className="font-semibold underline" onClick={() => load(saved.id)}>Open the latest version</button>}
            {note.code === "invoice_paid" && <button type="button" className="font-semibold underline" onClick={() => load(saved.id)}>Reload</button>}
          </p>
        )}
      </div>

      {form.type && (
        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
          {saved && !dirty && (
            <>
              <button type="button" onClick={() => fromSaved("preview")} disabled={busy} className="ui-btn ui-btn-ghost"><Eye className="h-4 w-4" aria-hidden="true" /> Preview</button>
              <button type="button" onClick={() => fromSaved("download")} disabled={busy} className="ui-btn ui-btn-ghost"><Download className="h-4 w-4" aria-hidden="true" /> Download PDF</button>
              {!paid && <button type="button" onClick={() => setPaying(true)} disabled={busy} className="ui-btn ui-btn-ghost">Mark payment received</button>}
            </>
          )}
          {!paid && (
            <>
              <button type="submit" disabled={busy || (saved && !dirty)} className="ui-btn ui-btn-ghost"><Save className="h-4 w-4" aria-hidden="true" /> {busy ? "Saving..." : saved ? "Save changes" : "Save"}</button>
              <button type="button" onClick={() => save("download")} disabled={busy || (saved && !dirty)} className="ui-btn ui-btn-primary"><Download className="h-4 w-4" aria-hidden="true" /> Save and download PDF</button>
            </>
          )}
        </div>
      )}

      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
      {paying && saved && (
        <PaymentDialog invoice={saved} onClose={() => setPaying(false)} onRecorded={(invoice) => {
          setPaying(false);
          setSaved(invoice);
          setForm(formFromInvoice(invoice));
          onSaved(invoice);
          setNote({ tone: "ok", text: `Payment received recorded for invoice ${invoice.invoiceNumber}.` });
        }} />
      )}
    </form>
  );
}
