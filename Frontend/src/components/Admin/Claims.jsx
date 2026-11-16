import React, { useEffect, useState } from "react";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import Pagination from "../../reuse/Pagination";
import ClaimsTable from "./claims/ClaimsTable.jsx";
import { listCities, listClaims, problemOf } from "./claims/claimsApi.js";

const EMPTY = {
  unmatched: "No unmatched claims for these cities. Every claim from the uploaded files has a driver.",
  matched: "No matched claims for these cities yet.",
};
const SEARCH_DELAY_MS = 350;

// Claims: the carrier's claims from the weekly Excel upload, for the cities this admin works in (a super admin sees all). Read only: nothing here
// matches, deducts or changes a claim. "Not matched yet" claims are waiting for delivery history or need a person to see which driver they belong to.
export default function Claims() {
  const [tab, setTab] = useState("unmatched");
  const [cityId, setCityId] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [cities, setCities] = useState([]);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ status: "loading", data: null, message: "" });

  useEffect(() => { listCities().then(setCities).catch(() => setCities([])); }, []);
  // A search is sent a moment after typing stops, and a new search starts from the first page.
  useEffect(() => {
    const timer = setTimeout(() => { setTerm(search.trim()); setPage(1); }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: "loading" }));
    listClaims({ tab, page, ...(cityId && { cityId }), ...(term && { search: term }) }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ status: "ready", data, message: "" }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ status: "error", data: null, message: problemOf(error) }); });
    return () => controller.abort();
  }, [tab, page, cityId, term, version]);

  const data = state.data;
  const counts = data?.counts;
  const tabs = [["unmatched", "Not matched yet"], ["matched", "Matched to a driver"]];

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto max-w-6xl space-y-4 p-3 pb-28 sm:p-6 sm:pb-40">
        <div>
          <h1 className="text-2xl font-bold text-brand">Claims</h1>
          <p className="text-sm text-ink-muted">
            Claims from the carrier's weekly file for your cities. This page only shows them: nothing here matches, deducts or changes a claim.
          </p>
        </div>

        <section className="card-surface space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div role="group" aria-label="Claims view" className="inline-flex rounded-xl bg-brand-50 p-1">
              {tabs.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={tab === key} onClick={() => { setTab(key); setPage(1); }}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${tab === key ? "bg-brand text-white shadow-sm" : "text-brand"}`}>
                  {label}{counts ? ` (${counts[key]})` : ""}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-gray-700">City
                <select aria-label="City" value={cityId} onChange={(e) => { setCityId(e.target.value); setPage(1); }}
                  className="mt-1 block min-h-11 rounded-xl border border-line bg-white px-2 text-base">
                  <option value="">All my cities</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-gray-700">Search
                <input type="search" aria-label="Search claims" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100}
                  placeholder="Waybill, driver, type or courier"
                  className="mt-1 block min-h-11 w-64 max-w-full rounded-xl border border-line bg-white px-3 text-base" />
              </label>
            </div>
          </div>

          {state.status === "loading" && !data && <p role="status" className="text-sm text-ink-muted">Loading claims…</p>}
          {state.status === "error" && (
            <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <p>{state.message}</p>
              <button type="button" onClick={() => setVersion((v) => v + 1)} className="mt-2 min-h-11 rounded-xl border border-line bg-white px-4 font-semibold text-ink">Try again</button>
            </div>
          )}
          {data && state.status !== "error" && (
            <div className={state.status === "loading" ? "opacity-60" : ""}>
              {data.claims.length === 0
                ? <p className="rounded-xl bg-brand-50 p-4 text-sm" data-testid="claims-empty">{term || cityId ? "No claims match this search." : EMPTY[tab]}</p>
                : <>
                    <p className="mb-2 text-sm text-ink-muted" data-testid="claims-total">{data.total} {data.total === 1 ? "claim" : "claims"}</p>
                    <ClaimsTable claims={data.claims} matched={tab === "matched"} />
                    <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
                  </>}
            </div>
          )}
        </section>
      </main>
      <Nav />
    </div>
  );
}
