import { Navigate, Outlet } from "react-router-dom";
import useInvoiceAccess from "../../components/Admin/invoice/useInvoiceAccess.js";

// The Invoices page: for the super admin and the admins the super admin switched Invoices on for. Put it inside ProtectedRoutes, which has already
// confirmed the sign-in. Any other admin is sent to the dashboard. The server refuses their requests as well, so this only keeps the page out of sight.
const InvoiceRoute = () => {
  const access = useInvoiceAccess();
  if (access === "checking") return <p role="status" className="p-6 text-sm text-ink-muted">Loading…</p>;
  return access === "yes" ? <Outlet /> : <Navigate to="/admin/dashboard" replace />;
};

export default InvoiceRoute;
