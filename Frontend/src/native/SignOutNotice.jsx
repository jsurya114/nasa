import { useState, useSyncExternalStore } from "react";
import useTranslation from "../hooks/useTranslation.js";
import { clearSession, isSignOutPending, signOutSnapshot, subscribeSignOut } from "./sessionStore";

// Stays on the sign-in screen while the phone has not confirmed that a sign-out removed the session.
// Until it does, the old session is never restored, and "Try again" repeats the sign-out.
export default function SignOutNotice({ area }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  useSyncExternalStore(subscribeSignOut, signOutSnapshot, signOutSnapshot);

  if (!isSignOutPending(area)) return null;

  const retry = async () => {
    setBusy(true);
    try {
      await clearSession(area);
    } catch {
      // Still not confirmed: the notice stays
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-left text-sm text-red-800" role="alert">
      <p className="font-semibold">{t("signOutUnconfirmedTitle")}</p>
      <p className="mt-1">{t("signOutUnconfirmedBody")}</p>
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="mt-2 min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {t("tryAgain")}
      </button>
    </div>
  );
}
