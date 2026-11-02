import useTranslation from "../hooks/useTranslation.js";

// Shown when the app could not check the sign-in because of the connection. The session is kept. Nothing is
// signed out, and nothing is shown as saved or loaded.
export default function AuthCheckRetry({ onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
      <h1 className="text-xl font-semibold text-ink">{t("connectionProblemTitle")}</h1>
      <p className="text-ink-muted">{t("connectionProblemBody")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30"
      >
        {t("tryAgain")}
      </button>
    </div>
  );
}
