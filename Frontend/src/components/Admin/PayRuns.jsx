import usePersistentState from "../../hooks/usePersistentState.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ChevronRight } from "lucide-react";
import axios from "../../redux/slice/axiosInstance";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import RecoveryLimitPanel from "./payRuns/RecoveryLimitPanel.jsx";
import EvereePanel from "./payRuns/EvereePanel.jsx";
import NewRunForm from "./payRuns/NewRunForm.jsx";
import RunDetail from "./payRuns/RunDetail.jsx";

// Pay runs for one of the admin's cities (#143): draft, review, finalize, discard, and (super admin) void.
// Nothing here sends money or marks pay rows paid (#31, #144). The server checks the admin's cities on every call.
const selectClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

export default function PayRuns() {
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  const [cities, setCities] = useState([]);
  const [cityId, setCityId] = usePersistentState("admin", "pay-runs", "cityId", "");
  const [runs, setRuns] = useState({ status: "idle", list: [] });
  const [detail, setDetail] = useState(null);
  // Every city change starts a new "epoch". An answer that arrives later is used only if it belongs to the same epoch
  // and its run is in the city now selected, so a slow reply can never put another city's run (and its Finalize,
  // Discard or Void buttons) on this city's page.
  const epoch = useRef(0);
  const openRequest = useRef(null);
  const selectCity = (value) => {
    epoch.current += 1;
    openRequest.current?.abort();
    setDetail(null);
    setCityId(value);
  };
  const isCurrent = (city, era) => era === epoch.current && String(city) === String(cityId);
  const accept = (data, city, era) => isCurrent(city, era) && String(data?.run?.city_id) === String(city);

  useEffect(() => {
    axios.get("/admin/get-admin-cities").then(({ data }) => setCities(data?.cities ?? [])).catch(() => setCities([]));
  }, []);

  // A city kept from earlier that this admin can no longer use is dropped, so nothing is asked of the server for it.
  useEffect(() => {
    if (cities.length > 0 && cityId && !cities.some((c) => String(c.id) === String(cityId))) setCityId("");
  }, [cities, cityId, setCityId]);

  const loadRuns = useCallback(async (signal) => {
    if (!cityId) return;
    const era = epoch.current;
    setRuns((r) => ({ ...r, status: "loading" }));
    try {
      const { data } = await axios.get("/admin/payroll/runs", { params: { cityId }, signal });
      if (era !== epoch.current) return; // the city changed while this list was loading
      setRuns({ status: "ready", list: (data?.runs ?? []).filter((r) => String(r.city_id) === String(cityId)) });
    } catch {
      if (!signal?.aborted && era === epoch.current) setRuns({ status: "error", list: [] });
    }
  }, [cityId]);

  useEffect(() => {
    const controller = new AbortController();
    loadRuns(controller.signal);
    return () => controller.abort();
  }, [loadRuns]);

  const open = async (runId) => {
    const city = cityId;
    const era = epoch.current;
    openRequest.current?.abort();
    const controller = new AbortController();
    openRequest.current = controller;
    try {
      const { data } = await axios.get(`/admin/payroll/runs/${runId}`, { signal: controller.signal });
      if (accept(data, city, era)) setDetail(data);
    } catch {
      if (!controller.signal.aborted && isCurrent(city, era)) setRuns((r) => ({ ...r, status: "error" }));
    }
  };

  // For a draft just made or an action just taken. Built at render time, so the city and epoch are the ones on screen
  // when the admin acted; a reply for an earlier city is dropped.
  const changedFor = (city, era) => (data) => {
    if (!accept(data, city, era)) return;
    setDetail(data);
    loadRuns();
  };
  const changed = changedFor(cityId, epoch.current);

  return (
    <>
      <Header />
      <div className="mt-14 min-h-dvh bg-canvas p-4 pb-28">
        <div className="mx-auto max-w-5xl space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Pay runs</h1>
            <p className="mt-1 text-sm text-gray-500">Choose a city and delivery period, review each driver’s pay, then approve the statements. Payment is a separate step.</p>
          </div>

          <details className="rounded-2xl border border-line bg-white">
            <summary className="cursor-pointer p-4 text-sm font-semibold text-brand">Deduction limit & payment setup</summary>
            <div className="space-y-3 p-3 pt-0">
              <RecoveryLimitPanel isSuperAdmin={isSuperAdmin} />
              {isSuperAdmin && <EvereePanel />}
            </div>
          </details>

          <label className="block max-w-sm text-sm font-medium text-gray-700">City
            <select className={selectClass} value={cityId} onChange={(e) => selectCity(e.target.value)}>
              <option value="">Choose a city</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}
            </select>
          </label>

          {cityId && detail && (
            <section className="card-surface p-4">
              <RunDetail detail={detail} isSuperAdmin={isSuperAdmin} onChanged={changed} onClose={() => setDetail(null)}
                selectedCityId={cityId} cityName={cities.find((c) => String(c.id) === String(detail.run.city_id))?.job ?? `city ${detail.run.city_id}`} />
            </section>
          )}

          {cityId && !detail && (
            <>
              <section className="card-surface p-4" aria-labelledby="new-run">
                <h2 id="new-run" className="mb-3 text-base font-semibold text-ink">New draft</h2>
                <NewRunForm key={cityId} cityId={Number(cityId)} defaultDataType={cities.find((c) => String(c.id) === String(cityId))?.city_type === "WEEKLY" ? "weekly" : "daily"} onDrafted={changed} />
              </section>
              <section aria-labelledby="run-list">
                <h2 id="run-list" className="mb-2 text-base font-semibold text-ink">Runs</h2>
                {runs.status === "loading" && <SkeletonList rows={3} label="Loading" />}
                {runs.status === "error" && (
                  <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    Pay runs could not be loaded.
                    <button type="button" onClick={() => loadRuns()} className="ml-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold">Try again</button>
                  </div>
                )}
                {runs.status === "ready" && runs.list.length === 0 && (
                  <p className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">No pay runs for this city yet.</p>
                )}
                {runs.status === "ready" && runs.list.length > 0 && (
                  <ul className="space-y-2">
                    {runs.list.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => open(r.id)}
                          className="flex w-full min-h-11 items-center gap-3 rounded-2xl border border-line bg-white p-4 text-left hover:border-brand-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20">
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-ink tabular-nums">
                              <span className="sr-only">Open run </span>
                              <span className="whitespace-nowrap">{r.period_start}</span> – <span className="whitespace-nowrap">{r.period_end}</span>
                            </span>
                            <span className="block text-sm text-ink-muted">{r.data_type === "weekly" ? "Weekly" : "Daily"} · {r.status}</span>
                          </span>
                          <ChevronRight className="h-5 w-5 text-ink-muted" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      <Nav />
    </>
  );
}
