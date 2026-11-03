import React from "react";
import { ChevronRight } from "lucide-react";
import useTranslation from "../../../hooks/useTranslation.js";
import { formatMoney } from "../../../utils/money.js";
import { stateKey, stateTone } from "./payLabels.js";

export function StateBadge({ state }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stateTone(state)}`}>
      {t(stateKey(state))}
    </span>
  );
}

// The driver's statements, newest first. Each row opens the full statement.
export default function StatementList({ statements, onOpen }) {
  const { t, currentLanguage } = useTranslation();

  if (statements.length === 0) {
    return <p className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">{t("noPayStatements")}</p>;
  }

  return (
    <ul className="space-y-3">
      {statements.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(s.id)}
            className="flex w-full min-h-11 items-center gap-3 rounded-2xl border border-line bg-white p-4 text-left transition hover:border-brand-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink tabular-nums">
                <span className="sr-only">{t("viewStatement")} </span>
                <span className="whitespace-nowrap">{s.period_start}</span> – <span className="whitespace-nowrap">{s.period_end}</span>
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {s.city} · {t(s.data_type === "weekly" ? "payWeekly" : "payDaily")}
              </p>
              <div className="mt-2">
                <StateBadge state={s.state} />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-muted">{t("netPay")}</p>
              <p className={`text-lg font-semibold tabular-nums ${s.state === "voided" ? "text-ink-muted line-through" : "text-ink"}`}>
                {formatMoney(s.net, currentLanguage)}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 flex-shrink-0 text-ink-muted" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
