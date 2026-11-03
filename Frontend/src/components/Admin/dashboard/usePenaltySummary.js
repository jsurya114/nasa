import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import axios from "../../../redux/slice/axiosInstance";

// What the driver still owes (penalties, and everything else) for the city and driver the admin applied (#166). The server
// reads it from the ledger and pay runs; nothing is worked out here. It needs a city and a driver, not dates.
export default function usePenaltySummary() {
  const { cities, drivers, filters } = useSelector((state) => state.dash);
  // The dropdowns change as soon as the admin edits the form, before Filter Data is pressed, while the table still shows the
  // applied city and driver. So the IDs are remembered when the filters are applied, by the names the table will carry, and are
  // not looked up again in whatever the dropdowns hold later. Without a remembered entry, the current options are used.
  const applied = useRef(new Map());
  const keyOf = (job, driver) => `${job}|${driver}`;
  const lookup = useCallback((job, driver) => ({
    cityId: job && job !== "All" ? cities?.find((c) => c.job === job)?.id : undefined,
    driverId: driver && driver !== "All" ? drivers?.find((d) => d.name === driver)?.id : undefined,
  }), [cities, drivers]);
  const rememberScope = useCallback((chosen) => {
    const ids = lookup(chosen.job, chosen.driver);
    if (ids.cityId && ids.driverId) applied.current.set(keyOf(chosen.job, chosen.driver), ids);
  }, [lookup]);
  const remembered = applied.current.get(keyOf(filters?.job, filters?.driver));
  const { cityId, driverId } = remembered ?? lookup(filters?.job, filters?.driver);
  const scopeKey = `${cityId}|${driverId}`;
  const [state, setState] = useState({ status: "idle", data: null, scopeKey: null });
  const [attempt, setAttempt] = useState(0);
  // "Expected": the admin applied a city and a driver, so their deductions belong on this page. Until they arrive,
  // or if they fail, the page must say so rather than leave an unadjusted amount looking payable.
  const expected = Boolean(cityId && driverId);

  useEffect(() => {
    if (!expected) {
      setState({ status: "idle", data: null, scopeKey });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", data: null, scopeKey });
    axios.get(`/admin/payroll/drivers/${driverId}/dashboard-summary`, { params: { cityId }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ status: "ready", data, scopeKey }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", data: null, scopeKey }); });
    return () => controller.abort();
  }, [expected, scopeKey, cityId, driverId, attempt]);

  // Figures belong to the scope they were fetched for. For the render between a new scope arriving and its request starting, say
  // "loading" rather than show the previous scope's figures against the new table.
  // Coming back to this tab (for example from the Payroll page, after marking an entry complete) asks again.
  useEffect(() => {
    if (!expected) return undefined;
    const onVisible = () => { if (document.visibilityState === "visible") setAttempt((n) => n + 1); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [expected]);

  const current = state.scopeKey === scopeKey ? state : { status: expected ? "loading" : "idle", data: null };

  return { status: current.status, data: current.data, cityId, driverId, expected, rememberScope, retry: () => setAttempt((n) => n + 1) };
}
