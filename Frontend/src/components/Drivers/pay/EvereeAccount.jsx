import React from "react";
import { Landmark, ReceiptText } from "lucide-react";
import useTranslation from "../../../hooks/useTranslation.js";
import { useEvereeSetup } from "../../../hooks/useEvereeSetup.js";
import useEvereeWindow from "../../../hooks/useEvereeWindow.js";
import EvereeEmbed from "../everee/EvereeEmbed.jsx";

// For an enabled driver with verified completed setup: Everee's own payment history and bank-details screens, opened inside NASA on request (a fresh
// single-use link each time). NASA never sees bank details. Former Local drivers retain read-only history; bank management stays Local-only.
export default function EvereeAccount({ onClosed }) {
  const { t } = useTranslation();
  const { status, data } = useEvereeSetup();
  const win = useEvereeWindow({ onClosed });
  const canViewHistory = data?.canViewPaymentHistory ?? data?.state === "complete";
  const canManageBank = data?.canManageBankDetails ?? data?.state === "complete";
  if (status !== "ready" || (!canViewHistory && !canManageBank)) return null;
  return (
    <section aria-label={t("eacTitle")} className="mb-5 rounded-2xl border border-line bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">{t("eacTitle")}</h3>
      <p className="mt-1 text-xs text-ink-muted">{t("eacHint")}</p>
      {win.messageKey && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{t(win.messageKey)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canViewHistory && <button type="button" disabled={win.busy} onClick={() => win.open("PAYMENT_HISTORY")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 font-semibold text-ink disabled:opacity-60">
          <ReceiptText className="h-4 w-4" aria-hidden="true" />{t("eacHistory")}
        </button>}
        {canManageBank && <button type="button" disabled={win.busy} onClick={() => win.open("PAYMENT_DEPOSIT")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 font-semibold text-ink disabled:opacity-60">
          <Landmark className="h-4 w-4" aria-hidden="true" />{t("eacBank")}
        </button>}
      </div>
      {win.session && <EvereeEmbed session={win.session} onFinished={win.close} onClose={win.close} onProblem={win.problem} />}
    </section>
  );
}
