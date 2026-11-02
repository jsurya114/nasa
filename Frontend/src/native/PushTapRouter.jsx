import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { isNativeShell } from "./bridge";
import { routeForScreen, takePendingTap } from "./push";

const EVENT = "nasa-native-event";
// A tap made while nobody is signed in waits this long for a sign-in, then is dropped.
export const TAP_LIFETIME_MS = 10 * 60 * 1000;
const AREAS = ["driver", "admin"];

// Opens the screen named by a tapped notification. The name comes from the shell's fixed list and is mapped to a
// route here; it is opened only for the area that is signed in. The route guards and the server decide what is shown.
// If nobody is signed in yet the tap waits for the sign-in. A name that no signed-in area can open is dropped.
export default function PushTapRouter() {
  const navigate = useNavigate();
  const driverAuth = useSelector((state) => state.driver?.isAuthenticated);
  const adminAuth = useSelector((state) => state.admin?.isAuthenticated);
  const [pending, setPending] = useState(null);
  const auth = useMemo(() => ({ driver: driverAuth, admin: adminAuth }), [driverAuth, adminAuth]);

  useEffect(() => {
    if (!isNativeShell()) return undefined;
    let alive = true;
    const collect = async () => {
      const screen = await takePendingTap();
      if (alive && screen) setPending({ screen, at: Date.now() });
    };
    collect(); // a tap that opened the app from closed
    const onEvent = (event) => {
      try {
        const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
        if (detail?.v === 1 && detail.type === "notification.tap") collect();
      } catch {
        // Not for us
      }
    };
    window.addEventListener(EVENT, onEvent);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, onEvent);
    };
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const signedIn = AREAS.filter((area) => auth[area] === true);
    const target = signedIn.map((area) => routeForScreen(area, pending.screen)).find(Boolean);
    if (target) {
      setPending(null);
      navigate(target);
      return undefined;
    }
    // Someone is signed in but cannot open that screen: nothing to wait for
    if (signedIn.length > 0) {
      setPending(null);
      return undefined;
    }
    // Nobody is signed in yet: wait for a sign-in, but not forever
    const timer = setTimeout(() => setPending(null), Math.max(0, TAP_LIFETIME_MS - (Date.now() - pending.at)));
    return () => clearTimeout(timer);
  }, [pending, auth, navigate]);

  return null;
}
