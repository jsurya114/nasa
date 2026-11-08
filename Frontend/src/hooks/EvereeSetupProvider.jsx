import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "../redux/slice/axiosInstance";
import { isNativeShell } from "../native/bridge";
import { EvereeSetupContext, isSetupLocked, isSetupRequired } from "./useEvereeSetup.js";

// Fills the context with the signed-in driver's setup state. It lives in React state only: never in Redux, storage or the URL, so nothing is left for the
// next person on the phone, and it is gone when the driver signs out (this unmounts with the signed-in pages). A session link is returned to the caller
// once and never kept here.
export default function EvereeSetupProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [data, setData] = useState(null);
  const [promptDismissed, setPromptDismissed] = useState(false); // the popup only: the setup card and the banner stay
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (signal) => {
    try {
      const { data: body } = await axios.get("/driver/everee/status", { signal });
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

  // Asks the server to read the worker from Everee again. A failure keeps what is shown (the server never erases a verified state on a timeout).
  const refresh = useCallback(async () => {
    try {
      const { data: body } = await axios.post("/driver/everee/refresh");
      if (mounted.current) { setData(body); setStatus("ready"); }
      return body;
    } catch {
      return null;
    }
  }, []);

  // Starts the setup. Throws the server's answer (code, missing fields) for the form to show.
  const start = useCallback(async (details) => {
    const { data: body } = await axios.post("/driver/everee/onboarding", details ?? {});
    if (mounted.current) { setData(body); setStatus("ready"); }
    return body;
  }, []);

  // A fresh, single-use screen link, only when a button is pressed. Returned to the caller and not kept.
  const openSession = useCallback(async (experience = "ONBOARDING") => {
    const { data: body } = await axios.post("/driver/everee/session", { experience, platform: isNativeShell() ? "native" : "web" });
    return body;
  }, []);

  const value = useMemo(() => ({
    status, data, reload, refresh, start, openSession,
    required: isSetupRequired(data),
    enforced: Boolean(data?.enforced),
    locked: isSetupLocked(data),
    promptDismissed,
    dismissPrompt: () => setPromptDismissed(true),
  }), [status, data, reload, refresh, start, openSession, promptDismissed]);

  return <EvereeSetupContext.Provider value={value}>{children}</EvereeSetupContext.Provider>;
}

