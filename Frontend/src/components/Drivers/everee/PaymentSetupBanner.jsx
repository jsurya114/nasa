import React from "react";
import { Link, useLocation } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import useTranslation from "../../../hooks/useTranslation.js";
import { useEvereeSetup } from "../../../hooks/useEvereeSetup.js";

// A slim strip at the top of every signed-in driver page while the setup is unfinished. Unlike the popup it cannot be dismissed.
export default function PaymentSetupBanner() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { status, required, enforced } = useEvereeSetup();
  if (status !== "ready" || !required || pathname === "/driver/payment-setup" || pathname === "/driver/agreement") return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
      <span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{enforced ? t("psetBannerEnforced") : t("psetBannerSoft")}</span>
      <Link to="/driver/payment-setup" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold underline">{t("psetOpen")}</Link>
    </div>
  );
}
