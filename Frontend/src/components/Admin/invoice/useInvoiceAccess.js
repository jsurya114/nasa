import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import axios from "../../../redux/slice/axiosInstance";

// Whether this admin may use Invoices: "yes" (the super admin, or an admin the super admin switched it on for), "no", or "checking" while the
// server is asked. The server decides and refuses every Invoices request of an admin without access as well, so this only shows or hides the page.
export default function useInvoiceAccess() {
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  const [answer, setAnswer] = useState("checking");
  useEffect(() => {
    if (isSuperAdmin) return undefined;
    let current = true;
    axios
      .get("/admin/invoices/access")
      .then(({ data }) => current && setAnswer(data?.allowed === true ? "yes" : "no"))
      .catch(() => current && setAnswer("no"));
    return () => {
      current = false;
    };
  }, [isSuperAdmin]);
  return isSuperAdmin ? "yes" : answer;
}
