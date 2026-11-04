import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Wallet } from "lucide-react";
import axios from "../../../redux/slice/axiosInstance";
import { formatMoney } from "../../../utils/money.js";
import RecordPaymentDialog from "./RecordPaymentDialog.jsx";
import PayWithEvereeButton from "./everee/PayWithEvereeButton.jsx";
import useEvereeAvailable from "./everee/useEvereeAvailable.js";
import { buttonClass, primaryClass } from "../payroll/formParts.jsx";

// Independent of delivery-history filters: an approved run remains visible until its payment is recorded.
export default function PaymentRuns({ cities = [], onRecorded }) {
  const [view, setView] = useState("ready");
  const [cityId, setCityId] = useState("");
  const [cursor, setCursor] = useState(null);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    runs: [],
    next: null,
  });
  const [opened, setOpened] = useState(null);
  const evereeAvailable = useEvereeAvailable();
  useEffect(() => {
    const refresh = () => {
      setCursor(null);
      setVersion((v) => v + 1);
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));
    axios
      .get("/admin/payroll/payments/runs", {
        params: {
          view,
          ...(cityId && { cityId }),
          ...(cursor && { beforeId: cursor }),
        },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setState((s) => ({
          status: "ready",
          runs: cursor ? [...s.runs, ...(data.runs ?? [])] : (data.runs ?? []),
          next: data.nextBeforeId ?? null,
        }));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((s) => ({
            ...s,
            status: "error",
            message: error.response?.data?.message,
          }));
      });
    return () => controller.abort();
  }, [view, cityId, cursor, version]);
  const changeView = (next) => {
    setView(next);
    setCursor(null);
    setState({ status: "loading", runs: [], next: null });
  };
  const recorded = () => {
    setCursor(null);
    setVersion((v) => v + 1);
    onRecorded?.();
  };
  return (
    <section
      className="card-surface mb-5 p-4 sm:p-5"
      aria-labelledby="payment-runs-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="payment-runs-title"
            className="flex items-center gap-2 text-lg font-bold"
          >
            <Wallet className="h-5 w-5 text-brand" aria-hidden="true" />
            Driver payments
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Approved pay, ready to record when the drivers have received it.
          </p>
        </div>
        <Link
          to="/admin/pay-runs"
          className={`${buttonClass} inline-flex items-center`}
        >
          Prepare a pay run
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-xl bg-brand-50 p-1"
          role="group"
          aria-label="Payment view"
        >
          {[
            ["ready", "Awaiting payment"],
            ["history", "Payment history"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => changeView(key)}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${view === key ? "bg-brand text-white shadow-sm" : "text-brand"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm">
          Payment city
          <select
            aria-label="Payment city"
            value={cityId}
            onChange={(e) => {
              setCityId(e.target.value);
              setCursor(null);
              setState({ status: "loading", runs: [], next: null });
            }}
            className="ml-2 min-h-11 rounded-xl border border-line bg-white px-2 text-base"
          >
            <option value="">All my cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.job}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.status === "loading" && (
        <p role="status" className="mt-4 text-sm text-ink-muted">
          Loading payments…
        </p>
      )}
      {state.status === "error" && (
        <div
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          <p>{state.message ?? "Payments could not be loaded."}</p>
          <button
            type="button"
            onClick={() => setVersion((v) => v + 1)}
            className={`${buttonClass} mt-2`}
          >
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && state.runs.length === 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-brand-50 p-4 text-sm">
          <CheckCircle2
            className="h-6 w-6 shrink-0 text-brand"
            aria-hidden="true"
          />
          <p>
            {view === "ready"
              ? "No approved pay runs are awaiting payment. Prepare a run when you are ready to pay."
              : "No payments have been recorded for these cities yet."}
          </p>
        </div>
      )}
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {state.runs.map((r) => {
          const allPaid = r.paid === r.drivers;
          return (
            <li
              key={r.id}
              className="rounded-2xl border border-line bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{r.city}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {r.period_start} – {r.period_end} ·{" "}
                    {r.data_type === "weekly" ? "GOFO" : "SpeedX"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${allPaid ? "bg-green-50 text-green-800" : r.paid ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand"}`}
                >
                  {allPaid ? "Paid" : r.paid ? "Partly paid" : "Approved"}
                </span>
              </div>
              <p className="mt-4 text-sm text-ink-muted">
                {allPaid ? "Total driver pay recorded" : "Remaining driver pay"}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-brand">
                {formatMoney(allPaid ? r.total : r.remaining)}
              </p>
              <p className="mt-2 text-sm">
                {r.paid} of {r.drivers} drivers marked paid
                {r.processing > 0 &&
                  ` · ${r.processing} payment(s) processing or unconfirmed`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/admin/pay-runs?cityId=${r.city_id}&runId=${r.id}`}
                  className={`${buttonClass} inline-flex items-center`}
                >
                  View breakdown
                </Link>
                {evereeAvailable && !allPaid && (
                  <PayWithEvereeButton run={r} onChanged={recorded} />
                )}
                <button
                  type="button"
                  onClick={() => setOpened(r)}
                  className={allPaid ? buttonClass : primaryClass}
                >
                  {allPaid
                    ? "View payment records"
                    : r.paid
                      ? `Mark remaining ${r.drivers - r.paid} as paid`
                      : `Mark all ${r.drivers} as paid`}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {state.next && (
        <button
          type="button"
          disabled={state.status === "loading"}
          onClick={() => setCursor(state.next)}
          className={`${buttonClass} mt-4`}
        >
          Load more pay runs
        </button>
      )}
      {opened && (
        <RecordPaymentDialog
          key={opened.id}
          runId={opened.id}
          cityName={opened.city}
          onClose={() => setOpened(null)}
          onRecorded={recorded}
        />
      )}
    </section>
  );
}
