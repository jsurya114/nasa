import { useCallback, useEffect, useRef, useState } from "react";
import { getInsights, messageFor } from "./insightsApi.js";

// One report from /admin/insights for the filters given. Answers belong to the question that was asked: the figures of an earlier question are
// never shown for a new one (it says "loading" in between), a request that is replaced is cancelled, and a failure keeps its message for a retry.
export default function useInsightsReport(path, params, { enabled = true } = {}) {
  const key = JSON.stringify([path, params]);
  const [state, setState] = useState({ key: null, status: "idle", report: null, message: "" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(params);
  latest.current = params;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setState({ key, status: "loading", report: null, message: "" });
    getInsights(path, latest.current, controller.signal)
      .then((report) => { if (!controller.signal.aborted) setState({ key, status: "ready", report, message: "" }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ key, status: "error", report: null, message: messageFor(error) }); });
    return () => controller.abort();
  }, [key, path, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  // Between a change of filters and the start of its request, say "loading" rather than show the previous question's answer.
  const current = state.key === key ? state : { status: enabled ? "loading" : "idle", report: null, message: "" };
  return { status: current.status, report: current.report, message: current.message, reload };
}
