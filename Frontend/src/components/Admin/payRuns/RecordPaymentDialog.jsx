import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { CheckCircle2, X } from "lucide-react";
import axios from "../../../redux/slice/axiosInstance";
import { newRequestId } from "../../../utils/requestId.js";
import { toLocalDateString } from "../../../utils/dateRange.js";
import { formatMoney } from "../../../utils/money.js";
import {
  Field,
  inputClass,
  buttonClass,
  primaryClass,
} from "../payroll/formParts.jsx";

const METHODS = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  other: "Other",
};
const paid = (d) => d.payoutStatus === "paid";

// Both entry points use this review and the same idempotent, audited server action. No provider is called here.
export default function RecordPaymentDialog({
  runId,
  cityName,
  onClose,
  onRecorded,
}) {
  const [review, setReview] = useState({ status: "loading", data: null });
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState("review");
  const bodyRef = useRef(null);
  const stepTitle = useRef(null);
  const [form, setForm] = useState(() => ({
    requestId: newRequestId(),
    paidOn: toLocalDateString(new Date()),
    method: "",
    reference: "",
    confirmed: false,
  }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    stepTitle.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setReview((s) => ({ ...s, status: "loading" }));
    axios
      .get(`/admin/payroll/payments/runs/${runId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setReview({ status: "ready", data });
        const unpaid = data.drivers
          .filter((d) => !paid(d))
          .map((d) => String(d.statementId));
        setSelected((s) =>
          s === null ? unpaid : s.filter((id) => unpaid.includes(id)),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setReview({
            status: "error",
            data: null,
            message: error.response?.data?.message,
          });
      });
    return () => controller.abort();
  }, [runId, version]);

  const drivers = review.data?.drivers ?? [];
  const allPaid = drivers.length > 0 && drivers.every(paid);
  const chosen = drivers.filter((d) =>
    selected?.includes(String(d.statementId)),
  );
  const blocked = chosen.some((d) =>
    d.blockers.some((b) => b.severity === "blocking"),
  );
  const total = (
    chosen.reduce((n, d) => n + Math.round(Number(d.amounts.net) * 100), 0) /
    100
  ).toFixed(2);
  const visible = drivers.filter((d) =>
    d.driverName.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const set = (key) => (e) => {
    setForm((f) => ({
      ...f,
      ...(key !== "confirmed" && { confirmed: false }),
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
    setErrors((old) => ({ ...old, [key]: undefined }));
  };
  const selectDrivers = (selection) => {
    setSelected(selection);
    setForm((f) => ({ ...f, confirmed: false }));
  };
  const toggle = (id) =>
    selectDrivers((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const submit = async (e) => {
    e.preventDefault();
    if (step === "review") {
      if (chosen.length && !blocked) setStep("payment");
      return;
    }
    const found = {};
    if (!form.paidOn || form.paidOn > toLocalDateString(new Date()))
      found.paidOn = "Choose a payment date up to today.";
    if (!form.method) found.method = "Choose how the drivers were paid.";
    if (form.reference.trim().length < 3)
      found.reference = "Add a reference or note (at least 3 characters).";
    if (!form.confirmed)
      found.confirmed = "Confirm receipt before recording payment.";
    setErrors(found);
    if (
      Object.keys(found).length ||
      !chosen.length ||
      blocked ||
      busy ||
      review.status !== "ready"
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const all = drivers.filter((d) => !paid(d));
      const statementIds =
        chosen.length === all.length
          ? null
          : chosen.map((d) => Number(d.statementId));
      const { data } = await axios.post(
        `/admin/payroll/payments/runs/${runId}/record`,
        { ...form, reference: form.reference.trim(), statementIds },
      );
      if (mounted.current) {
        setResult(data);
        onRecorded();
      }
    } catch (error) {
      setErrors(error.response?.data?.errors ?? {});
      setMessage(
        error.response?.data?.message ??
          "The result could not be confirmed. Retry with this form, or refresh payment statuses first.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      className="relative z-[70]"
    >
      <div
        className="fixed inset-0 bg-slate-950/45 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-2 sm:p-6">
        <DialogPanel className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-line p-4 sm:p-6">
            <div>
              <DialogTitle className="text-xl font-bold text-ink">
                {result
                  ? "Payment recorded"
                  : allPaid
                    ? "Payment records"
                    : "Record completed payments"}
              </DialogTitle>
              <p className="mt-1 text-sm text-ink-muted">
                {cityName} · {review.data?.run.period_start} –{" "}
                {review.data?.run.period_end}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close payment review"
              disabled={busy}
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {result ? (
            <div className="overflow-y-auto p-5 sm:p-8">
              <CheckCircle2
                className="mb-3 h-10 w-10 text-green-600"
                aria-hidden="true"
              />
              <p className="text-lg font-semibold">
                {result.receipt
                  ? `${result.receipt.drivers} driver${result.receipt.drivers === 1 ? "" : "s"} marked paid`
                  : "These drivers are already marked paid"}
              </p>
              {result.receipt && (
                <>
                  <p className="mt-2 text-3xl font-bold text-brand">
                    {formatMoney(result.receipt.total)}
                  </p>
                  <p className="mt-3 text-sm">
                    Paid on {result.receipt.paid_on} ·{" "}
                    {METHODS[result.receipt.method]}
                    <br />
                    Reference: {result.receipt.reference}
                    <br />
                    Recorded by {result.receipt.recorded_by_name}
                  </p>
                </>
              )}
              <p className="mt-4 text-sm text-ink-muted">
                The included work and driver statements now agree. Any remaining
                driver debt stays outstanding. No bank transfer was made by this
                action.
              </p>
              <button
                type="button"
                onClick={onClose}
                className={`${primaryClass} mt-6`}
              >
                Done
              </button>
            </div>
          ) : review.status !== "ready" ? (
            <div className="p-6">
              <p role="status">
                {review.status === "loading"
                  ? "Loading approved payments…"
                  : (review.message ??
                    "The payment review could not be loaded.")}
              </p>
              {review.status === "error" && (
                <button
                  type="button"
                  onClick={() => setVersion((v) => v + 1)}
                  className={`${buttonClass} mt-3`}
                >
                  Try again
                </button>
              )}
            </div>
          ) : (
            <form
              noValidate
              onSubmit={submit}
              className="flex min-h-0 flex-col"
            >
              <div
                ref={bodyRef}
                className="space-y-4 overflow-y-auto p-4 sm:p-6"
              >
                {!allPaid && (
                  <h3
                    ref={stepTitle}
                    tabIndex={-1}
                    aria-live="polite"
                    className="font-semibold text-brand"
                  >
                    {step === "review"
                      ? "1. Review drivers"
                      : "2. Payment details"}
                  </h3>
                )}
                <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-dark">
                  {allPaid
                    ? "All driver payments in this run are recorded. Payment dates, references and confirmation details are kept below."
                    : "Use this after the drivers have received their money. You are recording completed payments using the approved amounts."}
                </p>
                {!allPaid && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-ink-muted">
                        Selected: {chosen.length} of{" "}
                        {drivers.filter((d) => !paid(d)).length} unpaid drivers
                      </p>
                      <p className="text-2xl font-bold text-brand">
                        {formatMoney(total)}
                      </p>
                    </div>
                    {step === "review" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className={buttonClass}
                          onClick={() =>
                            selectDrivers(
                              drivers
                                .filter((d) => !paid(d))
                                .map((d) => String(d.statementId)),
                            )
                          }
                        >
                          Select all unpaid
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={buttonClass}
                          onClick={() => selectDrivers([])}
                        >
                          Deselect all
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {(allPaid || step === "review") && (
                  <>
                    <input
                      type="search"
                      aria-label="Find a driver in payment review"
                      placeholder="Find a driver…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className={inputClass}
                    />
                    <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                      {visible.map((d) => (
                        <li key={d.statementId} className="p-3">
                          <label className="flex min-h-11 items-center gap-3">
                            {!paid(d) && (
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={Boolean(
                                  selected?.includes(String(d.statementId)),
                                )}
                                onChange={() => toggle(String(d.statementId))}
                                className="h-5 w-5 shrink-0"
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">
                                {d.driverName}
                              </span>
                              <span
                                className={`text-xs ${paid(d) ? "text-green-700" : d.eligible ? "text-ink-muted" : "text-amber-800"}`}
                              >
                                {paid(d)
                                  ? "Paid"
                                  : d.eligible
                                    ? "Awaiting payment"
                                    : "Needs review"}
                              </span>
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatMoney(d.amounts.net)}
                            </span>
                          </label>
                          {!paid(d) &&
                            d.blockers
                              .filter((b) => b.code !== "already_paid")
                              .map((b, i) => (
                                <p
                                  key={`${b.code}-${i}`}
                                  className="mt-1 text-xs text-amber-800"
                                >
                                  {b.message}
                                </p>
                              ))}
                          {d.payment && (
                            <p className="mt-1 text-xs text-ink-muted">
                              {d.payment.paid_on} · {METHODS[d.payment.method]}{" "}
                              · {d.payment.reference} ·{" "}
                              {d.payment.recorded_by_name}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    {blocked && (
                      <p
                        role="alert"
                        className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
                      >
                        Some selected payments need review. Resolve them, or
                        unselect those drivers before continuing.
                      </p>
                    )}
                    {review.data.summary.pendingClaims.total > 0 && (
                      <p className="text-sm text-amber-800">
                        {review.data.summary.pendingClaims.total} city claim(s)
                        are still unresolved. They are not deducted in these
                        approved payments.
                      </p>
                    )}
                  </>
                )}
                {!allPaid && step === "payment" && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Paid on" error={errors.paidOn}>
                        <input
                          type="date"
                          value={form.paidOn}
                          max={toLocalDateString(new Date())}
                          onChange={set("paidOn")}
                          disabled={busy}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Payment method" error={errors.method}>
                        <select
                          value={form.method}
                          onChange={set("method")}
                          disabled={busy}
                          className={inputClass}
                        >
                          <option value="">Choose a method</option>
                          {Object.entries(METHODS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field
                      label="Reference / payment note"
                      error={errors.reference}
                    >
                      <input
                        value={form.reference}
                        onChange={set("reference")}
                        disabled={busy}
                        maxLength={200}
                        placeholder="Bank reference, receipt number or cash handover details"
                        className={inputClass}
                      />
                    </Field>
                    <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={form.confirmed}
                        onChange={set("confirmed")}
                        disabled={busy}
                        className="mt-0.5 h-5 w-5 shrink-0"
                      />
                      I confirm the selected drivers have received any amounts
                      due.
                    </label>
                    <p className="text-xs text-ink-muted">
                      This creates a permanent payment record. Check the
                      selected drivers and total before confirming.
                    </p>
                    {errors.confirmed && (
                      <p role="alert" className="text-sm text-red-700">
                        {errors.confirmed}
                      </p>
                    )}
                  </>
                )}
                {message && (
                  <div
                    role="alert"
                    className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
                  >
                    <p>{message}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelected(null);
                        setStep("review");
                        setForm((f) => ({
                          ...f,
                          requestId: newRequestId(),
                          confirmed: false,
                        }));
                        setErrors({});
                        setMessage("");
                        setVersion((v) => v + 1);
                      }}
                      className={`${buttonClass} mt-2`}
                    >
                      Refresh and review remaining payments
                    </button>
                  </div>
                )}
                {Object.entries(errors)
                  .filter(
                    ([key, value]) =>
                      value &&
                      !["paidOn", "method", "reference", "confirmed"].includes(
                        key,
                      ),
                  )
                  .map(([key, value]) => (
                    <p key={key} role="alert" className="text-sm text-red-700">
                      {value}
                    </p>
                  ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-white p-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className={buttonClass}
                >
                  {allPaid ? "Done" : "Cancel"}
                </button>
                {!allPaid && step === "payment" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStep("review")}
                    className={buttonClass}
                  >
                    Back
                  </button>
                )}
                {!allPaid && (
                  <button
                    type={step === "review" ? "button" : "submit"}
                    onClick={
                      step === "review" ? () => setStep("payment") : undefined
                    }
                    disabled={busy || !chosen.length || blocked}
                    className={primaryClass}
                  >
                    {busy
                      ? "Recording…"
                      : step === "review"
                        ? "Continue to payment details"
                        : `Mark ${chosen.length} as paid`}
                  </button>
                )}
              </div>
            </form>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
