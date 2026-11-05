import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import axios from "../../../redux/slice/axiosInstance";

// What comes off the driver this payday, and what they still owe in all, for the city, driver and dates the admin applied
// (#166). The server works both out (pay runs, or the pay calculator on a copy); nothing is calculated here. It needs a city
// and a driver; the dates add this payday's deduction.
export default function usePenaltySummary() {
  const { cities, drivers, filters, selectedDataType } = useSelector((state) => state.dash);
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
  const from = filters?.startDate || undefined;
  const to = filters?.endDate || undefined;
  // What the table shows is part of the scope: the Payment status (All, Paid, Pending), the Route and the View tab (All, daily, weekly). The server
  // must know them, so that a run's figures stand in for the table's net only when the table holds exactly the rows that run holds, and a change
  // of any of them asks again instead of reusing another answer.
  const paymentStatus = filters?.paymentStatus && filters.paymentStatus !== "All" ? filters.paymentStatus : undefined;
  const route = filters?.route && filters.route !== "All" ? filters.route : undefined;
  const dataType = selectedDataType && selectedDataType !== "all" ? selectedDataType : undefined;
  const scopeKey = `${cityId}|${driverId}|${from}|${to}|${paymentStatus}|${route}|${dataType}`;
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
    axios.get(`/admin/payroll/drivers/${driverId}/dashboard-summary`, { params: { cityId, ...(from && to && { from, to }), ...(paymentStatus && { paymentStatus }), ...(route && { route }), ...(dataType && { dataType }) }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ status: "ready", data, scopeKey }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", data: null, scopeKey }); });
    return () => controller.abort();
  }, [expected, scopeKey, cityId, driverId, from, to, paymentStatus, route, dataType, attempt]);

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
