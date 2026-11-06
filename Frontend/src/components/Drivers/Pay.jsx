import usePersistentState from "../../hooks/usePersistentState.js";
import React from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import useTranslation from "../../hooks/useTranslation.js";
import usePayStatements from "../../hooks/usePayStatements.js";
import StatementList from "./pay/StatementList.jsx";
import StatementDetail from "./pay/StatementDetail.jsx";
import BalanceSummary from "./pay/BalanceSummary.jsx";
import PaymentSetupCard from "./everee/PaymentSetupCard.jsx";

// "My pay" (#145): the driver's approved statements and open balances, read-only, straight from the server.
export default function Pay() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { statements, balances, status, reload } = usePayStatements();
  // The statement the driver had open is still open when they come back.
  const [openId, setOpenId] = usePersistentState("driver", "pay", "openId", null);

  let body;
  if (openId) {
    body = <StatementDetail statementId={openId} onBack={() => setOpenId(null)} />;
  } else if (status === "loading") {
    body = <SkeletonList rows={4} label={t("loading")} />;
  } else if (status === "error") {
    body = (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{t("payLoadError")}</p>
        <button type="button" onClick={reload} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold text-red-700">
          {t("tryAgain")}
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <BalanceSummary balances={balances} />
        <h3 className="mb-2 text-sm font-semibold text-ink">{t("payStatements")}</h3>
        <StatementList statements={statements} onOpen={setOpenId} />
      </>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />
      <main className="mx-auto mt-4 mb-24 max-w-3xl px-4 pb-36 sm:mt-6 sm:px-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-gray-800">{t("myPay")}</h2>
          <p className="mt-1 text-sm text-gray-500">{t("myPayHint")}</p>
        </div>
        {!openId && <PaymentSetupCard onOpen={() => navigate("/driver/payment-setup")} />}
        {body}
      </main>
      <Nav />
    </div>
  );
}
