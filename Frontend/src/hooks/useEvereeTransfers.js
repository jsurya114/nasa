import { useCallback, useEffect, useState } from "react";
import axios from "../redux/slice/axiosInstance";

// The signed-in driver's own Everee transfers (issue #242, PR D1): what NASA sent to Everee for them and where each one stands, from NASA's own records.
// Kept in this hook only, never in Redux or storage, like the pay statements, so nothing is left for the next person on the phone.
export default function useEvereeTransfers() {
  const [data, setData] = useState({ transfers: [], lastCheckedAt: null });
  const [status, setStatus] = useState("loading"); // loading | ready | error

  const load = useCallback(async (signal) => {
    setStatus("loading");
    try {
      const { data: body } = await axios.get("/driver/everee/transfers", { signal });
      setData({ transfers: Array.isArray(body?.transfers) ? body.transfers : [], lastCheckedAt: body?.lastCheckedAt ?? null });
      setStatus("ready");
    } catch {
      if (!signal?.aborted) setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...data, status, reload: () => load() };
}
