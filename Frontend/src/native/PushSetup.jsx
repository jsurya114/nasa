import { useEffect, useState } from "react";
import useTranslation from "../hooks/useTranslation.js";
import { isNativeShell } from "./bridge";
import {
  getPushStatus,
  registerThisPhone,
  rememberNotNow,
  removeThisPhone,
  requestPushPermission,
  shouldAskAgain,
} from "./push";
import { onSignOut } from "./sessionStore";

// iOS says "undetermined" before the first question. Android has no such state: before the first grant it says
// "denied" but still allows asking (canAskAgain). Both mean the person has not refused yet. Only a refusal the system
// will not repeat (denied and not askable) is left alone; the person can still turn notifications on in the settings.
const canBeAsked = ({ permission, canAskAgain }) => permission === "undetermined" || (permission === "denied" && canAskAgain);

// Mounted for a signed-in person inside the app. Registers this phone if notifications are already allowed, asks in
// our own words first if they have not been decided, and does nothing in a browser, on a phone that cannot receive
// push, or when the person said no. The app is fully usable in every case.
export default function PushSetup({ area }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!isNativeShell()) return undefined;
    return onSignOut((event) => (event.area === area ? removeThisPhone(event) : undefined));
  }, [area]);

  useEffect(() => {
    if (!isNativeShell()) return undefined;
    let cancelled = false;
    (async () => {
      const status = await getPushStatus();
      if (cancelled || !status?.available) return;
      if (status.permission === "granted") await registerThisPhone(area);
      else if (canBeAsked(status) && shouldAskAgain(area)) setAsking(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [area]);

  if (!asking) return null;

  const allow = async () => {
    setAsking(false);
    if ((await requestPushPermission()) === "granted") await registerThisPhone(area);
  };
  const later = () => {
    rememberNotNow(area);
    setAsking(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="push-prompt-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="push-prompt-title" className="text-lg font-semibold text-gray-900">
          {t("pushPromptTitle")}
        </h2>
        <p className="mt-2 text-sm text-gray-600">{t("pushPromptBody")}</p>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={later} className="min-h-11 flex-1 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700">
            {t("pushPromptLater")}
          </button>
          <button type="button" onClick={allow} className="min-h-11 flex-1 rounded-xl bg-purple-700 px-4 text-sm font-semibold text-white">
            {t("pushPromptAllow")}
          </button>
        </div>
      </div>
    </div>
  );
}
