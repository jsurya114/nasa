import React from "react";
import { Link } from "react-router-dom";

// After a daily upload that found drivers by name: a count of every row of the file, and what needs a look. The server decides; this only shows it.
// A server that sends nothing (the switch is off) shows nothing. English only; admin screen.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PARTS = [
  ["placed", "added to a driver"], ["paid_day", "on a paid day (not changed)"], ["name_not_matched", "name not matched"], ["driver_disabled", "driver disabled"],
  ["clash", "same sequence as another driver"], ["route_not_in_app", "route not in the app"], ["route_disabled", "route disabled"],
  ["route_without_city", "route has no city"], ["unreadable", "could not be read"],
];

const List = ({ title, items, render, note }) => (items?.total > 0 ? (
  <div className="mt-3">
    <p className="text-sm font-medium text-ink">{title} ({items.total})</p>
    {note && <p className="text-xs text-ink-muted">{note}</p>}
    <ul className="mt-1 list-disc pl-5 text-sm text-ink">{items.list.map(render)}</ul>
    {items.total > items.list.length && <p className="mt-1 text-sm text-ink-muted">Showing the first {items.list.length} of {items.total}.</p>}
  </div>
) : null);

export default function DailyByNameResult({ byName }) {
  if (!byName) return null;
  const { rows } = byName;
  const parts = PARTS.filter(([key]) => rows[key] > 0).map(([key, label]) => `${rows[key]} ${label}`);
  return (
    <section className="card-surface mb-4 p-6" aria-label="Drivers found by name" data-testid="daily-by-name">
      <h2 className="mb-2 text-base font-semibold text-ink">Drivers found by name</h2>
      <p className="text-sm text-ink" data-testid="daily-reconciliation">
        {plural(rows.inFile, "row")} in the file = {parts.join(" + ") || "0"}
        {rows.counted !== rows.inFile && <span className="font-semibold text-red-700"> (the counts do not add up: {rows.counted} counted)</span>}
      </p>
      <p className="mt-1 text-sm text-ink-muted">Driver days: {byName.days.created} new, {byName.days.extended} already there.</p>
      <List title="Names not matched to a driver" items={byName.unmatchedNames} note="These parcels were not added. Match each name once, then upload the day again."
        render={(u) => <li key={`${u.cityId}-${u.fileName}`}>“{u.fileName}” · {u.city} · {plural(u.parcels, "parcel")} · {u.routes.join(", ")} · <Link className="font-semibold text-brand underline" to={`/admin/daily-matching?cityId=${u.cityId}&name=${encodeURIComponent(u.fileName)}`}>Match</Link></li>} />
      <List title="Disabled drivers" items={byName.disabledDrivers} note="These parcels were not added. Enable the driver or match the name to another driver."
        render={(u) => <li key={`${u.cityId}-${u.fileName}`}>“{u.fileName}” · {plural(u.parcels, "parcel")} · {u.routes.join(", ")}</li>} />
      <List title="Paid at the main route's price" items={byName.atMainPrice} note="Their main route has a sub-route with another price. Set a sub-route for them if they should get it."
        render={(d) => <li key={`${d.driverId}-${d.route}`}>{d.driverName} · {d.route} · {plural(d.parcels, "parcel")}</li>} />
      <List title="Put on a sub-route with the same price" items={byName.movedToSub} note="Another driver had the same sequence numbers on the main route. Pay is the same."
        render={(m) => <li key={`${m.driverId}-${m.subRoute}`}>{m.driverName} · {m.mainRoute} → {m.subRoute}</li>} />
      <List title="Not added: same sequences as another driver" items={byName.clashes} note="No free sub-route with the same price. Set a sub-route for one of them, then upload the day again."
        render={(c) => <li key={`${c.driverId}-${c.route}`}>{c.driverName} · {c.route} · {plural(c.parcels, "parcel")}</li>} />
      <List title="Routes" items={byName.missingRoutes} render={(r) => <li key={r.code}>{r.code} · {r.reason.replaceAll("_", " ")} · {plural(r.parcels, "parcel")}</li>} />
      <List title="Paid days, not changed" items={byName.paidDays} render={(d) => <li key={`${d.driverId}-${d.route}`}>{d.driverName} · {d.route} · {plural(d.parcels, "parcel")}</li>} />
    </section>
  );
}
