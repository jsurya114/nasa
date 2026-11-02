import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { accessDriver } from "../../redux/slice/driver/driverSlice.js";
import AuthCheckRetry from "../../native/AuthCheckRetry.jsx";
import PushSetup from "../../native/PushSetup.jsx";

function DProtectRoutes() {
    const dispatch = useDispatch()
    const location = useLocation()
    const { isAuthenticated, driver, authCheckFailed } = useSelector((state) => state.driver)
    
    useEffect(() => {
        dispatch(accessDriver())
    }, [dispatch])

    if (isAuthenticated === null) {
        return authCheckFailed ? <AuthCheckRetry onRetry={() => dispatch(accessDriver())} /> : null;
    }

    if (!isAuthenticated) {
        return <Navigate to="/driver/login" />;
    }

    // Block access if agreement is not signed (unless they are already on the agreement page)
    if (driver && driver.agreement_signed === false && location.pathname !== "/driver/agreement") {
        return <Navigate to="/driver/agreement" />;
    }

    // If they are on the agreement page but have already signed, redirect to dashboard
    if (driver && driver.agreement_signed === true && location.pathname === "/driver/agreement") {
        return <Navigate to="/driver/dashboard" />;
    }

    return (
        <>
            <PushSetup area="driver" />
            <Outlet />
        </>
    );
}

export default DProtectRoutes