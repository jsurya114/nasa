import React from "react";
import { formatMoney } from "../../../utils/money.js";
import { CLAIM_STATUS } from "./claimsApi.js";

// One page of claims. Matched claims name the driver NASA matched; an unmatched claim shows the courier name from the carrier's file, and why it is not matched.
export default function ClaimsTable({ claims, matched }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid="claims-table">
        <thead>
          <tr className="bg-gray-50 text-left">
            {["Waybill", "Date", "Type", "Amount", matched ? "Driver" : "Courier in the file", "City", "Status"].map((head) => (
              <th key={head} scope="col" className="px-3 py-2 border-b border-line font-semibold">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => {
            const status = CLAIM_STATUS[c.status] ?? { label: c.status, tone: "bg-gray-100 text-gray-700", hint: "" };
            return (
              <tr key={c.id} data-testid={`claim-${c.id}`}>
                <td className="px-3 py-2 border-b font-mono text-xs">{c.waybill}</td>
                <td className="px-3 py-2 border-b whitespace-nowrap">{c.claimDate}</td>
                <td className="px-3 py-2 border-b">{c.claimType}</td>
                <td className="px-3 py-2 border-b tabular-nums">{formatMoney(c.amount)}</td>
                <td className="px-3 py-2 border-b">
                  {matched ? (c.driverName ? <>{c.driverName}<span className="ml-1 text-xs text-ink-muted">#{c.driverCode}</span></> : "—") : (c.courierName || "—")}
                </td>
                <td className="px-3 py-2 border-b">{c.city}</td>
                <td className="px-3 py-2 border-b">
                  <span title={status.hint} className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>
                  {c.deducted && <span className="ml-1 inline-flex items-center rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-800">Deducted</span>}
                  {!matched && c.reason && <p className="mt-1 text-xs text-ink-muted">{c.reason}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
