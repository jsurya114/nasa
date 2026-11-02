import { Navigate, Outlet } from "react-router-dom";

import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { accessDriver } from "../../redux/slice/driver/driverSlice.js";
import AuthCheckRetry from "../../native/AuthCheckRetry.jsx";

function DPublicRoutes() {
    const dispatch = useDispatch()
    const { isAuthenticated, authCheckFailed } = useSelector((state) => state.driver)

    useEffect(() => {
        dispatch(accessDriver())
    }, [dispatch]);

    if (isAuthenticated === null) {
        return authCheckFailed ? <AuthCheckRetry onRetry={() => dispatch(accessDriver())} /> : null;
    }

    return isAuthenticated ? <Navigate to="/driver/dashboard" /> : <Outlet />
}

export default DPublicRoutes