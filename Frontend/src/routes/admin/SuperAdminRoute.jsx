import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";

// Pages only the super admin may open (payroll, pay runs). Put it inside ProtectedRoutes, which has already confirmed the sign-in.
// Any other admin is sent to the dashboard. The server refuses their requests as well, so this only keeps the pages out of sight.
const SuperAdminRoute = () => {
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  return isSuperAdmin ? <Outlet /> : <Navigate to="/admin/dashboard" replace />;
};

export default SuperAdminRoute;
