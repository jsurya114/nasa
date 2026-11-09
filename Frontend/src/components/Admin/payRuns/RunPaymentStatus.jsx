import React, { useEffect, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";
import RecordPaymentDialog from "./RecordPaymentDialog.jsx";
import { buttonClass, primaryClass } from "../payroll/formParts.jsx";

export default function RunPaymentStatus({ runId, cityName, onRecorded }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    axios
      .get(`/admin/payroll/payments/runs/${runId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ status: "error", data: null });
      });
    return () => controller.abort();
  }, [runId, version]);
  const drivers = state.data?.drivers ?? [];
  const paid = drivers.filter((d) => d.payoutStatus === "paid").length;
  // A payment already with Everee (submitted or unconfirmed) is neither paid nor left to pay: it waits for Everee to confirm the deposit.
  const processing = drivers.filter((d) => ["submitted", "unconfirmed"].includes(d.payoutStatus)).length;
  const remaining = drivers.length - paid - processing;
  return (
    <section
      className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-4"
      aria-label="Pay run payment status"
    >
      <h3 className="font-bold">Payment status</h3>
      {state.status === "loading" && (
        <p className="mt-1 text-sm">Loading payment status…</p>
      )}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-sm">
          Payment status could not be loaded.{" "}
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            className={buttonClass}
          >
            Try again
          </button>
        </p>
      )}
      {state.status === "ready" &&
        (drivers.length ? (
          <>
            <p className="mt-1 text-sm">
              {paid} of {drivers.length} drivers marked paid.
              {processing > 0 && ` ${processing} payment(s) processing.`}{" "}
              {remaining
                ? "Choose the drivers and how they are paid."
                : processing
                  ? "Waiting for Everee to confirm the deposits."
                  : "All payments in this run are recorded."}
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`${remaining ? primaryClass : buttonClass} mt-3`}
            >
              {remaining ? "Pay to drivers" : processing ? "View payment status" : "View payment records"}
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm">
            This run has no driver statements. There is nothing to pay.
          </p>
        ))}
      {open && (
        <RecordPaymentDialog
          key={runId}
          runId={runId}
          cityName={cityName}
          onClose={() => setOpen(false)}
          onRecorded={() => {
            setVersion((v) => v + 1);
            onRecorded?.();
          }}
        />
      )}
    </section>
  );
}
