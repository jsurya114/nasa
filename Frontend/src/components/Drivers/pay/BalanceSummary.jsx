import React from "react";
import useTranslation from "../../../hooks/useTranslation.js";
import { formatMoney } from "../../../utils/money.js";
import { entryKey } from "./payLabels.js";

function Item({ title, lines, amount, note }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-ink break-words">{title}</p>
        <p className="text-sm font-semibold tabular-nums text-ink whitespace-nowrap">{amount}</p>
      </div>
      {lines.filter(Boolean).map((line) => <p key={line} className="mt-0.5 text-xs text-ink-muted break-words">{line}</p>)}
      {note && <p className="mt-1 text-xs font-semibold text-green-700">{note}</p>}
    </li>
  );
}

// What is still open: totals, then each claim, advance or expense with what was taken and when.
// adminView: an admin reads another person's account, so the cards say who owes whom (admin pages are English only).
const ADMIN_LABELS = { owe: "Driver owes NASA", owed: "NASA owes driver — reimbursements and adjustments" };

export default function BalanceSummary({ balances, adminView = false }) {
  const { t, currentLanguage } = useTranslation();
  const money = (v) => formatMoney(v, currentLanguage);
  if (!balances) return null;

  const paydays = (runs) => (runs.length ? `${t("takenOnPayday")}: ${runs.map((r) => r.periodEnd).join(", ")}` : null);
  const debits = balances.entries.filter((e) => e.direction === "debit" && Number(e.outstanding) > 0);
  const credits = balances.entries.filter((e) => e.direction === "credit" && e.entry_type !== "advance_repayment" && Number(e.outstanding) > 0);
  const claims = balances.claims.filter((c) => c.status === "exempt" || Number(c.outstanding) > 0);
  const penaltyCents = debits.filter((e) => e.entry_type === "manual_claim" && !e.exempt).reduce((sum, e) => sum + Math.round(Number(e.outstanding) * 100), 0);
  // "You still owe" leaves penalties out: they have their own total, so nothing is counted twice.
  const owedCents = Math.max(0, Math.round(Number(balances.totals.owedByDriver) * 100) - penaltyCents);
  const empty = debits.length + credits.length + claims.length === 0;

  return (
    <section aria-labelledby="pay-balances" className="mb-6">
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-white px-3 py-3">
          <dt className="text-xs font-medium text-ink-muted">{adminView ? ADMIN_LABELS.owe : t("youStillOwe")}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(owedCents / 100)}</dd>
        </div>
        {penaltyCents > 0 && (
          <div className="rounded-2xl border border-line bg-white px-3 py-3">
            <dt className="text-xs font-medium text-ink-muted">{t("penaltyCharges")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(penaltyCents / 100)}</dd>
          </div>
        )}
        <div className="rounded-2xl border border-line bg-white px-3 py-3">
          <dt className="text-xs font-medium text-ink-muted">{adminView ? ADMIN_LABELS.owed : t("owedToYou")}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{money(balances.totals.owedToDriver)}</dd>
        </div>
      </dl>

      <h3 id="pay-balances" className="mb-2 mt-5 text-sm font-semibold text-ink">{t("openBalances")}</h3>
      {empty ? (
        <p className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">{t("noOpenBalances")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {claims.map((c) => (
            <Item key={`c${c.id}`} title={`${c.claim_type} · ${c.waybill}`}
              amount={money(c.outstanding)}
              lines={[`${c.claim_at} · ${t("carrierCharge")}: ${money(c.source_charge)}`, Number(c.applied) > 0 && `${t("recovered")}: ${money(c.applied)}`, paydays(c.pay_runs)]}
              note={c.status === "exempt" ? t("exemptNotCharged") : null} />
          ))}
          {debits.map((e) => (
            <Item key={`e${e.id}`} title={`${t(entryKey(e.entry_type))}: ${e.reason}`}
              amount={money(e.outstanding)}
              lines={[
                `${e.effective_date} · ${t("originalAmount")}: ${money(e.amount)} · ${t("recovered")}: ${money(e.applied)}`,
                e.recovery_plan === "installments" ? `${t("planInstallments")} ${money(e.installment_amount)}` : e.recovery_plan === "full_next_payday" ? t("planFullNextPayday") : null,
                paydays(e.pay_runs),
              ]}
              note={e.exempt ? t("exemptNotCharged") : null} />
          ))}
          {credits.map((e) => (
            <Item key={`e${e.id}`} title={`${t(entryKey(e.entry_type))}: ${e.reason}`}
              amount={money(e.outstanding)}
              lines={[`${e.effective_date} · ${t("owedToYou")}`]} />
          ))}
        </ul>
      )}
    </section>
  );
}
