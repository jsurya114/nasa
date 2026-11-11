import { useState } from "react";
import Modal from "../../../reuse/Modal.jsx";
import { Field } from "./fields.jsx";
import { INPUT, invalid } from "./fieldStyles.js";
import { markPaymentReceived, problemOf } from "./invoiceApi.js";
import { LIMITS, amountText, chicagoToday, clean, isRealDate, usDate } from "./invoiceRules.js";

// "Mark payment received": records that the full amount of this invoice was received, outside NASA (no money moves here). Shows what is being
// confirmed (vendor, number, amount), the date it arrived (today in Chicago unless changed; never in the future) and an optional reference. Once
// recorded the invoice is locked. Saving twice (a double click, a retry) records it once: the server answers the repeat with the same record.
export default function PaymentDialog({ invoice, onClose, onRecorded }) {
  const today = chicagoToday();
  const [receivedOn, setReceivedOn] = useState(today);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [showErrors, setShowErrors] = useState(false);

  const errors = {};
  if (!isRealDate(receivedOn)) errors.receivedOn = "Enter the date the payment was received.";
  else if (receivedOn > today) errors.receivedOn = "The payment received date cannot be in the future.";
  if (clean(reference).length > LIMITS.reference) errors.reference = `Up to ${LIMITS.reference} characters.`;
  const shown = showErrors ? { ...errors, ...(problem?.errors ?? {}) } : {};

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setShowErrors(true);
    setProblem(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const saved = await markPaymentReceived(invoice.id, { receivedOn, reference: clean(reference), version: invoice.version });
      onRecorded(saved);
    } catch (error) {
      setProblem(problemOf(error, "The payment could not be recorded. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Mark payment received" onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 pt-3" data-testid="payment-form">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-line bg-canvas/60 p-3 text-sm" data-testid="payment-summary">
          <dt className="text-ink-muted">Vendor</dt><dd className="font-semibold text-ink">{invoice.vendorName ?? invoice.billTo?.name}</dd>
          <dt className="text-ink-muted">Invoice number</dt><dd className="font-semibold text-ink">{invoice.invoiceNumber}</dd>
          <dt className="text-ink-muted">Amount</dt><dd className="font-bold tabular-nums text-ink">{amountText(invoice.total)}</dd>
          <dt className="text-ink-muted">Invoice date</dt><dd className="text-ink">{usDate(invoice.invoiceDate)}</dd>
        </dl>
        <p className="text-sm text-ink-muted">This records that the full amount was received outside NASA. No money is sent or moved. The invoice is then locked: it can still be opened and downloaded, but no longer changed.</p>
        <Field id="received-on" label="Payment received date" error={shown.receivedOn}>
          <input id="received-on" type="date" max={today} className={INPUT} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} {...invalid("received-on", shown.receivedOn)} />
        </Field>
        <Field id="payment-reference" label="Payment reference (optional)" error={shown.reference} hint="A check number, transfer reference or note.">
          <input id="payment-reference" className={INPUT} value={reference} maxLength={LIMITS.reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" {...invalid("payment-reference", shown.reference)} />
        </Field>
        {problem && <p role="alert" className="text-sm text-red-600">{problem.message}</p>}
        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="ui-btn ui-btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="ui-btn ui-btn-primary">{busy ? "Recording..." : `Record ${amountText(invoice.total)} received`}</button>
        </div>
      </form>
    </Modal>
  );
}
