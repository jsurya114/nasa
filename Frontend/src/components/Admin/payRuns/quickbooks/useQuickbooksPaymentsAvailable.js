import { useContext, useEffect, useState } from "react";
import { ReactReduxContext } from "react-redux";
import axios from "../../../../redux/slice/axiosInstance";

// Whether Desi drivers are recorded in QuickBooks: a super admin, on a server where QuickBooks payments are switched on. Asked once per list, not per run.
export default function useQuickbooksPaymentsAvailable() {
  const isSuperAdmin = Boolean(useContext(ReactReduxContext)?.store.getState().admin?.isSuperAdmin);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!isSuperAdmin) { setAvailable(false); return undefined; }
    const controller = new AbortController();
    axios.get("/admin/payroll/quickbooks/status", { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setAvailable(Boolean(data?.paymentsEnabled)); })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, [isSuperAdmin]);
  return available;
}
