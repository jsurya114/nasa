import { useContext, useEffect, useState } from "react";
import { ReactReduxContext } from "react-redux";
import axios from "../../../../redux/slice/axiosInstance";

// Whether to offer paying through Everee at all: a super admin, on a server where Everee is set up. Asked once per list, not per run.
export default function useEvereeAvailable() {
  // Read from the store when there is one (the context is empty, not an error, in a page rendered without it); the role does not change in a session.
  const isSuperAdmin = Boolean(useContext(ReactReduxContext)?.store.getState().admin?.isSuperAdmin);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!isSuperAdmin) { setAvailable(false); return undefined; }
    const controller = new AbortController();
    axios.get("/admin/payroll/everee/status", { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setAvailable(Boolean(data?.configured)); })
      .catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => controller.abort();
  }, [isSuperAdmin]);
  return available;
}
