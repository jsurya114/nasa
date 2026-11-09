import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { Gavel } from "lucide-react";
import { rowInfo, showRow, sourceNote } from "./penaltyDisplay.js";

const CELL = "px-3 py-3 border-b border-gray-200 whitespace-nowrap";
const money = (v) => `$${Number(v).toFixed(2)}`;

// One table row just below the insurance deduction (#166): "Penalty & Others" this payday, by how each record was created, with
// what is still owed in all beside it. Only this payday's amount comes off the Net Payment line below. While they load, or if they cannot be loaded, a row says so: the net is then not final.
export default function PenaltyRows({ penalty, colSpan = 11 }) {
  // The records page is for the super admin only; other admins still see the amounts here, without the link.
  const isSuperAdmin = useSelector((state) => state.admin?.isSuperAdmin === true);
  if (!penalty?.expected) return null;
  if (penalty.status === "loading") {
    return (
      <tr className="bg-amber-50" data-testid="penalty-loading-row">
        <td className={CELL} colSpan={colSpan + 3} role="status">Penalty & Others: loading… The net below does not yet include them.</td>
      </tr>
    );
  }
  if (penalty.status === "error") {
    return (
      <tr className="bg-red-50" data-testid="penalty-error-row">
        <td className={CELL} colSpan={colSpan + 3} role="alert">
          Penalty & Others could not be loaded. The net below does not include them, so do not treat it as the amount to pay.
          <button type="button" onClick={penalty.retry} className="ml-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold">Try again</button>
        </td>
      </tr>
    );
  }
  const d = rowInfo(penalty);
  if (!d || !showRow(penalty)) return null;
  const history = `/admin/payroll?cityId=${penalty.cityId}&driverId=${penalty.driverId}`;
  const parts = [d.penalties > 0 && `Penalties ${money(d.penalties)}`, d.other > 0 && `Others ${money(d.other)}`].filter(Boolean).join(" · ");
  return (
    <tr className="bg-amber-50 font-bold" data-testid="penalty-deduction-row">
      <td className={CELL} colSpan={colSpan}>
        <Gavel className="inline h-4 w-4 -mt-0.5 mr-1.5" aria-hidden="true" />
        Penalty &amp; Others
        <span className="ml-2 text-xs font-medium text-gray-600">this payday</span>
        {isSuperAdmin && <Link to={history} className="ml-3 text-sm font-medium text-brand-600 underline">View entries and history</Link>}
        <span className="block text-xs font-normal text-gray-700" data-testid="penalty-owed">
          Still owed in all: {money(d.owed)}{parts && ` (${parts})`}. Not all of it is due this payday.
        </span>
        <span className="block text-xs font-normal text-gray-600" data-testid="penalty-note">
          {sourceNote(d.source)}{d.flags[0] && ` ${d.flags[0].message}.`}
        </span>
      </td>
      <td className={`${CELL} text-red-600 text-lg`}>{d.source === "none" ? "-" : `-${money(d.deducted)}`}</td>
      <td className={CELL} colSpan="2" />
    </tr>
  );
}
