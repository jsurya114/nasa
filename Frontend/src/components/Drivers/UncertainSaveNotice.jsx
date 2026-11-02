import useTranslation from "../../hooks/useTranslation.js";

// Shown when a save may or may not have reached the server. While it says "checking" or "could not confirm", the form's
// submit button stays off so the same thing cannot be sent twice.
export default function UncertainSaveNotice({ state, onCheckAgain }) {
  const { t } = useTranslation();
  if (!state) return null;

  if (state === "notSaved") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        {t("saveNotSaved")}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
      <p className="font-semibold">{t("saveUncertainTitle")}</p>
      <p className="mt-1">{state === "checking" ? t("saveChecking") : t("saveUncertainBody")}</p>
      {state === "unconfirmed" && (
        <button type="button" onClick={onCheckAgain} className="mt-2 min-h-11 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white">
          {t("saveCheckAgain")}
        </button>
      )}
    </div>
  );
}
