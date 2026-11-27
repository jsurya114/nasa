import { Navigate, Outlet } from "react-router-dom";
import usePayrollAccess from "../../components/Admin/payroll/usePayrollAccess.js";

// The Payroll page: for the super admin and the admins the super admin switched Payroll on for (their own cities only, checked by the server). Put it
// inside ProtectedRoutes, which has already confirmed the sign-in. Any other admin is sent to the dashboard; the server refuses their requests as well.
const PayrollRoute = () => {
  const access = usePayrollAccess();
  if (access === "checking") return <p role="status" className="p-6 text-sm text-ink-muted">Loading…</p>;
  return access === "yes" ? <Outlet /> : <Navigate to="/admin/dashboard" replace />;
};

export default PayrollRoute;
