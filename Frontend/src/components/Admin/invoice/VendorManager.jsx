import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import Modal from "../../../reuse/Modal.jsx";
import { Badge, Field } from "./fields.jsx";
import { INPUT, invalid } from "./fieldStyles.js";
import { TYPE_LABEL } from "./invoiceTemplate.js";
import { createVendor, problemOf, updateVendor } from "./invoiceApi.js";
import { LIMITS, clean } from "./invoiceRules.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLANK = { billingName: "", addressLine1: "", addressLine2: "", contactName: "", contactEmail: "", billingType: "" };

const check = (v) => {
  const errors = {};
  if (!clean(v.billingName)) errors.name = "Enter the billing name.";
  else if (clean(v.billingName).length > LIMITS.name) errors.name = `Up to ${LIMITS.name} characters.`;
  if (clean(v.addressLine1).length > LIMITS.address) errors.line1 = `Up to ${LIMITS.address} characters.`;
  if (clean(v.addressLine2).length > LIMITS.address) errors.line2 = `Up to ${LIMITS.address} characters.`;
  if (clean(v.contactName).length > LIMITS.contactName) errors.contactName = `Up to ${LIMITS.contactName} characters.`;
  if (clean(v.contactEmail) && !EMAIL.test(clean(v.contactEmail))) errors.contactEmail = "Enter a valid email address, or leave it empty.";
  if (!v.billingType) errors.billingType = "Choose Hourly or Item-based.";
  return errors;
};

function VendorForm({ vendor, onClose, onSaved }) {
  const [form, setForm] = useState(vendor ?? BLANK);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const errors = check(form);
  const shown = showErrors ? { ...errors, ...(problem?.errors ?? {}) } : {};
  const set = (field) => (e) => { setProblem(null); setForm((f) => ({ ...f, [field]: e.target.value })); };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setShowErrors(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const body = { billingName: form.billingName, addressLine1: form.addressLine1, addressLine2: form.addressLine2, contactName: form.contactName, contactEmail: form.contactEmail, billingType: form.billingType };
      onSaved(vendor ? await updateVendor(vendor.id, body) : await createVendor(body), Boolean(vendor));
    } catch (error) {
      setProblem(problemOf(error, "The vendor could not be saved. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={vendor ? `Edit ${vendor.billingName}` : "Add vendor"} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 pt-3" data-testid="vendor-form">
        <Field id="vendor-name" label="Billing name" error={shown.name}>
          <input id="vendor-name" className={INPUT} value={form.billingName} onChange={set("billingName")} maxLength={LIMITS.name} autoComplete="off" {...invalid("vendor-name", shown.name)} />
        </Field>
        <Field id="vendor-line1" label="Billing address line 1" error={shown.line1}>
          <input id="vendor-line1" className={INPUT} value={form.addressLine1} onChange={set("addressLine1")} maxLength={LIMITS.address} autoComplete="off" {...invalid("vendor-line1", shown.line1)} />
        </Field>
        <Field id="vendor-line2" label="Billing address line 2" error={shown.line2}>
          <input id="vendor-line2" className={INPUT} value={form.addressLine2} onChange={set("addressLine2")} maxLength={LIMITS.address} autoComplete="off" {...invalid("vendor-line2", shown.line2)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="vendor-contact" label="Contact name (optional)" error={shown.contactName}>
            <input id="vendor-contact" className={INPUT} value={form.contactName} onChange={set("contactName")} maxLength={LIMITS.contactName} autoComplete="off" {...invalid("vendor-contact", shown.contactName)} />
          </Field>
          <Field id="vendor-email" label="Contact email (optional)" error={shown.contactEmail}>
            <input id="vendor-email" type="email" className={INPUT} value={form.contactEmail} onChange={set("contactEmail")} maxLength={LIMITS.email} autoComplete="off" {...invalid("vendor-email", shown.contactEmail)} />
          </Field>
        </div>
        <fieldset aria-describedby={shown.billingType ? "vendor-type-error" : undefined}>
          <legend className="text-sm font-semibold text-ink">Billing type</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[["hourly", "Hourly", "Jobs with RE hours, overtime and total cost."], ["item", "Item-based", "One line per date: item, rate and quantity."]].map(([value, label, hint]) => (
              <label key={value} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${form.billingType === value ? "border-brand-500 bg-brand-50" : "border-line bg-white"}`}>
                <input type="radio" name="vendor-type" value={value} checked={form.billingType === value} onChange={set("billingType")} className="mt-0.5 h-5 w-5 accent-[var(--color-brand-800)]" />
                <span><span className="block font-semibold text-ink">{label}</span><span className="text-ink-muted">{hint}</span></span>
              </label>
            ))}
          </div>
          {shown.billingType && <p id="vendor-type-error" className="mt-1 text-sm text-red-600">{shown.billingType}</p>}
          {vendor && <p className="mt-2 text-xs text-ink-muted">Changes apply to new invoices. Invoices already saved keep the billing details and format they were made with.</p>}
        </fieldset>
        {problem && <p role="alert" className="text-sm text-red-600">{problem.message}</p>}
        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="ui-btn ui-btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="ui-btn ui-btn-primary">{busy ? "Saving..." : vendor ? "Save vendor" : "Add vendor"}</button>
        </div>
      </form>
    </Modal>
  );
}

// The vendors an invoice can be made for: billing name and address, an optional contact, and how they are billed.
export default function VendorManager({ vendors, status, message, onRetry, onChanged }) {
  const [editing, setEditing] = useState(null); // null | "new" | vendor
  const [note, setNote] = useState("");
  return (
    <section className="flex flex-col gap-4" data-testid="vendor-manager">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Choosing a vendor on an invoice fills in Bill to and opens its format. Editing a vendor never changes invoices already saved.</p>
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => { setNote(""); setEditing("new"); }}><Plus className="h-4 w-4" aria-hidden="true" /> Add vendor</button>
      </div>
      {note && <p role="status" className="text-sm text-green-700">{note}</p>}
      {status === "error" ? (
        <div role="alert" className="card-surface p-5">
          <p className="font-semibold text-ink">The vendors could not be loaded</p>
          <p className="mt-1 text-sm text-ink-muted">{message}</p>
          <button type="button" className="ui-btn ui-btn-ghost mt-3" onClick={onRetry}>Try again</button>
        </div>
      ) : !vendors ? (
        <div className="card-surface p-5 text-sm text-ink-muted" role="status">Loading vendors...</div>
      ) : vendors.length === 0 ? (
        <div className="card-surface p-6 text-center"><p className="font-semibold text-ink">No vendors yet</p><p className="mt-1 text-sm text-ink-muted">Add the first one to start invoicing.</p></div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {vendors.map((v) => (
            <li key={v.id} className="card-surface flex items-start justify-between gap-3 p-4" data-testid={`vendor-${v.id}`}>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-bold text-ink">{v.billingName} <Badge tone="brand">{TYPE_LABEL[v.billingType]}</Badge></p>
                {[v.addressLine1, v.addressLine2].filter(Boolean).map((line) => <p key={line} className="text-ink-muted">{line}</p>)}
                {(v.contactName || v.contactEmail) && <p className="mt-1 text-ink-muted">{[v.contactName, v.contactEmail].filter(Boolean).join(" · ")}</p>}
              </div>
              <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-white hover:bg-brand-50" aria-label={`Edit ${v.billingName}`} onClick={() => { setNote(""); setEditing(v); }}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <VendorForm vendor={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={(vendor, edited) => { setEditing(null); setNote(`${edited ? "Saved" : "Added"} ${vendor.billingName}.`); onChanged(vendor); }} />
      )}
    </section>
  );
}
