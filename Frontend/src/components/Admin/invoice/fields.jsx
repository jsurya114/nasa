import Modal from "../../../reuse/Modal.jsx";

// Shared pieces of the Invoices page forms.

export function Field({ id, label, error, hint, children, className = "" }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="text-sm text-red-600">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Badge({ tone = "neutral", children, testId }) {
  const tones = {
    neutral: "border-line bg-white text-ink",
    pending: "border-amber-600 bg-amber-50 text-amber-800",
    paid: "border-emerald-700 bg-emerald-50 text-emerald-800",
    brand: "border-brand-500 bg-brand-50 text-brand",
  };
  return <span data-testid={testId} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

// "Are you sure?" before something that throws away what was typed.
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="flex flex-col gap-4 pt-3">
        <div className="text-sm text-ink">{body}</div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="ui-btn ui-btn-ghost">Cancel</button>
          <button type="button" onClick={onConfirm} className="ui-btn ui-btn-primary">{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
