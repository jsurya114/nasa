import React from "react";
import useTranslation from "../../../hooks/useTranslation.js";
import { formatMoney } from "../../../utils/money.js";
import { TRANSFER_VIEW } from "./transferLabels.js";

const when = (iso, lang) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(lang === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short" });
};

// The driver's Everee transfers, kept apart from the approved statements and cash receipts: a transfer pays a statement, it is not extra money.
// "Completed" is shown only for what NASA verified; everything else says plainly that the money has not reached the bank yet.
export default function EvereeTransfers({ transfers, lastCheckedAt, status, reload }) {
  const { t, currentLanguage } = useTranslation();
  if (status === "loading") return null;
  if (status === "error") {
    return (
      <section aria-label={t("etrTitle")} className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{t("etrLoadError")}</p>
        <button type="button" onClick={reload} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold text-red-700">{t("tryAgain")}</button>
      </section>
    );
  }
  if (transfers.length === 0) return null;
  return (
    <section aria-labelledby="etr-title" className="mb-5">
      <h3 id="etr-title" className="mb-1 text-sm font-semibold text-ink">{t("etrTitle")}</h3>
      <p className="mb-2 text-xs text-ink-muted">{t("etrSeparate")}</p>
      {lastCheckedAt && <p className="mb-2 text-xs text-ink-muted">{t("etrLastChecked")}: {when(lastCheckedAt, currentLanguage)}</p>}
      <ul className="space-y-2">
        {transfers.map((x) => {
          const view = TRANSFER_VIEW[x.status] ?? TRANSFER_VIEW.pending;
          return (
            <li key={x.id} className="rounded-2xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold tabular-nums">{formatMoney(x.amount)}</p>
                  <p className="text-xs text-ink-muted">{x.periodStart} – {x.periodEnd}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${view.tone}`}>{t(view.label)}</span>
              </div>
              <p className="mt-2 text-sm text-ink">{t(view.hint)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {t("etrSent")}: {when(x.sentAt, currentLanguage)}
                {x.paidAt ? ` · ${t("etrDeposited")}: ${when(x.paidAt, currentLanguage)}` : ""}
                {x.lastCheckedAt ? ` · ${t("etrLastChecked")}: ${when(x.lastCheckedAt, currentLanguage)}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
