import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { ChevronRight } from "lucide-react";
import axios from "../../redux/slice/axiosInstance";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import RecoveryLimitPanel from "./payRuns/RecoveryLimitPanel.jsx";
import NewRunForm from "./payRuns/NewRunForm.jsx";
import RunDetail from "./payRuns/RunDetail.jsx";

// Pay runs for one of the admin's cities (#143): draft, review, finalize, discard, and (super admin) void.
// Nothing here sends money or marks pay rows paid (#31, #144). The server checks the admin's cities on every call.
const selectClass = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/20";

export default function PayRuns() {
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  const [cities, setCities] = useState([]);
  const [cityId, setCityId] = useState("");
  const [runs, setRuns] = useState({ status: "idle", list: [] });
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    axios.get("/admin/get-admin-cities").then(({ data }) => setCities(data?.cities ?? [])).catch(() => setCities([]));
  }, []);

  const loadRuns = useCallback(async (signal) => {
    if (!cityId) return;
    setRuns((r) => ({ ...r, status: "loading" }));
    try {
      const { data } = await axios.get("/admin/payroll/runs", { params: { cityId }, signal });
      setRuns({ status: "ready", list: data?.runs ?? [] });
    } catch {
      if (!signal?.aborted) setRuns({ status: "error", list: [] });
    }
  }, [cityId]);

  useEffect(() => {
    setDetail(null);
    const controller = new AbortController();
    loadRuns(controller.signal);
    return () => controller.abort();
  }, [loadRuns]);

  const open = async (runId) => {
    try {
      const { data } = await axios.get(`/admin/payroll/runs/${runId}`);
      setDetail(data);
    } catch {
      setRuns((r) => ({ ...r, status: "error" }));
    }
  };

  const changed = (data) => {
    setDetail(data);
    loadRuns();
  };

  return (
    <>
      <Header />
      <div className="mt-14 min-h-dvh bg-canvas p-4 pb-28">
        <div className="mx-auto max-w-5xl space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Pay runs</h1>
            <p className="mt-1 text-sm text-gray-500">Freeze each driver's statement for a period. No money is sent from this page.</p>
          </div>

          <RecoveryLimitPanel isSuperAdmin={isSuperAdmin} />

          <label className="block max-w-sm text-sm font-medium text-gray-700">City
            <select className={selectClass} value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">Choose a city</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}
            </select>
          </label>

          {cityId && detail && (
            <section className="card-surface p-4">
              <RunDetail detail={detail} isSuperAdmin={isSuperAdmin} onChanged={changed} onClose={() => setDetail(null)} />
            </section>
          )}

          {cityId && !detail && (
            <>
              <section className="card-surface p-4" aria-labelledby="new-run">
                <h2 id="new-run" className="mb-3 text-base font-semibold text-ink">New draft</h2>
                <NewRunForm key={cityId} cityId={Number(cityId)} onDrafted={changed} />
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
