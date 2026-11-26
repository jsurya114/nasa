import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Header from "../../../reuse/Header";
import Nav from "../../../reuse/Nav";
import { buttonClass, inputClass, primaryClass } from "../payroll/formParts.jsx";
import { listDailyCities, loadCityChoices, mainRoutesWithSubs, saveNameMatch, saveSubRoute, undoChoice } from "./dailyMatchingApi.js";

// Daily upload, drivers found by name: what the upload remembers per city. "This name in the file = this driver", and "on this main route this driver
// gets this sub-route" (the sub-route decides the price). Admins add, change and undo them. English only; admin screen.
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");
const priceOf = (r) => `$${Number(r.fs_price).toFixed(2)} / DS $${Number(r.ds_price).toFixed(2)}`;

export default function DailyMatching() {
  // The upload result's "Match" link hands over the city and the name in the page state, never in the address, so a driver's name is not kept in
  // the browser history or a server log.
  const handed = useLocation().state ?? {};
  const [cities, setCities] = useState([]);
  const [cityId, setCityId] = useState(handed.cityId ? String(handed.cityId) : "");
  const [data, setData] = useState({ status: "idle" });
  const [name, setName] = useState({ fileName: handed.name ?? "", driverId: "" });
  const [sub, setSub] = useState({ driverId: "", mainRouteId: "", subRouteId: "" });
  const [message, setMessage] = useState({ kind: "", text: "" });

  useEffect(() => {
    listDailyCities().then((list) => {
      setCities(list);
      if (!cityId && list.length === 1) setCityId(String(list[0].id));
    }).catch(() => setMessage({ kind: "error", text: "The cities could not be loaded." }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => {
    if (!cityId) return;
    setData((d) => ({ ...d, status: "loading" }));
    loadCityChoices(cityId).then((d) => setData({ status: "ready", ...d })).catch(() => setData({ status: "error" }));
  }, [cityId]);
  useEffect(reload, [reload]);

  const run = async (action, done) => {
    setMessage({ kind: "", text: "" });
    try {
      await action();
      setMessage({ kind: "ok", text: done });
      reload();
    } catch (error) {
      setMessage({ kind: "error", text: error.message });
    }
  };
  const groups = data.status === "ready" ? mainRoutesWithSubs(data.routes) : [];
  const group = groups.find((g) => String(g.main.id) === sub.mainRouteId);
  const enabledDrivers = data.status === "ready" ? data.drivers.filter((d) => d.enabled) : [];

  return (
    <div className="min-h-screen bg-surface pb-32">
      <Header />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <section className="card-surface p-6">
          <h1 className="text-xl font-bold text-ink">Daily drivers by name</h1>
          <p className="mt-1 text-sm text-ink-muted">The daily upload finds each driver by the name in the file. When a name is written differently, match it to the driver once. A driver who always gets a sub-route on a main route (it sets the price) can be given it here.</p>
          <label className="mt-3 block text-sm font-medium text-ink">City
            <select className={inputClass} value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label="City">
              <option value="">Choose a city</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}
            </select>
          </label>
          {message.text && <p role={message.kind === "error" ? "alert" : "status"} className={`mt-2 text-sm ${message.kind === "error" ? "text-red-700" : "text-green-700"}`}>{message.text}</p>}
        </section>

        {data.status === "loading" && <p role="status" className="text-sm text-ink-muted">Loading…</p>}
        {data.status === "error" && <p role="alert" className="text-sm text-red-700">The choices could not be loaded. Try again.</p>}
        {data.status === "ready" && (
          <>
            <section className="card-surface p-6" aria-label="Names in the file">
              <h2 className="text-base font-semibold text-ink">Names in the file ({data.names.length})</h2>
              <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); run(() => saveNameMatch({ cityId: Number(cityId), fileName: name.fileName, driverId: Number(name.driverId) }), "Name matched. Upload the day again to use it."); }}>
                <input className={inputClass} aria-label="Name as in the file" placeholder="Name as in the file" value={name.fileName} onChange={(e) => setName({ ...name, fileName: e.target.value })} />
                <select className={inputClass} aria-label="Driver for this name" value={name.driverId} onChange={(e) => setName({ ...name, driverId: e.target.value })}>
                  <option value="">Choose the driver</option>
                  {enabledDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button type="submit" className={primaryClass} disabled={!name.fileName.trim() || !name.driverId}>Save match</button>
              </form>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {data.names.length === 0 && <li className="p-3 text-sm text-ink-muted">No names matched by hand yet.</li>}
                {data.names.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span><span className="font-semibold">“{m.file_name}”</span> = {m.driver_name}<span className="block text-xs text-ink-muted">Set {when(m.set_at)}{m.set_by ? ` by ${m.set_by}` : ""}</span></span>
                    <button type="button" className={buttonClass} onClick={() => run(() => undoChoice("names", m.id), "Match undone.")}>Undo</button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card-surface p-6" aria-label="Sub-routes">
              <h2 className="text-base font-semibold text-ink">Sub-routes ({data.subRoutes.length})</h2>
              <p className="mt-1 text-sm text-ink-muted">Without a sub-route here, a driver is paid at the main route's price.</p>
              <form className="mt-2 grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => saveSubRoute({ cityId: Number(cityId), driverId: Number(sub.driverId), mainRouteId: Number(sub.mainRouteId), subRouteId: Number(sub.subRouteId) }), "Sub-route saved. It applies from the next upload."); }}>
                <select className={inputClass} aria-label="Driver for the sub-route" value={sub.driverId} onChange={(e) => setSub({ ...sub, driverId: e.target.value })}>
                  <option value="">Choose the driver</option>
                  {enabledDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select className={inputClass} aria-label="Main route" value={sub.mainRouteId} onChange={(e) => setSub({ ...sub, mainRouteId: e.target.value, subRouteId: "" })}>
                  <option value="">Main route</option>
                  {groups.map((g) => <option key={g.main.id} value={g.main.id}>{g.main.code} ({priceOf(g.main)})</option>)}
                </select>
                <select className={inputClass} aria-label="Sub-route" value={sub.subRouteId} onChange={(e) => setSub({ ...sub, subRouteId: e.target.value })} disabled={!group}>
                  <option value="">Sub-route</option>
                  {group?.subs.map((s) => <option key={s.id} value={s.id}>{s.code} ({priceOf(s)})</option>)}
                </select>
                <button type="submit" className={primaryClass} disabled={!sub.driverId || !sub.mainRouteId || !sub.subRouteId}>Save sub-route</button>
              </form>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {data.subRoutes.length === 0 && <li className="p-3 text-sm text-ink-muted">No sub-routes set.</li>}
                {data.subRoutes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span><span className="font-semibold">{c.driver_name}</span> · {c.main_route} → {c.sub_route}
                      <span className="block text-xs text-ink-muted">{c.source === "history" ? "Filled in from the last 4 weeks" : `Set ${when(c.set_at)}${c.set_by ? ` by ${c.set_by}` : ""}`}</span></span>
                    <button type="button" className={buttonClass} onClick={() => run(() => undoChoice("subroutes", c.id), "Sub-route undone.")}>Undo</button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
      <Nav />
    </div>
  );
}
