import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { adminLogout } from '../redux/slice/admin/adminSlice';
import { driverLogout } from '../redux/slice/driver/driverSlice';

const useInactivityLogout = () => {
    const dispatch = useDispatch();
    const { isAuthenticated: isAdminAuthenticated } = useSelector((state) => state.admin);
    const { isAuthenticated: isDriverAuthenticated } = useSelector((state) => state.driver);

    const timeoutRef = useRef(null);

    // Timeouts in milliseconds
    const ADMIN_TIMEOUT = 5 * 60 * 60 * 1000; // 5 hours
    const DRIVER_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours (expanded for mobile usage)

    const getTimeoutAndAction = () => {
        if (isAdminAuthenticated) {
            return { timeout: ADMIN_TIMEOUT, logoutAction: adminLogout };
        } else if (isDriverAuthenticated) {
            return { timeout: DRIVER_TIMEOUT, logoutAction: driverLogout };
        }
        return { timeout: 0, logoutAction: null };
    };

    const resetTimer = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        const { timeout, logoutAction } = getTimeoutAndAction();

        if (timeout > 0 && logoutAction) {
            // Save last activity timestamp to localStorage
            localStorage.setItem('lastActivity', Date.now().toString());

            timeoutRef.current = setTimeout(() => {
                console.log("Session timed out due to inactivity");
                localStorage.removeItem('lastActivity');
                dispatch(logoutAction());
            }, timeout);
        }
    };

    useEffect(() => {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];

        const handleActivity = () => {
            resetTimer();
        };

        const checkInactivity = () => {
            const { timeout, logoutAction } = getTimeoutAndAction();
            if (timeout > 0 && logoutAction) {
                const lastActivity = localStorage.getItem('lastActivity');
                if (lastActivity) {
                    const elapsed = Date.now() - parseInt(lastActivity, 10);
                    if (elapsed >= timeout) {
                        console.log("Session expired during tab closure");
                        localStorage.removeItem('lastActivity');
                        dispatch(logoutAction());
                        return true;
                    }
                }
            }
            return false;
        };

        if (isAdminAuthenticated || isDriverAuthenticated) {
            // Check if already expired before setting up listeners
            const expired = checkInactivity();
            if (!expired) {
                // Ensure lastActivity is initialized if not present
                if (!localStorage.getItem('lastActivity')) {
                    localStorage.setItem('lastActivity', Date.now().toString());
                }
                resetTimer();
                events.forEach((event) => {
                    window.addEventListener(event, handleActivity);
                });
            }
        }

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            events.forEach((event) => {
                window.removeEventListener(event, handleActivity);
            });
        };
    }, [isAdminAuthenticated, isDriverAuthenticated, dispatch]);

    return null;
};

export default useInactivityLogout;
