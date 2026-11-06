import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Modal from "../../../reuse/Modal.jsx";
import useTranslation from "../../../hooks/useTranslation.js";
import { useEvereeSetup } from "../../../hooks/useEvereeSetup.js";

// The "Complete your payment setup" popup. "Remind me later" closes the popup for this visit only: the banner, the setup card and the menu entry stay,
// and the server keeps holding work and payments. It never shows on the setup page, the agreement, or while a driver has nothing to do.
export default function PaymentSetupPrompt() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { status, data, required, enforced, promptDismissed, dismissPrompt } = useEvereeSetup();
  if (status !== "ready" || !required || promptDismissed) return null;
  if (pathname === "/driver/payment-setup" || pathname === "/driver/agreement") return null;
  if (data?.state === "classification-required" || data?.blockedBy === "agreement") return null;
  const go = () => { dismissPrompt(); navigate("/driver/payment-setup"); };
  return (
    <Modal title={t("psetPopupTitle")} onClose={dismissPrompt}>
      <p className="mt-3 text-sm text-ink">{enforced ? t("psetWhyEnforced") : t("psetWhySoft")}</p>
      <p className="mt-2 text-sm text-ink-muted">{t("psetPopupRead")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={go} className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white">
          {data?.state === "in-progress" ? t("psetContinue") : t("psetStart")}
        </button>
        <button type="button" onClick={dismissPrompt} className="min-h-11 rounded-xl border border-line bg-white px-5 font-semibold text-ink">{t("psetLater")}</button>
      </div>
    </Modal>
  );
}
