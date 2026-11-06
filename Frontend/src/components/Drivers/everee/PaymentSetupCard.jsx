import React from "react";
import { CheckCircle2, CircleAlert, Clock, Wallet } from "lucide-react";
import useTranslation from "../../../hooks/useTranslation.js";
import { useEvereeSetup } from "../../../hooks/useEvereeSetup.js";
import { STATE_VIEW, TONE_CLASS } from "./setupLabels.js";

const ICON = { good: CheckCircle2, warn: CircleAlert, bad: CircleAlert, info: Clock };

// A small, permanent summary of the driver's payment setup, for the Pay page. It is shown for every Local driver (and for a driver waiting to be
// classified) and never goes away by being dismissed: only finishing the setup changes it. It has a link to the full setup page when something is left to do.
export default function PaymentSetupCard({ onOpen }) {
  const { t } = useTranslation();
  const { status, data, required, enforced } = useEvereeSetup();
  if (status !== "ready" || !data) return null;
  const view = STATE_VIEW[data.state];
  if (!view) return null;
  const Icon = ICON[view.tone] ?? Wallet;
  return (
    <section aria-label={t("psetTitle")} className={`mb-4 rounded-2xl p-4 ring-1 ${TONE_CLASS[view.tone]}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {t("psetTitle")}
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">{t(view.label)}</span>
          </p>
          <p className="mt-1 text-sm">{t(view.hint)}</p>
          {required && <p className="mt-1 text-sm font-medium">{enforced ? t("psetWhyEnforced") : t("psetWhySoft")}</p>}
          {required && onOpen && (
            <button type="button" onClick={onOpen} className="mt-3 min-h-11 rounded-xl bg-brand px-4 font-semibold text-white">
              {data.state === "in-progress" ? t("psetContinue") : t("psetOpen")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
