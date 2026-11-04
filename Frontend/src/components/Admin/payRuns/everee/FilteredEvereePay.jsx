import React, { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import axios from "../../../../redux/slice/axiosInstance";
import { formatMoney } from "../../../../utils/money.js";
import PayWithEvereeButton from "./PayWithEvereeButton.jsx";
import useEvereeAvailable from "./useEvereeAvailable.js";

// Under the Dashboard's driver jobs table (#31): pay the drivers of the applied filter through Everee. It follows the filter that was applied
// with Filter Data: a city, or a driver (with or without a city), and a payment status of All or Pending (not Paid). The approved pay runs
// that still have something to pay for that city or driver are listed, each with its own Pay with Everee button. The delivery dates of the
// filter do not apply: an approved run is paid whole, whatever days it covers. The server decides who is paid and how much; this only picks
// the city, the driver and the run.
export default function FilteredEvereePay({ applied, cities = [], drivers = [], known = {}, onChanged }) {
  const available = useEvereeAvailable();
  const [state, setState] = useState({ status: "loading", runs: [] });
  const [version, setVersion] = useState(0);

  // `known` are the IDs remembered when Filter Data was pressed (they survive the form's dropdowns changing afterwards); the lists are the fallback.
  const scope = useMemo(() => {
    const cityPicked = applied?.job && applied.job !== "All";
    const driverPicked = applied?.driver && applied.driver !== "All";
    const city = cityPicked ? cities.find((c) => c.job === applied.job) : null;
    const named = driverPicked ? drivers.filter((d) => d.name === applied.driver) : [];
    const cityId = cityPicked ? (known.cityId ?? city?.id ?? null) : null;
    // Two drivers with one name and no city to tell them apart: never guess (the remembered ID may be just the first of them).
    const ambiguous = driverPicked && !cityPicked && named.length > 1;
    const driverId = driverPicked && !ambiguous ? (known.driverId ?? (named.length === 1 ? named[0].id : null)) : null;
    // A chosen city or driver that cannot be identified stops here too.
    let problem = null;
    if (cityPicked && !cityId) problem = "city";
    else if (ambiguous) problem = "ambiguous";
    else if (driverPicked && !driverId) problem = "driver";
    return { cityId, driverId, driverName: driverPicked ? applied.driver : null, cityName: cityPicked ? applied.job : null, problem };
  }, [applied, cities, drivers, known.cityId, known.driverId]);

  const driverIds = useMemo(() => (scope.driverId ? [scope.driverId] : null), [scope.driverId]);
  const hidden = !available || !applied || applied.paymentStatus === "Paid";

  useEffect(() => {
    if (hidden || scope.problem) return undefined;
    const controller = new AbortController();
    setState({ status: "loading", runs: [] });
    axios.get("/admin/payroll/everee/payable-runs", { params: { ...(scope.cityId && { cityId: scope.cityId }), ...(scope.driverId && { driverId: scope.driverId }) }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ status: "ready", runs: data?.runs ?? [] }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", runs: [] }); });
    return () => controller.abort();
  }, [hidden, scope.problem, scope.cityId, scope.driverId, version]);

  if (hidden) return null;
  const changed = () => { setVersion((v) => v + 1); onChanged?.(); };
  const who = scope.driverName ?? (scope.cityName ? `all drivers in ${scope.cityName}` : "all drivers in your cities");

  return (
    <section className="card-surface mt-4 p-4" aria-labelledby="dash-everee-title">
      <h2 id="dash-everee-title" className="flex items-center gap-2 text-lg font-bold"><Wallet className="h-5 w-5 text-brand" aria-hidden="true" />Pay with Everee</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Approved pay for {who}. The payment is made from the approved pay run, whatever delivery dates are filtered above.
      </p>
      {scope.problem === "ambiguous" && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">More than one driver is called {scope.driverName}. Choose a city to say which one to pay.</p>}
      {scope.problem && scope.problem !== "ambiguous" && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The chosen {scope.problem} could not be found. Apply the filter again.</p>}
      {!scope.problem && state.status === "loading" && <p role="status" className="mt-3 text-sm text-ink-muted">Looking for approved pay runs…</p>}
      {!scope.problem && state.status === "error" && (
        <p role="alert" className="mt-3 text-sm text-red-700">Approved pay runs could not be loaded.{" "}
          <button type="button" onClick={() => setVersion((v) => v + 1)} className="min-h-11 rounded-xl border border-line bg-white px-4 font-semibold text-ink">Try again</button>
        </p>
      )}
      {!scope.problem && state.status === "ready" && state.runs.length === 0 && (
        <p className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">No approved pay run is waiting to be paid for this selection. Approve a pay run first.</p>
      )}
      {!scope.problem && state.status === "ready" && state.runs.length > 0 && (
        <ul aria-label="Approved pay runs to pay" className="mt-3 grid gap-3 lg:grid-cols-2">
          {state.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4">
              <div>
                <p className="font-bold">{r.city}</p>
                <p className="text-xs text-ink-muted">{r.period_start} – {r.period_end} · {r.data_type === "weekly" ? "GOFO" : "SpeedX"}</p>
                <p className="mt-1 text-sm">{r.drivers} {r.drivers === 1 ? "driver" : "drivers"} · <span className="font-bold tabular-nums">{formatMoney(r.remaining)}</span> to pay{r.processing > 0 && ` · ${r.processing} sent, waiting`}</p>
              </div>
              <PayWithEvereeButton run={r} driverIds={driverIds} onChanged={changed} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
