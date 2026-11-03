import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import axios from "../../../redux/slice/axiosInstance";

// The dashboard's penalty figures for the driver, city and dates the admin applied (#166). The server reads them from
// pay statements and ledger balances; nothing is calculated here. Nothing is asked until a city, a driver and both
// dates are chosen, because "this payday" only means something for a date range. Any error simply hides the rows.
export default function usePenaltySummary() {
  const { cities, drivers, filters } = useSelector((state) => state.dash);
  const cityId = filters?.job && filters.job !== "All" ? cities?.find((c) => c.job === filters.job)?.id : undefined;
  const driverId = filters?.driver && filters.driver !== "All" ? drivers?.find((d) => d.name === filters.driver)?.id : undefined;
  const from = filters?.startDate;
  const to = filters?.endDate;
  const [state, setState] = useState({ status: "idle", data: null });
  const [attempt, setAttempt] = useState(0);
  // "Expected": the admin chose a city, a driver and both dates, so payroll figures belong on this page. Until they arrive,
  // or if they fail, the page must say so rather than leave an unadjusted amount looking payable.
  const expected = Boolean(cityId && driverId && from && to);

  useEffect(() => {
    if (!expected) {
      setState({ status: "idle", data: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", data: null });
    axios.get(`/admin/payroll/drivers/${driverId}/dashboard-summary`, { params: { cityId, from, to }, signal: controller.signal })
      .then(({ data }) => setState({ status: "ready", data }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", data: null }); });
    return () => controller.abort();
  }, [expected, cityId, driverId, from, to, attempt]);

  return { ...state, cityId, driverId, expected, retry: () => setAttempt((n) => n + 1) };
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
