import React from "react";
import { formatMoney } from "../../../utils/money.js";

// Claims this driver had more deducted for than they now owe in this city (the server's "refundsDue", the same items a
// pay run flags as claim_over_recovered). Recording the refund here links it to the claim, so it is paid once and the
// item clears; a refund not linked to the claim would leave the item open.
export default function RefundsDue({ refunds, onRecord }) {
  if (refunds.length === 0) return null;
  return (
    <section aria-labelledby="refunds-due" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <h2 id="refunds-due" className="text-sm font-semibold text-amber-900">Refunds due</h2>
      <ul className="mt-2 space-y-2">
        {refunds.map((r) => (
          <li key={r.claimId} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
            <span className="min-w-0 break-words">
              {r.claimType} · {r.waybill} ({r.courier === "speedx" ? "SpeedX" : "GOFO"}): {formatMoney(r.amount)} deducted more than is now owed
            </span>
            <button type="button" onClick={() => onRecord(r)}
              className="min-h-11 rounded-xl border border-amber-400 bg-white px-3 font-semibold text-amber-900">
              Record refund
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
