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
import EvereeRunResults from "./everee/EvereeRunResults.jsx";
import EvereeApprovalLink from "./everee/EvereeApprovalLink.jsx";
import EvereeSummary from "./everee/EvereeSummary.jsx";
import ProviderPaymentLine from "./everee/ProviderPaymentLine.jsx";
import useEvereeAvailable from "./everee/useEvereeAvailable.js";
import QuickbooksSummary from "./quickbooks/QuickbooksSummary.jsx";
import QuickbooksResult from "./quickbooks/QuickbooksResult.jsx";
import useQuickbooksPaymentsAvailable from "./quickbooks/useQuickbooksPaymentsAvailable.js";
import DriverTypeTabs from "./DriverTypeTabs.jsx";
import { typeOf } from "./driverTypes.js";

// Names for the methods of saved receipts (a receipt made before "Bank transfer (Everee)" existed says "Bank transfer").
const METHODS = {
  bank_transfer: "Bank transfer",
  cash: "Cash in Hand",
  other: "Other",
};
const CASH = "cash";
const EVEREE = "everee";
const QUICKBOOKS = "quickbooks";
const QUICKBOOKS_LABEL = "Check, recorded in QuickBooks";
const EVEREE_LABEL = "Bank transfer (Everee)";
const EVEREE_BASE = "/admin/payroll";
const paid = (d) => d.payoutStatus === "paid";
// A payment already with Everee (submitted, or unconfirmed) is not left to pay: it is not selected or selectable, and it waits for Everee to confirm.
const processing = (d) => d.payoutStatus === "submitted" || d.payoutStatus === "unconfirmed";
const payable = (d) => !paid(d) && !processing(d);
// Drivers are paid by type: Local (Cash in Hand or Everee), Desi (Cash in Hand only). A driver with no type cannot be paid. The server enforces the same.
const firstTab = (drivers) => ["LOCAL", "DESI"].find((k) => drivers.some((d) => typeOf(d) === k && payable(d))) ?? "LOCAL";

// "Pay to drivers": both entry points use this review. The method is chosen on purpose (nothing is pre-selected). Bank transfer (Everee) sends the
// chosen drivers' approved amounts through Everee, and only that method calls Everee. Cash and Other record money paid outside NASA and send nothing.
// Either way the server uses its own approved amounts, one idempotent request, and the same run, city and statement locks.
export default function RecordPaymentDialog({
  runId,
  cityName,
  onClose,
  onRecorded,
}) {
  const selectedRef = useRef(null);
  const [review, setReview] = useState({ status: "loading", data: null });
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("LOCAL");
  selectedRef.current = selected;
  const [search, setSearch] = useState("");
  const [step, setStep] = useState("review");
  const bodyRef = useRef(null);
  const stepTitle = useRef(null);
  const evereeAvailable = useEvereeAvailable();
  const quickbooksAvailable = useQuickbooksPaymentsAvailable();
  const [form, setForm] = useState(() => ({
    requestId: newRequestId(),
    paidOn: toLocalDateString(new Date()),
    method: "",
    note: "",
    confirmed: false,
  }));
  const [everee, setEveree] = useState({ preview: null, loading: false, error: "" });
  const [evereeSent, setEvereeSent] = useState(false);
  const [qb, setQb] = useState({ preview: null, loading: false, error: "" });
  const [qbBatchId, setQbBatchId] = useState(null);
  const qbConfirm = useRef({ hash: null, requestId: null });
  const [resultsKey, setResultsKey] = useState(0);
  const evereeConfirm = useRef({ hash: null, requestId: null });
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
          .filter(payable)
          .map((d) => String(d.statementId));
        // First load (nothing chosen yet): open the first tab that has drivers to pay and select its drivers. A refresh keeps the choice that is still valid.
        if (selectedRef.current === null) {
          const first = firstTab(data.drivers);
          setTab(first);
          setSelected(data.drivers.filter((d) => payable(d) && typeOf(d) === first).map((d) => String(d.statementId)));
        } else {
          setSelected((s) => s.filter((id) => unpaid.includes(id)));
        }
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
  const counts = Object.fromEntries(
    ["LOCAL", "DESI", "NONE"].map((k) => [k, { total: drivers.filter((d) => typeOf(d) === k).length, unpaid: drivers.filter((d) => typeOf(d) === k && payable(d)).length }]),
  );
  // Drivers of the open tab that can be chosen: unpaid, not processing, and with a type (a driver with no type is never selectable).
  const selectable = (d) => payable(d) && typeOf(d) === tab && tab !== "NONE";
  // Desi drivers are recorded in QuickBooks when that is switched on, otherwise in Cash in Hand: the method is fixed either way. A Local payment chooses between Cash in Hand and Everee.
  const method = tab === "DESI" ? (quickbooksAvailable ? QUICKBOOKS : CASH) : form.method;
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
  const visible = (allPaid ? drivers : drivers.filter((d) => typeOf(d) === tab)).filter((d) =>
    d.driverName.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const chosenIds = chosen.map((d) => Number(d.statementId));
  const chosenKey = chosenIds.join(",");
  const viaEveree = method === EVEREE;
  const viaQuickbooks = method === QUICKBOOKS;

  // With Bank transfer (Everee) chosen, the server previews exactly the chosen drivers: who can be paid, the total and what stops anyone.
  useEffect(() => {
    if (step !== "payment" || !viaEveree || !chosenKey) return undefined;
    const controller = new AbortController();
    setEveree({ preview: null, loading: true, error: "" });
    axios
      .get(`${EVEREE_BASE}/runs/${runId}/everee-preview`, { params: { statementIds: chosenKey }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setEveree({ preview: data, loading: false, error: "" }); })
      .catch((error) => {
        if (!controller.signal.aborted) setEveree({ preview: null, loading: false, error: error.response?.data?.message ?? "Everee could not be checked for these drivers. Try again." });
      });
    return () => controller.abort();
  }, [step, viaEveree, chosenKey, runId, version]);
  // With QuickBooks, the server previews exactly the chosen drivers: who can be recorded, the total and what stops anyone.
  useEffect(() => {
    if (step !== "payment" || !viaQuickbooks || !chosenKey) return undefined;
    const controller = new AbortController();
    setQb({ preview: null, loading: true, error: "" });
    axios
      .get(`${EVEREE_BASE}/runs/${runId}/quickbooks-preview`, { params: { statementIds: chosenKey }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setQb({ preview: data, loading: false, error: "" }); })
      .catch((error) => {
        if (!controller.signal.aborted) setQb({ preview: null, loading: false, error: error.response?.data?.message ?? "QuickBooks could not be checked for these drivers. Try again." });
      });
    return () => controller.abort();
  }, [step, viaQuickbooks, chosenKey, runId, version]);
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
  // Switching tab starts a fresh selection: the payment methods differ by driver type, so one payment never mixes the types.
  const changeTab = (key) => {
    if (busy || key === tab) return;
    setTab(key);
    setStep("review");
    setSearch("");
    setEveree({ preview: null, loading: false, error: "" });
    setSelected(key === "NONE" ? [] : drivers.filter((d) => payable(d) && typeOf(d) === key).map((d) => String(d.statementId)));
    setForm((f) => ({ ...f, method: "", confirmed: false }));
    setErrors({});
    setMessage("");
  };
  const toggle = (id) =>
    selectDrivers((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  // One click sends exactly the preview the server showed for these drivers. The request ID stays the same until the preview changes, so a
  // repeated click or a lost answer never sends twice. The results are read back from the server; nothing here decides what is paid.
  const payThroughEveree = async () => {
    const { preview } = everee;
    if (!preview || !preview.canSubmit || busy) return;
    if (evereeConfirm.current.hash !== preview.previewHash) evereeConfirm.current = { hash: preview.previewHash, requestId: newRequestId() };
    setBusy(true);
    setMessage("");
    try {
      await axios.post(`${EVEREE_BASE}/runs/${runId}/everee-batches`, { requestId: evereeConfirm.current.requestId, previewHash: preview.previewHash, statementIds: chosenIds });
      if (mounted.current) {
        setEvereeSent(true);
        setResultsKey((k) => k + 1);
        onRecorded();
      }
    } catch (error) {
      if (error.response?.status === 409 && error.response.data?.preview) {
        setEveree({ preview: error.response.data.preview, loading: false, error: "" });
        setMessage("What would be paid changed since it was shown. Check the new summary, then press Pay again.");
      } else {
        setResultsKey((k) => k + 1); // an answer that was lost may still have created the batch: show what the server has
        setMessage(error.response?.data?.message ?? "The payment could not be confirmed. Look at the results before trying again; pressing Pay again will not send it twice.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // One click records exactly the preview the server showed. The request ID stays the same until the preview changes, so a repeated click or a lost answer
  // never records twice. The results are read back from the server; nothing here decides what is paid.
  const payThroughQuickbooks = async () => {
    const { preview } = qb;
    if (!preview || !preview.canSubmit || busy) return;
    if (qbConfirm.current.hash !== preview.previewHash) qbConfirm.current = { hash: preview.previewHash, requestId: newRequestId() };
    setBusy(true);
    setMessage("");
    try {
      const { data } = await axios.post(`${EVEREE_BASE}/runs/${runId}/quickbooks-batches`, { requestId: qbConfirm.current.requestId, previewHash: preview.previewHash, paidOn: form.paidOn, note: form.note.trim(), confirmed: form.confirmed, statementIds: chosenIds });
      if (mounted.current) { setQbBatchId(data.batch.id); onRecorded(); }
    } catch (error) {
      if (error.response?.status === 409 && error.response.data?.preview) {
        setQb({ preview: error.response.data.preview, loading: false, error: "" });
        setMessage("What would be recorded changed since it was shown. Check the new summary, then press Pay again.");
      } else {
        setMessage(error.response?.data?.message ?? "The payment could not be confirmed. Refresh and look at the drivers before trying again; pressing Pay again will not record it twice.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (step === "review") {
      if (chosen.length && !blocked) setStep("payment");
      return;
    }
    const found = {};
    if (!method) found.method = "Choose how the drivers are paid.";
    else if (!viaEveree) {
      if (!form.paidOn || form.paidOn > toLocalDateString(new Date()))
        found.paidOn = "Choose a payment date up to today.";
      if (form.note.trim().length < 3)
        found.note = "Add a payment note (at least 3 characters).";
      if (!form.confirmed)
        found.confirmed = "Confirm receipt before recording payment.";
    }
    setErrors(found);
    if (
      Object.keys(found).length ||
      !chosen.length ||
      blocked ||
      busy ||
      review.status !== "ready"
    )
      return;
    if (viaEveree) {
      await payThroughEveree();
      return;
    }
    if (viaQuickbooks) {
      await payThroughQuickbooks();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      // Always the chosen drivers by ID, never "everyone left": the run may hold drivers of the other type, or with no type.
      const statementIds = chosen.map((d) => Number(d.statementId));
      const { data } = await axios.post(
        `/admin/payroll/payments/runs/${runId}/record`,
        { requestId: form.requestId, paidOn: form.paidOn, method: CASH, reference: form.note.trim(), confirmed: form.confirmed, statementIds },
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
                {qbBatchId
                  ? "Payment recorded"
                  : evereeSent
                  ? "Submitted to Everee"
                  : result
                    ? "Payment recorded"
                    : allPaid
                      ? "Payment records"
                      : "Pay to drivers"}
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
          {qbBatchId ? (
            <div className="space-y-4 overflow-y-auto p-5 sm:p-8">
              <p className="text-lg font-semibold">Payment recorded</p>
              <p className="text-sm text-ink-muted">The drivers are marked paid by check. Each driver's bill and bill payment is recorded in QuickBooks for the 1099 reports; if one is not recorded yet, the payment still stands and you can retry the QuickBooks record.</p>
              <QuickbooksResult batchId={qbBatchId} onChanged={onRecorded} />
              <button type="button" onClick={onClose} className={buttonClass}>Done</button>
            </div>
          ) : evereeSent ? (
            <div className="space-y-4 overflow-y-auto p-5 sm:p-8">
              <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden="true" />
              <p className="text-lg font-semibold">Submitted to Everee</p>
              <p className="text-sm text-ink-muted">
                Everee has these payments, but nothing is paid yet. Approve the payroll run in Everee. The status here and in Payment history
                changes to Transaction successful only when Everee confirms every deposit.
              </p>
              <EvereeRunResults runId={runId} reloadKey={resultsKey} onChanged={onRecorded} showApprovalLink={false} />
              <p className="text-sm text-ink-muted">Everee opens in a new tab. Return here after approval to check the payment status.</p>
              <div className="flex flex-wrap gap-2">
                <EvereeApprovalLink className={primaryClass} />
                <button type="button" onClick={onClose} className={buttonClass}>Done</button>
              </div>
            </div>
          ) : result ? (
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
                    Note: {result.receipt.reference}
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
                    ? "All driver payments in this run are recorded. Payment dates, notes and confirmation details are kept below."
                    : step === "review"
                      ? "Choose the drivers to pay. The amounts are the approved amounts of this pay run."
                      : viaQuickbooks
                        ? "Records the check you give each driver as paid, and sends the same amount to QuickBooks as a bill and a bill payment for the 1099 reports. QuickBooks does not pay anyone."
                        : viaEveree
                        ? "Sends the approved amounts through Everee. Nothing is paid until you approve the payroll run in Everee and Everee confirms the deposits."
                        : "Records money you paid outside NASA, such as cash. Nothing is sent."}
                </p>
                {evereeAvailable && step === "review" && (
                  <EvereeRunResults runId={runId} reloadKey={resultsKey} onChanged={onRecorded} />
                )}
                {!allPaid && step === "review" && (
                  <DriverTypeTabs tab={tab} counts={counts} onChange={changeTab} disabled={busy} />
                )}
                {!allPaid && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-ink-muted">
                        Selected: {chosen.length} of{" "}
                        {counts[tab].unpaid} unpaid {tab === "DESI" ? "Desi" : tab === "LOCAL" ? "Local" : ""} drivers
                        {drivers.some(processing) &&
                          ` · ${drivers.filter(processing).length} payment(s) processing, not counted`}
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
                                .filter(selectable)
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
                            {selectable(d) && (
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
                                className={`text-xs ${paid(d) ? "text-green-700" : processing(d) ? "font-semibold text-amber-800" : d.eligible ? "text-ink-muted" : "text-amber-800"}`}
                              >
                                {paid(d)
                                  ? "Paid"
                                  : processing(d)
                                    ? "Payment processing"
                                    : typeOf(d) === "NONE"
                                      ? "Needs a driver type"
                                      : d.eligible
                                        ? "Awaiting payment"
                                        : "Needs review"}
                              </span>
                            </span>
                            <span className="font-semibold tabular-nums">
                              {formatMoney(d.amounts.net)}
                            </span>
                          </label>
                          {payable(d) &&
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
                          {d.quickbooksPayment && (
                            <p className="mt-1 text-xs text-ink-muted">
                              QuickBooks · {d.quickbooksPayment.status === "paid" ? "recorded" : d.quickbooksPayment.status} · {d.quickbooksPayment.paidOn}
                              {d.quickbooksPayment.billId ? ` · bill ${d.quickbooksPayment.billId}` : ""}
                              {d.quickbooksPayment.note ? ` · ${d.quickbooksPayment.note}` : ""}
                            </p>
                          )}
                          {d.providerPayment && (
                            <ProviderPaymentLine payment={d.providerPayment} />
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
                      {tab === "DESI" ? (
                        <Field label="Payment method">
                          <p className={`${inputClass} flex items-center`}>{viaQuickbooks ? `${QUICKBOOKS_LABEL} (Desi drivers)` : "Check (Desi drivers are paid by check only)"}</p>
                        </Field>
                      ) : (
                        <Field label="Payment method" error={errors.method}>
                          <select
                            value={form.method}
                            onChange={set("method")}
                            disabled={busy}
                            className={inputClass}
                          >
                            <option value="">Choose a method</option>
                            {evereeAvailable && <option value={EVEREE}>{EVEREE_LABEL}</option>}
                            <option value={CASH}>{METHODS[CASH]}</option>
                          </select>
                        </Field>
                      )}
                      {method && !viaEveree && (
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
                      )}
                    </div>
                    {viaEveree && <EvereeSummary preview={everee.preview} loading={everee.loading} error={everee.error} />}
                    {viaQuickbooks && <QuickbooksSummary preview={qb.preview} loading={qb.loading} error={qb.error} />}
                    {method && (
                      <ul aria-label="Drivers in this payment" className="max-h-40 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
                        {chosen.map((d) => (
                          <li key={d.statementId} className="flex items-center justify-between gap-3 p-2">
                            <span>{d.driverName}</span>
                            <span className="font-semibold tabular-nums">{formatMoney(d.amounts.net)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {method && !viaEveree && (
                      <Field label="Payment note" error={errors.note}>
                        <input
                          value={form.note}
                          onChange={set("note")}
                          disabled={busy}
                          maxLength={200}
                          placeholder={tab === "DESI" ? "Check number or handover details" : "Receipt number or cash handover details"}
                          className={inputClass}
                        />
                      </Field>
                    )}
                    {method && !viaQuickbooks && (!viaEveree || everee.preview) && (
                      <p role="status" aria-label="Payment summary" className="rounded-xl border border-line p-3 font-semibold">
                        {viaEveree ? EVEREE_LABEL : tab === "DESI" ? "Check" : METHODS[method]} ·{" "}
                        {viaEveree ? everee.preview.summary.eligible : chosen.length}{" "}
                        {(viaEveree ? everee.preview.summary.eligible : chosen.length) === 1 ? "driver" : "drivers"} ·{" "}
                        {formatMoney(viaEveree ? everee.preview.summary.total : total)}
                      </p>
                    )}
                    {method && !viaEveree && (
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
                    )}
                    <p className="text-xs text-ink-muted">
                      {viaQuickbooks
                        ? "This marks the drivers paid by check and records the same payment in QuickBooks. Check the drivers, date and total above before pressing Pay."
                        : viaEveree
                        ? "This sends the payment to Everee. Check the method, drivers and total above before pressing Pay."
                        : "This creates a permanent payment record. Check the method, drivers and total above before pressing Pay."}
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
                      !["paidOn", "method", "note", "reference", "confirmed"].includes(
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
                    disabled={busy || !chosen.length || blocked || (step === "payment" && viaEveree && !everee.preview?.canSubmit) || (step === "payment" && viaQuickbooks && !qb.preview?.canSubmit)}
                    className={primaryClass}
                  >
                    {busy
                      ? viaEveree ? "Sending…" : "Recording…"
                      : step === "review"
                        ? "Continue with payment"
                        : "Pay"}
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
