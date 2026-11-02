import { Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { accessAdminUser } from "../../redux/slice/admin/adminSlice";
import AuthCheckRetry from "../../native/AuthCheckRetry.jsx";

function AdminPublicOnlyRoute() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isAuthenticated, loading, authCheckFailed } = useSelector((state) => state.admin);

  useEffect(() => {
    // Only call /admin/access-admin when auth state is unknown.
    if (isAuthenticated === null) {
      dispatch(accessAdminUser());
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/admin/dashboard", { replace: true });
    }
  }, [loading, isAuthenticated, navigate]);

  if (loading || isAuthenticated) return null;
  if (isAuthenticated === null && authCheckFailed) return <AuthCheckRetry onRetry={() => dispatch(accessAdminUser())} />;

  return <Outlet />;
}

export default AdminPublicOnlyRoute;