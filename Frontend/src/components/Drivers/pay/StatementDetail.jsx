import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import useTranslation from "../../../hooks/useTranslation.js";
import { fetchPayStatement } from "../../../hooks/usePayStatements.js";
import { formatMoney } from "../../../utils/money.js";
import { SkeletonList } from "../../../reuse/Skeleton.jsx";
import { StateBadge } from "./StatementList.jsx";
import { entryKey } from "./payLabels.js";

function Section({ title, children }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">{children}</ul>
    </section>
  );
}

function Row({ title, detail, amount }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink break-words">{title}</p>
        {detail && <p className="mt-0.5 text-xs text-ink-muted break-words">{detail}</p>}
      </div>
      <p className="text-sm font-semibold tabular-nums text-ink whitespace-nowrap">{amount}</p>
    </li>
  );
}

// One frozen statement, as the server stored it. Nothing here adds up pay again.
export default function StatementDetail({ statementId, onBack }) {
  const { t, currentLanguage } = useTranslation();
  const money = (v) => formatMoney(v, currentLanguage);
  const [statement, setStatement] = useState(null);
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    fetchPayStatement(statementId, controller.signal)
      .then((data) => { setStatement(data); setStatus("ready"); })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [statementId, attempt]);

  const back = (
    <button type="button" onClick={onBack} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-brand hover:bg-brand-50">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("backToStatements")}
    </button>
  );

  if (status === "loading") return <div>{back}<SkeletonList rows={4} label={t("loading")} /></div>;
  if (status === "error") {
    return (
      <div>
        {back}
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{t("payLoadError")}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-3 min-h-11 rounded-xl bg-white px-4 font-semibold text-red-700 border border-red-200">
            {t("tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  const lines = (type) => statement.lines.filter((l) => l.line_type === type);
  const minus = (v) => (Number(v) ? `-${v}` : v); // the server stores deductions as positive totals
  const totals = [
    ["payEarnings", statement.gross],
    ["payInsurance", minus(statement.insurance)],
    ["payReimbursements", statement.reimbursements],
    ["payClaimDeductions", minus(statement.claim_deductions)],
    ["payRecoveries", minus(statement.recoveries)],
  ];

  return (
    <div>
      {back}
      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink tabular-nums">
              <span className="whitespace-nowrap">{statement.period_start}</span> – <span className="whitespace-nowrap">{statement.period_end}</span>
            </h2>
            <p className="text-sm text-ink-muted">{statement.city} · {t(statement.data_type === "weekly" ? "payWeekly" : "payDaily")}</p>
          </div>
          <StateBadge state={statement.state} />
        </div>
        {statement.state === "voided" && <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-ink-muted">{t("voidedStatementNote")}</p>}
        <dl className="mt-4 space-y-2">
          {totals.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-sm">
              <dt className="text-ink-muted">{t(key)}</dt>
              <dd className="tabular-nums text-ink">{money(value)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-t border-line pt-2 text-base font-semibold">
            <dt>{t("netPay")}</dt>
            <dd className="tabular-nums">{money(statement.net)}</dd>
          </div>
          {Number(statement.carried_forward) > 0 && (
            <div className="flex justify-between gap-3 text-sm">
              <dt className="text-ink-muted">{t("payCarriedForward")}</dt>
              <dd className="tabular-nums text-ink">{money(statement.carried_forward)}</dd>
            </div>
          )}
          {statement.payout_reference && (
            <div className="flex justify-between gap-3 text-sm">
              <dt className="text-ink-muted">{t("paymentReference")}</dt>
              <dd className="break-all text-ink">{statement.payout_reference}</dd>
            </div>
          )}
        </dl>
      </div>

      {lines("earning").length > 0 && (
        <Section title={t("earningsSection")}>
          {lines("earning").map((l) => <Row key={l.id} title={l.journey_date} detail={l.route_name} amount={money(l.amount)} />)}
        </Section>
      )}
      {lines("claim").length > 0 && (
        <Section title={t("claimsSection")}>
          {lines("claim").map((l) => (
            <Row key={l.id} title={`${l.claim_type} · ${l.waybill}`}
              detail={`${l.claim_at} · ${t("carrierCharge")}: ${money(l.source_charge)}`}
              amount={money(l.amount)} />
          ))}
        </Section>
      )}
      {lines("recovery").length > 0 && (
        <Section title={t("recoveriesSection")}>
          {lines("recovery").map((l) => (
            <Row key={l.id} title={`${t(entryKey(l.entry_type))}: ${l.reason}`}
              detail={`${t("originalAmount")}: ${money(l.entry_amount)}${l.recovery_plan === "installments" ? ` · ${t("planInstallments")} ${money(l.installment_amount)}` : ""}`}
              amount={money(l.amount)} />
          ))}
        </Section>
      )}
      {lines("reimbursement").length > 0 && (
        <Section title={t("reimbursementsSection")}>
          {lines("reimbursement").map((l) => <Row key={l.id} title={l.reason} detail={t(entryKey(l.entry_type))} amount={money(l.amount)} />)}
        </Section>
      )}
    </div>
  );
}
