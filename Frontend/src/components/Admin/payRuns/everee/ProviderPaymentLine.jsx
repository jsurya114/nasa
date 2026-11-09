import React from "react";
import { ITEM_STATUS } from "./evereeLabels.js";

const STATUS_TEXT = Object.freeze({
  paid: "Transaction successful",
  submitted: "Submitted to Everee",
  unconfirmed: "Unconfirmed at Everee",
  failed: "Not sent to Everee",
});

const when = (value) => (value ? new Date(value).toLocaleString() : null);

// One driver's Everee payment in the shared payment history, beside the manual receipt. A completed Everee payment is confirmed by the system
// from Everee's own records; it is not an admin's manual receipt, and it is never called paid until Everee confirmed the deposit.
export default function ProviderPaymentLine({ payment }) {
  const returned = Boolean(payment.returned);
  const statusText = returned ? ITEM_STATUS.returned.label : (STATUS_TEXT[payment.status] ?? "Everee payment");
  const verificationText = returned ? "original deposit verified by the system" : "verified by the system";
  const details = [
    payment.providerReference && `Reference ${payment.providerReference}`,
    payment.paidOn && `Pay date ${payment.paidOn}`,
    payment.confirmedAt && `Confirmed ${when(payment.confirmedAt)}`,
    payment.requestedByName && `Sent by ${payment.requestedByName}${payment.initiatedAt ? ` on ${when(payment.initiatedAt)}` : ""}`,
    payment.lastCheckedAt && `Last checked ${when(payment.lastCheckedAt)}`,
  ].filter(Boolean);
  return (
    <div aria-label="Everee payment" className={`mt-1 rounded-xl p-2 text-xs ${returned ? "bg-red-50 text-red-700" : "bg-brand-50"}`}>
      <p className="font-semibold">
        {statusText}
        {payment.environment === "sandbox" ? " (sandbox: no real money)" : ""}
        {payment.systemVerified ? ` · ${verificationText}` : ""}
      </p>
      {details.length > 0 && <p className="mt-0.5 text-ink-muted">{details.join(" · ")}</p>}
      {payment.returned && (
        <p role="alert" className="mt-0.5 font-semibold text-red-700">
          A bank returned this deposit. Everee retries it once the driver fixes their bank details; check it before relying on this payment.
        </p>
      )}
      {payment.note && <p className="mt-0.5 text-ink-muted">{payment.note}</p>}
    </div>
  );
}
