import React from "react";
import { Link } from "react-router-dom";
import { Gavel, Banknote } from "lucide-react";
import { describePenalty } from "./usePenaltySummary.js";
import { payRunNet } from "./penaltyDisplay.js";

const CELL = "px-3 py-3 border-b border-gray-200 whitespace-nowrap";
const money = (v) => `$${Number(v).toFixed(2)}`;
const STATUS_LABEL = { approved: "Approved", preview: "Preview: draft pay run, not approved" };

// Table rows for the totals block, placed just below the insurance deduction (#166). "This payday" is what the pay runs in
// the chosen dates took, never the whole debt; "still outstanding" is what is left after them. While the figures load, or if
// they cannot be loaded, a row says so: the net shown below then does not include claims or recoveries.
export default function PenaltyRows({ penalty, colSpan = 11 }) {
  if (penalty?.needsDates) {
    return (
      <tr className="bg-gray-50" data-testid="penalty-dates-row">
        <td className={CELL} colSpan={colSpan + 3}>Claims / deductions and penalties: choose a start and an end date, then Filter Data, to see them for this driver.</td>
      </tr>
    );
  }
  if (!penalty?.expected) return null;
  if (penalty.status === "loading") {
    return (
      <tr className="bg-amber-50" data-testid="penalty-loading-row">
        <td className={CELL} colSpan={colSpan + 3} role="status">Claims / deductions: loading payroll figures… The net below does not yet include claims or recoveries.</td>
      </tr>
    );
  }
  if (penalty.status === "error") {
    return (
      <tr className="bg-red-50" data-testid="penalty-error-row">
        <td className={CELL} colSpan={colSpan + 3} role="alert">
          Claims / deductions could not be loaded. The net below does not include claims or recoveries, so do not treat it as the amount to pay.
          <button type="button" onClick={penalty.retry} className="ml-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold">Try again</button>
        </td>
      </tr>
    );
  }
  const d = describePenalty(penalty);
  if (!d) {
    // Ready, but nothing to show: say so, so a missing row is never a mystery.
    if (penalty.status !== "ready") return null;
    return (
      <tr className="bg-gray-50" data-testid="penalty-none-row">
        <td className={CELL} colSpan={colSpan + 3}>Claims / deductions: none for this driver in these dates (no pay run covers them and no penalty is outstanding).</td>
      </tr>
    );
  }
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
              {d.status === "approved" ? "Already included in the approved pay run net; not subtracted again." : "Included in the draft pay run net."}
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
          {d.deducted === null && <span className="block text-xs font-normal text-gray-600">No pay run covers these dates, so nothing has been deducted yet.</span>}
          <Link to={history} className="ml-3 text-sm font-medium text-brand-600 underline">View entries and history</Link>
        </td>
        <td className={`${CELL} text-gray-800 text-lg`}>{money(d.penalties)}</td>
        <td className={CELL} colSpan="2" />
      </tr>
    </>
  );
}

// The one payable net: the pay run's own. Placed after the older net line, which is then only an explanation.
export function PayRunNetRow({ penalty, colSpan = 11 }) {
  const net = payRunNet(penalty);
  if (!net) return null;
  return (
    <tr className={`${net.approved ? "bg-green-50 border-b-2 border-green-600" : "bg-amber-50 border-b-2 border-amber-500"} font-bold`} data-testid="penalty-net-row">
      <td className={CELL} colSpan={colSpan}>
        <Banknote className="inline h-4 w-4 -mt-0.5 mr-1.5" aria-hidden="true" />
        {net.label}
      </td>
      <td className={`${CELL} text-lg ${net.approved ? "text-green-700" : "text-amber-700"}`}>{money(net.net)}</td>
      <td className={CELL} colSpan="2" />
    </tr>
  );
}
