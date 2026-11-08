import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { accessDriver } from "../../redux/slice/driver/driverSlice.js";
import AuthCheckRetry from "../../native/AuthCheckRetry.jsx";
import PushSetup from "../../native/PushSetup.jsx";
import EvereeSetupProvider from "../../hooks/EvereeSetupProvider.jsx";
import PaymentSetupBanner from "../../components/Drivers/everee/PaymentSetupBanner.jsx";
import SetupLock from "../../components/Drivers/everee/SetupLock.jsx";
import PaymentSetupPrompt from "../../components/Drivers/everee/PaymentSetupPrompt.jsx";

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

    // On the agreement page but already signed: on to the payment setup, which sends a driver with nothing to set up to the dashboard.
    // (Unsigned drivers are sent to the agreement above, so the two redirects cannot loop.)
    if (driver && driver.agreement_signed === true && location.pathname === "/driver/agreement") {
        return <Navigate to="/driver/payment-setup" replace />;
    }

    return (
        <EvereeSetupProvider>
            <PushSetup area="driver" />
            <PaymentSetupBanner />
            <PaymentSetupPrompt />
            <SetupLock><Outlet /></SetupLock>
        </EvereeSetupProvider>
    );
}

export default DProtectRoutes