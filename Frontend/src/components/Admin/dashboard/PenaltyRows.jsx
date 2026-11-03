import React from "react";
import { Link } from "react-router-dom";
import { Gavel, Banknote } from "lucide-react";
import { describePenalty } from "./usePenaltySummary.js";

const CELL = "px-3 py-3 border-b border-gray-200 whitespace-nowrap";
const money = (v) => `$${Number(v).toFixed(2)}`;
const STATUS_LABEL = { approved: "Approved", preview: "Preview: draft pay run, not approved" };

// Table rows for the totals block, placed just below the insurance deduction (#166). "This payday" is what the pay runs in
// the chosen dates took, never the whole debt; "still outstanding" is what is left after them. The pay run's own net is
// shown as its own line, so the deduction is never subtracted from a second net.
export default function PenaltyRows({ penalty, colSpan = 11 }) {
  const d = describePenalty(penalty);
  if (!d) return null;
  const history = `/admin/payroll?cityId=${penalty.cityId}&driverId=${penalty.driverId}`;
  return (
    <>
      {d.deducted !== null && (
        <tr className="bg-amber-50 font-bold" data-testid="penalty-deduction-row">
          <td className={CELL} colSpan={colSpan}>
            <Gavel className="inline h-4 w-4 -mt-0.5 mr-1.5" aria-hidden="true" />
            Claims / deductions this payday
            <span className="ml-2 text-xs font-medium text-gray-600">{STATUS_LABEL[d.status]}</span>
            <span className="block text-xs font-normal text-gray-600">
              {d.status === "approved" ? "Already included in the approved net below; not subtracted again." : "Included in the draft net below."}
              {d.crossingRuns > 0 && ` ${d.crossingRuns} pay run${d.crossingRuns === 1 ? "" : "s"} cross${d.crossingRuns === 1 ? "es" : ""} these dates and ${d.crossingRuns === 1 ? "is" : "are"} not counted.`}
            </span>
          </td>
          <td className={`${CELL} text-red-600 text-lg`}>-{money(d.deducted)}</td>
          <td className={CELL} colSpan="2" />
        </tr>
      )}
      <tr className="bg-amber-50/60 font-semibold" data-testid="penalty-outstanding-row">
        <td className={CELL} colSpan={colSpan}>
          Penalties still outstanding
          {Number(d.other) > 0 && <span className="ml-2 text-xs font-medium text-gray-600">(other debts: {money(d.other)})</span>}
          <Link to={history} className="ml-3 text-sm font-medium text-brand-600 underline">View entries and history</Link>
        </td>
        <td className={`${CELL} text-gray-800 text-lg`}>{money(d.penalties)}</td>
        <td className={CELL} colSpan="2" />
      </tr>
      {d.net !== null && (
        <tr className="bg-green-50 font-bold" data-testid="penalty-net-row">
          <td className={CELL} colSpan={colSpan}>
            <Banknote className="inline h-4 w-4 -mt-0.5 mr-1.5" aria-hidden="true" />
            Pay run net ({d.status === "approved" ? "approved" : "preview"})
          </td>
          <td className={`${CELL} text-green-700 text-lg`}>{money(d.net)}</td>
          <td className={CELL} colSpan="2" />
        </tr>
      )}
    </>
  );
}
