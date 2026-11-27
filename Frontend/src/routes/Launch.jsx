import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import Loader from "../components/Loader.jsx";
import { recheckSessions, sessionOverview } from "../native/sessionStore";

const HOME = { admin: "/admin/dashboard", driver: "/driver/dashboard" };
const SLOW_MS = 8000;

// The address "/" (where the app opens). Sends a signed-in person to their own area, where the route guards check the
// sign-in, agreement and payment setup as usual, and anyone else to the sign-in page. While the check runs it shows
// Loading; if it is slow or the phone cannot reach NASA, it says so and offers Try again instead of a blank or a 404.
export default function Launch() {
  const [state, setState] = useState({ phase: "checking" });
  const [slow, setSlow] = useState(false);

  const check = useCallback(async (again = false) => {
    setState({ phase: "checking" });
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    try {
      if (again) await recheckSessions();
      const { areas, unreachable } = await sessionOverview();
      setState(unreachable ? { phase: "offline" } : { phase: "done", areas });
    } catch {
      setState({ phase: "offline" });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  if (state.phase === "done") {
    if (state.areas.length === 1) return <Navigate to={HOME[state.areas[0]]} replace />;
    if (state.areas.length === 0) return <Navigate to="/login" replace />;
    // Only a browser can hold both (an admin who also has a driver account). The app keeps one at a time.
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-semibold text-ink">Continue as</h1>
        <Link className="min-h-11 w-64 rounded-xl bg-brand px-6 py-3 font-semibold text-white" to={HOME.admin}>Administrator</Link>
        <Link className="min-h-11 w-64 rounded-xl border border-brand-500 px-6 py-3 font-semibold text-brand-800" to={HOME.driver}>Driver</Link>
      </main>
    );
  }

  if (state.phase === "offline" || slow) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <h1 className="text-xl font-semibold text-ink">{state.phase === "offline" ? "Can't reach NASA" : "Still checking your sign-in"}</h1>
        <p className="text-ink-muted">You are still signed in on this phone. Check your connection and try again.</p>
        <button type="button" onClick={() => check(true)} className="min-h-11 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white">
          Try again
        </button>
        <Link to="/support" className="text-sm underline text-ink-muted">Help and support</Link>
      </main>
    );
  }
  return <Loader />;
}
