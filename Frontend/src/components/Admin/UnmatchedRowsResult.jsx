import React from "react";
import { formatMoney } from "../../utils/money.js";

// After a weekly upload: the lines of the file that "Calculate Driver Payment" will leave out, and why, plus a count of every row of the file. The server decides;
// this only shows it. A warning, not an error: the upload is already stored. A server that sends nothing shows nothing. English only; admin screen.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DRIVER_REASON = { driver_not_in_app: "Not in the app", driver_disabled: "Driver is disabled" };
const ROUTE_REASON = { route_not_in_app: "Route not in the app", route_disabled: "Route is disabled", route_without_city: "Route has no city" };
const days = (list) => (list.length <= 3 ? list.join(", ") : `${list.length} days, ${list[0]} to ${list.at(-1)}`);

const Reconciliation = ({ rows }) => {
  const parts = [
    ["will be added", rows.to_add],
    ["already on the dashboard", rows.already_on_dashboard],
    ["Delivery ID not in the app", rows.driver_not_in_app],
    ["driver disabled", rows.driver_disabled],
    ["route not in the app", rows.route_not_in_app],
    ["route disabled", rows.route_disabled],
    ["route has no city", rows.route_without_city],
    ["could not be read", rows.unreadable],
  ].filter(([, n]) => n > 0);
  return (
    <p className="text-sm text-ink" data-testid="unmatched-reconciliation">
      {plural(rows.inFile, "row")} in the file = {parts.map(([label, n]) => `${n} ${label}`).join(" + ") || "0"}
      {rows.counted !== rows.inFile && <span className="font-semibold text-red-700"> (the counts do not add up: {rows.counted} counted)</span>}
    </p>
  );
};

const Counts = ({ item }) => `${plural(item.packages, "package")} · ${item.fs} FS · ${item.ds} DS`;

export default function UnmatchedRowsResult({ unmatched }) {
  if (!unmatched) return null;
  const title = <h2 className="mb-2 text-base font-semibold text-ink">In the file but not in the app</h2>;
  if (unmatched.checked === false) {
    return (
      <section className="card-surface mb-4 p-6" aria-label="In the file but not in the app" data-testid="unmatched-rows">
        {title}
        <p role="status" className="text-sm text-ink-muted">Could not check the file against the app's drivers and routes. The upload itself was stored as usual.</p>
      </section>
    );
  }
  const { rows, drivers, routes } = unmatched;
  const clean = drivers.total === 0 && routes.total === 0;
  return (
    <section className="card-surface mb-4 p-6" aria-label="In the file but not in the app" data-testid="unmatched-rows">
      {title}
      <Reconciliation rows={rows} />
      {clean ? (
        <p role="status" className="mt-2 text-sm text-ink">Every Delivery ID and route in this file is in the app.</p>
      ) : (
        <p role="status" className="mt-2 text-sm font-semibold text-amber-800">
          These lines will be left out when you press Calculate Driver Payment. Add or enable the driver (driver code = Delivery ID) or the route first, or upload again after.
        </p>
      )}
      {drivers.total > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink">Delivery IDs ({drivers.total})</p>
          <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
            {drivers.list.map((d) => (
              <li key={d.deliveryId} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                <span>
                  <span className="font-semibold">Delivery ID {d.deliveryId}</span>
                  <span className={`ml-2 text-xs font-semibold ${d.reason === "driver_disabled" ? "text-red-700" : "text-amber-800"}`}>{DRIVER_REASON[d.reason] ?? d.reason}</span>
                  <span className="block text-ink-muted">Route {d.routes.join(", ") || "none"} · {days(d.days)} · <Counts item={d} /></span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{d.estimate === null ? "—" : formatMoney(d.estimate)}</span>
                  <span className="block text-xs text-ink-muted">{d.estimate === null ? "no route price" : "estimate from route prices"}{d.estimate !== null && d.unpricedPackages > 0 ? `, ${plural(d.unpricedPackages, "package")} without a price` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
          {drivers.total > drivers.shown && <p className="mt-1 text-sm text-ink-muted">Showing the first {drivers.shown} of {drivers.total}.</p>}
        </div>
      )}
      {routes.total > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-ink">Routes ({routes.total})</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink">
            {routes.list.map((r) => (
              <li key={r.route ?? "none"}>
                Route {r.route ?? "(empty)"} · <span className="font-semibold text-amber-800">{ROUTE_REASON[r.reason] ?? r.reason}</span> · {plural(r.deliveryIds, "Delivery ID")} · {days(r.days)} · <Counts item={r} />
              </li>
            ))}
          </ul>
          {routes.total > routes.shown && <p className="mt-1 text-sm text-ink-muted">Showing the first {routes.shown} of {routes.total}.</p>}
        </div>
      )}
    </section>
  );
}
