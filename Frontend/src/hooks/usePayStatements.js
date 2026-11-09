import { useCallback, useEffect, useState } from "react";
import axios from "../redux/slice/axiosInstance";

// The signed-in driver's pay statements and balances (#145). The server takes the driver from the token.
// Kept in this hook only, never in Redux or storage, so nothing is left for the next person on the phone.
export default function usePayStatements() {
  const [data, setData] = useState({ statements: [], balances: null });
  const [status, setStatus] = useState("loading"); // loading | ready | error

  const load = useCallback(async (signal) => {
    setStatus("loading");
    try {
      const [list, balances] = await Promise.all([
        axios.get("/driver/payroll/statements", { signal }),
        axios.get("/driver/payroll/balances", { signal }),
      ]);
      setData({ statements: list.data?.statements ?? [], balances: balances.data ?? null });
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

export const fetchPayStatement = async (statementId, signal) =>
  (await axios.get(`/driver/payroll/statements/${encodeURIComponent(statementId)}`, { signal })).data;
