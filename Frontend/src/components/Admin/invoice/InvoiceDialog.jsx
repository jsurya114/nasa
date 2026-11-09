import { useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import Modal from "../../../reuse/Modal.jsx";
import { DEFAULT_BILL_TO, MAX_ROWS } from "./invoiceTemplate.js";
import { LIMITS, blankRow, checkInvoice, fileNameFor, hasErrors, totalDiffers, withDerivedTotal } from "./invoiceRules.js";

const INPUT = "w-full bg-white text-ink placeholder:text-ink-muted/70 transition-shadow border-line min-h-11 px-3 py-2 border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-500/20 aria-[invalid=true]:border-red-500";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="text-sm text-red-600">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

const newForm = () => ({
  invoiceNo: "", start: "", end: "",
  billName: DEFAULT_BILL_TO.name, billLine1: DEFAULT_BILL_TO.line1, billLine2: DEFAULT_BILL_TO.line2,
  rows: [blankRow()], includeSignature: true,
});

// The invoice form (a dialog on the Insights page). The bill-to block, the invoice number, the schedule and the job lines are typed here; the rest of
// the invoice is NASA's fixed template. "Download PDF" makes the file in this browser: nothing is sent to the server or saved anywhere, and closing
// the dialog discards what was typed.
export default function InvoiceDialog({ onClose }) {
  const [form, setForm] = useState(newForm);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [failed, setFailed] = useState("");
  const body = useRef(null);

  const { errors } = checkInvoice(form);
  const shown = showErrors ? errors : {};
  const rowErrors = shown.rowErrors ?? [];

  // After a refused download, the cursor goes to the first field that needs attention.
  useEffect(() => {
    if (showErrors) body.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [showErrors]);

  const set = (field) => (e) => { setDone(""); setForm((f) => ({ ...f, [field]: e.target.value })); };
  const setRow = (index, field, value) => {
    setDone("");
    setForm((f) => ({
      ...f,
      rows: f.rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [field]: value };
        // Typing a total of your own stops it following RE hours + overtime; emptying it hands it back.
        if (field === "totalHours") next.totalTouched = value.trim() !== "";
        return withDerivedTotal(next);
      }),
    }));
  };
  const addRow = () => setForm((f) => (f.rows.length >= MAX_ROWS ? f : { ...f, rows: [...f.rows, blankRow()] }));
  const removeRow = (index) => setForm((f) => (f.rows.length <= 1 ? f : { ...f, rows: f.rows.filter((_, i) => i !== index) }));

  const submit = async (event) => {
    event.preventDefault();
    setDone("");
    setFailed("");
    const { errors: found, invoice } = checkInvoice(form);
    if (hasErrors(found)) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      // The PDF library and the fonts are only loaded now, so the rest of the app never pays for them.
      const { downloadInvoice } = await import("./buildInvoicePdf.js");
      await downloadInvoice(invoice);
      setDone(`Downloaded ${fileNameFor(invoice.invoiceNo)}.`);
    } catch {
      setFailed("The invoice could not be made. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create invoice" onClose={onClose} busy={busy} size="lg">
      <form onSubmit={submit} noValidate ref={body} className="flex flex-col gap-5 pt-4" data-testid="invoice-form">
        <p className="text-sm text-ink-muted">Fill in the details and download the invoice as a PDF. It is made in your browser; nothing is saved or sent anywhere.</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="invoice-no" label="Invoice no" error={shown.invoiceNo}>
            <input id="invoice-no" className={INPUT} value={form.invoiceNo} onChange={set("invoiceNo")} maxLength={LIMITS.invoiceNo} placeholder="0028" autoComplete="off"
              aria-invalid={Boolean(shown.invoiceNo)} aria-describedby={shown.invoiceNo ? "invoice-no-error" : undefined} />
          </Field>
          <Field id="invoice-start" label="Schedule from" error={shown.start}>
            <input id="invoice-start" type="date" className={INPUT} value={form.start} onChange={set("start")} aria-invalid={Boolean(shown.start)} aria-describedby={shown.start ? "invoice-start-error" : undefined} />
          </Field>
          <Field id="invoice-end" label="Schedule to" error={shown.end}>
            <input id="invoice-end" type="date" className={INPUT} value={form.end} onChange={set("end")} aria-invalid={Boolean(shown.end)} aria-describedby={shown.end ? "invoice-end-error" : undefined} />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink">Bill to</legend>
          <Field id="bill-name" label="Name" error={shown.billName}>
            <input id="bill-name" className={INPUT} value={form.billName} onChange={set("billName")} maxLength={LIMITS.name} placeholder="GOFO INC." autoComplete="off"
              aria-invalid={Boolean(shown.billName)} aria-describedby={shown.billName ? "bill-name-error" : undefined} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="bill-line1" label="Address line 1" error={shown.billLine1}>
              <input id="bill-line1" className={INPUT} value={form.billLine1} onChange={set("billLine1")} maxLength={LIMITS.address} autoComplete="off" aria-invalid={Boolean(shown.billLine1)} />
            </Field>
            <Field id="bill-line2" label="Address line 2" error={shown.billLine2}>
              <input id="bill-line2" className={INPUT} value={form.billLine2} onChange={set("billLine2")} maxLength={LIMITS.address} autoComplete="off" aria-invalid={Boolean(shown.billLine2)} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink">Jobs</legend>
          {shown.rows && <p className="text-sm text-red-600">{shown.rows}</p>}
          {form.rows.map((row, i) => {
            const own = rowErrors[i] ?? {};
            const n = i + 1;
            return (
              <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-brand-50/30 p-3" data-testid={`invoice-job-${n}`}>
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field id={`job-${n}`} label={form.rows.length > 1 ? `Job ${n}` : "Job"} error={own.job}>
                      <input id={`job-${n}`} className={INPUT} value={row.job} onChange={(e) => setRow(i, "job", e.target.value)} maxLength={LIMITS.job} placeholder="General worker" autoComplete="off"
                        aria-invalid={Boolean(own.job)} aria-describedby={own.job ? `job-${n}-error` : undefined} />
                    </Field>
                  </div>
                  {form.rows.length > 1 && (
                    <button type="button" onClick={() => removeRow(i)} aria-label={`Remove job ${n}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-white text-ink-muted hover:bg-brand-50">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field id={`re-${n}`} label="Total RE hours" error={own.reHours}>
                    <input id={`re-${n}`} inputMode="decimal" className={INPUT} value={row.reHours} onChange={(e) => setRow(i, "reHours", e.target.value)} placeholder="360" autoComplete="off"
                      aria-invalid={Boolean(own.reHours)} aria-describedby={own.reHours ? `re-${n}-error` : undefined} />
                  </Field>
                  <Field id={`ot-${n}`} label="Overtime" error={own.overtime}>
                    <input id={`ot-${n}`} inputMode="decimal" className={INPUT} value={row.overtime} onChange={(e) => setRow(i, "overtime", e.target.value)} placeholder="71.05" autoComplete="off"
                      aria-invalid={Boolean(own.overtime)} aria-describedby={own.overtime ? `ot-${n}-error` : undefined} />
                  </Field>
                  <Field id={`total-${n}`} label="Total hours" error={own.totalHours} hint={totalDiffers(row) ? "Differs from RE hours + overtime." : undefined}>
                    <input id={`total-${n}`} inputMode="decimal" className={INPUT} value={row.totalHours} onChange={(e) => setRow(i, "totalHours", e.target.value)} placeholder="431.05" autoComplete="off"
                      aria-invalid={Boolean(own.totalHours)} aria-describedby={own.totalHours ? `total-${n}-error` : undefined} />
                  </Field>
                  <Field id={`cost-${n}`} label="Total cost ($)" error={own.totalCost}>
                    <input id={`cost-${n}`} inputMode="decimal" className={INPUT} value={row.totalCost} onChange={(e) => setRow(i, "totalCost", e.target.value)} placeholder="7543.37" autoComplete="off"
                      aria-invalid={Boolean(own.totalCost)} aria-describedby={own.totalCost ? `cost-${n}-error` : undefined} />
                  </Field>
                </div>
              </div>
            );
          })}
          <div>
            <button type="button" onClick={addRow} disabled={form.rows.length >= MAX_ROWS} className="ui-btn ui-btn-ghost">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add job
            </button>
            {form.rows.length >= MAX_ROWS && <span className="ml-3 text-xs text-ink-muted">An invoice holds up to {MAX_ROWS} jobs.</span>}
          </div>
        </fieldset>

        <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
          <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-800)]" checked={form.includeSignature} onChange={(e) => { setDone(""); setForm((f) => ({ ...f, includeSignature: e.target.checked })); }} />
          Include the signature
        </label>

        <div aria-live="polite" className="min-h-5 text-sm">
          {done && <p className="text-green-700" role="status">{done}</p>}
          {failed && <p className="text-red-600" role="alert">{failed}</p>}
          {showErrors && hasErrors(errors) && <p className="text-red-600" role="alert">Check the highlighted fields.</p>}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="ui-btn ui-btn-ghost">Close</button>
          <button type="submit" disabled={busy} className="ui-btn ui-btn-primary">
            <Download className="h-4 w-4" aria-hidden="true" /> {busy ? "Making PDF..." : "Download PDF"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
