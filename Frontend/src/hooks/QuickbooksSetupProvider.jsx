import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "../redux/slice/axiosInstance";
import { QuickbooksSetupContext, isQbLocked, isQbRequired } from "./useQuickbooksSetup.js";

// Fills the context with the signed-in Desi driver's QuickBooks setup state. It lives in React state only: never in Redux, storage or the URL, so nothing is left for the
// next person on the phone. The tax ID is never kept here: it is sent once by start() and the form clears it.
export default function QuickbooksSetupProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [data, setData] = useState(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (signal) => {
    try {
      const { data: body } = await axios.get("/driver/quickbooks/status", { signal });
      if (signal?.aborted || !mounted.current) return;
      setData(body);
      setStatus("ready");
    } catch {
      if (!signal?.aborted && mounted.current) setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => { setStatus("loading"); return load(); }, [load]);

  // Sets up the vendor. Throws the server's answer (code, missing fields) for the form to show.
  const start = useCallback(async (details) => {
    const { data: body } = await axios.post("/driver/quickbooks/onboarding", details ?? {});
    if (mounted.current) { setData(body); setStatus("ready"); }
    return body;
  }, []);

  const value = useMemo(() => ({
    status, data, reload, start,
    required: isQbRequired(data),
    enforced: Boolean(data?.enforced),
    locked: isQbLocked(data),
  }), [status, data, reload, start]);

  return <QuickbooksSetupContext.Provider value={value}>{children}</QuickbooksSetupContext.Provider>;
}
