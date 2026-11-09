import usePersistentState from "../../hooks/usePersistentState.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import axios from "../../redux/slice/axiosInstance";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import StatementList from "../Drivers/pay/StatementList.jsx";
import StatementDetail from "../Drivers/pay/StatementDetail.jsx";
import LedgerEntryForm from "./payroll/LedgerEntryForm.jsx";
import RefundsDue from "./payroll/RefundsDue.jsx";
import AdminBalances from "./payroll/AdminBalances.jsx";
import CityRecordsTable from "./payroll/CityRecordsTable.jsx";
import SearchSelect from "./payroll/SearchSelect.jsx";
import InfoTip from "../../reuse/InfoTip.jsx";

// Payroll for one driver of one of the admin's cities (#142, #145): what they owe and their records (with Edit, Mark complete and
// History in the list), their statements (drafts show as Pending), and a form to add an advance or a penalty.
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
  // The dashboard links here with ?cityId=&driverId= (#166); only digits are used, the server checks access either way.
  const [params] = useSearchParams();
  const fromLink = (key) => (/^\d{1,9}$/.test(params.get(key) ?? "") ? params.get(key) : "");
  // The last city and driver chosen are kept for when the admin comes back to this page; a link from the dashboard wins over them.
  const linked = Boolean(fromLink("cityId"));
  const [cityId, setCityId] = usePersistentState("admin", "payroll", "cityId", fromLink("cityId"), { ignoreSaved: linked });
  const [savedDriver, setSavedDriver] = usePersistentState("admin", "payroll", "driverId", "", { ignoreSaved: linked });
  const [driverId, setDriverId] = useState("");
  const linkedDriver = useRef(fromLink("driverId") || String(savedDriver)); // used once, when that city's drivers have loaded
  const [openId, setOpenId] = useState(null);
  const [prefill, setPrefill] = useState(null); // a refund chosen from "Refunds due"
  const [recordsKey, setRecordsKey] = useState(0); // bumped when a record changes, so the city table asks again
  const { isSuperAdmin } = useSelector((state) => state.admin);
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
      .then(({ data }) => {
        const list = data?.data ?? [];
        setDrivers(list);
        if (linkedDriver.current && list.some((d) => String(d.id) === linkedDriver.current)) setDriverId(linkedDriver.current);
        linkedDriver.current = "";
      })
      .catch(() => setDrivers([]));
  }, [city]);

  useEffect(() => {
    setOpenId(null);
    setPrefill(null);
  }, [cityId, driverId]);

  // A city kept from earlier that this admin can no longer use is dropped, so nothing is asked of the server for it.
  useEffect(() => {
    if (cities.length > 0 && cityId && !cities.some((c) => String(c.id) === String(cityId))) setCityId("");
  }, [cities, cityId, setCityId]);

  const needsReview = (payroll.balances?.entries ?? [])
    .filter((e) => e.direction === "debit" && !e.exempt && !e.recovery_plan && Number(e.outstanding) > 0);

  return (
    <>
      <Header />
      <div className="mt-14 min-h-dvh bg-canvas p-4 pb-28">
        <div className="mx-auto max-w-5xl">
          {isSuperAdmin && <Link to="/admin/payment-setup" className="mb-3 inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand">Driver payment setup</Link>}
          <h1 className="text-2xl font-bold tracking-tight text-ink">Payroll</h1>
          <p className="mt-1 text-sm text-gray-500">A driver's statements, what they owe, and manual advances and penalties.</p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center">
                <label htmlFor="payroll-city" className="block text-sm font-medium text-gray-700">City</label>
                <InfoTip label="city" text="The city the driver works in. You only see the cities you manage." />
              </div>
              <select id="payroll-city" className={selectClass} value={cityId} onChange={(e) => { setCityId(e.target.value); setSavedDriver(""); }}>
                <option value="">Choose a city</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}
              </select>
            </div>
            <SearchSelect
              label="Driver"
              info="Type part of a name to find the driver. Their records, balances and statements show below."
              options={drivers}
              value={driverId}
              onChange={(id) => { setDriverId(id); setSavedDriver(id ? String(id) : ""); }}
              disabled={!cityId}
              placeholder={cityId ? (drivers.length === 0 ? "No drivers in this city" : "Search for a driver") : "Choose a city first"}
              emptyText="No driver matches"
            />
          </div>

          {cityId && (
            <CityRecordsTable cityId={cityId} refreshKey={recordsKey} selectedDriverId={driverId} onPickDriver={setDriverId} />
          )}

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
                    <AdminBalances balances={payroll.balances} isSuperAdmin={isSuperAdmin} onChanged={() => { payroll.reload(); setRecordsKey((k) => k + 1); }} />
                    <h2 className="mb-2 text-sm font-semibold text-ink">Pay statements</h2>
                    <StatementList statements={payroll.statements} onOpen={setOpenId} />
                  </>
                )}
              </section>
              <section className="card-surface p-4" aria-labelledby="record-entry">
                <h2 id="record-entry" className="mb-4 text-lg font-semibold text-ink">Add a record</h2>
                <LedgerEntryForm key={`${cityId}-${driverId}-${prefill?.key ?? "new"}`} cityId={Number(cityId)} driverId={Number(driverId)}
                  prefill={prefill?.fields} payable={payroll.balances?.payable}
                  onSaved={() => { setPrefill(null); payroll.reload(); setRecordsKey((k) => k + 1); }} />
              </section>
            </div>
          )}
        </div>
      </div>
      <Nav />
    </>
  );
}
