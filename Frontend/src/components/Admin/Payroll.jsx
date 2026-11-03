import React, { useCallback, useEffect, useState } from "react";
import axios from "../../redux/slice/axiosInstance";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import BalanceSummary from "../Drivers/pay/BalanceSummary.jsx";
import StatementList from "../Drivers/pay/StatementList.jsx";
import StatementDetail from "../Drivers/pay/StatementDetail.jsx";
import LedgerEntryForm from "./payroll/LedgerEntryForm.jsx";
import RefundsDue from "./payroll/RefundsDue.jsx";

// Payroll for one driver of one of the admin's cities (#142, #145): what they owe, their statements
// (drafts show as Pending), and a form to record an advance, expense, claim, repayment or reimbursement.
// The server checks the admin's cities on every request.

const loadAdminStatement = async (statementId, signal) =>
  (await axios.get(`/admin/payroll/statements/${encodeURIComponent(statementId)}`, { signal })).data;

const selectClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

function useDriverPayroll(cityId, driverId) {
  const [state, setState] = useState({ status: "idle", balances: null, statements: [] });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!cityId || !driverId) return undefined;
    const controller = new AbortController();
    const params = { cityId };
    setState((s) => ({ ...s, status: "loading" }));
    Promise.all([
      axios.get(`/admin/payroll/drivers/${driverId}/balances`, { params, signal: controller.signal }),
      axios.get(`/admin/payroll/drivers/${driverId}/statements`, { params, signal: controller.signal }),
    ])
      .then(([b, s]) => setState({ status: "ready", balances: b.data, statements: s.data?.statements ?? [] }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", balances: null, statements: [] }); });
    return () => controller.abort();
  }, [cityId, driverId, version]);

  return { ...state, reload: useCallback(() => setVersion((v) => v + 1), []) };
}

export default function Payroll() {
  const [cities, setCities] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [cityId, setCityId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [openId, setOpenId] = useState(null);
  const [prefill, setPrefill] = useState(null); // a refund chosen from "Refunds due"
  const payroll = useDriverPayroll(cityId, driverId);
  const city = cities.find((c) => String(c.id) === String(cityId));

  useEffect(() => {
    axios.get("/admin/get-admin-cities").then(({ data }) => setCities(data?.cities ?? [])).catch(() => setCities([]));
  }, []);

  useEffect(() => {
    setDriverId("");
    setDrivers([]);
    if (!city) return;
    axios.get("/admin/dashboard/drivers-by-city", { params: { cityJob: city.job } })
      .then(({ data }) => setDrivers(data?.data ?? []))
      .catch(() => setDrivers([]));
  }, [city]);

  useEffect(() => {
    setOpenId(null);
    setPrefill(null);
  }, [cityId, driverId]);

  const needsReview = (payroll.balances?.entries ?? [])
    .filter((e) => e.direction === "debit" && !e.exempt && !e.recovery_plan && Number(e.outstanding) > 0);

  return (
    <>
      <Header />
      <div className="mt-14 min-h-dvh bg-canvas p-4 pb-28">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Payroll</h1>
          <p className="mt-1 text-sm text-gray-500">A driver's statements and balances, and manual advances, expenses and reimbursements.</p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">City
              <select className={selectClass} value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">Choose a city</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">Driver
              <select className={selectClass} value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!cityId}>
                <option value="">{cityId && drivers.length === 0 ? "No drivers in this city" : "Choose a driver"}</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>

          {!driverId && <p className="mt-6 rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">Choose a city and a driver.</p>}
          {driverId && payroll.status === "loading" && <div className="mt-6"><SkeletonList rows={3} label="Loading" /></div>}
          {driverId && payroll.status === "error" && (
            <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Payroll could not be loaded.
              <button type="button" onClick={payroll.reload} className="ml-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold">Try again</button>
            </div>
          )}
          {driverId && payroll.status === "ready" && (
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="card-surface p-4">
                {openId ? (
                  <StatementDetail statementId={openId} onBack={() => setOpenId(null)} load={loadAdminStatement} />
                ) : (
                  <>
                    {needsReview.length > 0 && (
                      <p role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                        {needsReview.length} {needsReview.length === 1 ? "entry has" : "entries have"} no repayment arrangement and will not be recovered until one is recorded.
                      </p>
                    )}
                    <RefundsDue refunds={payroll.balances?.refundsDue ?? []} onRecord={(r) => {
                      setPrefill({
                        key: `${r.claimId}-${Date.now()}`,
                        fields: {
                          type: "correction", direction: "credit", amount: r.amount, claimCourier: r.courier, waybill: r.waybill,
                          claimType: r.claimType, reason: `Refund: ${r.claimType} ${r.waybill} was deducted more than is now owed`,
                        },
                      });
                      document.getElementById("record-entry")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); // absent in some test DOMs
                    }} />
                    <BalanceSummary balances={payroll.balances} />
                    <h2 className="mb-2 text-sm font-semibold text-ink">Pay statements</h2>
                    <StatementList statements={payroll.statements} onOpen={setOpenId} />
                  </>
                )}
              </section>
              <section className="card-surface p-4" aria-labelledby="record-entry">
                <h2 id="record-entry" className="mb-4 text-lg font-semibold text-ink">Record an entry</h2>
                <LedgerEntryForm key={`${cityId}-${driverId}-${prefill?.key ?? "new"}`} cityId={Number(cityId)} driverId={Number(driverId)}
                  prefill={prefill?.fields}
                  onSaved={() => { setPrefill(null); payroll.reload(); }} />
              </section>
            </div>
          )}
        </div>
      </div>
      <Nav />
    </>
  );
}
