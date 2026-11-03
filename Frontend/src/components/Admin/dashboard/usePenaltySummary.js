import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import axios from "../../../redux/slice/axiosInstance";

// The dashboard's penalty figures for the driver, city and dates the admin applied (#166). The server reads them from
// pay statements and ledger balances; nothing is calculated here. Nothing is asked until a city, a driver and both
// dates are chosen, because "this payday" only means something for a date range. Any error simply hides the rows.
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
  const from = filters?.startDate;
  const to = filters?.endDate;
  const scopeKey = `${cityId}|${driverId}|${from}|${to}`;
  const [state, setState] = useState({ status: "idle", data: null, scopeKey: null });
  const [attempt, setAttempt] = useState(0);
  // "Expected": the admin chose a city, a driver and both dates, so payroll figures belong on this page. Until they arrive,
  // or if they fail, the page must say so rather than leave an unadjusted amount looking payable.
  const expected = Boolean(cityId && driverId && from && to);

  useEffect(() => {
    if (!expected) {
      setState({ status: "idle", data: null, scopeKey });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", data: null, scopeKey });
    axios.get(`/admin/payroll/drivers/${driverId}/dashboard-summary`, { params: { cityId, from, to }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setState({ status: "ready", data, scopeKey }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", data: null, scopeKey }); });
    return () => controller.abort();
  }, [expected, scopeKey, cityId, driverId, from, to, attempt]);

  // Figures belong to the scope they were fetched for. For the render between a new scope arriving and its request starting, say
  // "loading" rather than show the previous scope's figures against the new table.
  const current = state.scopeKey === scopeKey ? state : { status: expected ? "loading" : "idle", data: null };

  return { status: current.status, data: current.data, cityId, driverId, expected, rememberScope, retry: () => setAttempt((n) => n + 1) };
}

// What to show, or null when there is nothing to show. "approved" figures come from finalized pay runs and the run's
// own net; "preview" figures are drafts that nobody has approved yet.
export const describePenalty = (penalty) => {
  if (penalty?.status !== "ready") return null;
  const { period, outstanding } = penalty.data;
  if (period.status === "none" && Number(outstanding.total) <= 0) return null;
  const run = period.status === "approved" ? period.approved : period.preview;
  return {
    status: period.status,
    deducted: period.status === "none" ? null : run.deducted,
    net: period.status === "none" ? null : run.net,
    crossingRuns: period.crossingRuns,
    penalties: outstanding.penalties,
    other: outstanding.other,
    total: outstanding.total,
  };
};
