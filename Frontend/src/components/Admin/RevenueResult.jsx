import React from "react";
import { Link } from "react-router-dom";

// What happened to the GOFO revenue in a weekly upload (issue #252): the same file that stages the pay data is the carrier's statement. The server answers with a
// state ("ready", "updated", "already_imported", "needs_review", "unavailable"), a plain message and any reasons; this only shows them. `importId` is sent to the
// owner only, so the link to the import history appears for the owner alone. English only; admin screen.
const TONE = {
  updated: "text-brand",
  already_imported: "text-ink",
  ready: "text-ink",
  needs_review: "text-amber-800",
  unavailable: "text-ink-muted",
};

export default function RevenueResult({ revenue, title = "GOFO revenue in this file" }) {
  if (!revenue?.state) return null;
  const owner = Boolean(revenue.importId);
  return (
    <section className="card-surface mb-4 p-6" aria-label="GOFO revenue" data-testid="revenue-result">
      <h2 className="mb-2 text-base font-semibold text-ink">{title}</h2>
      <p role={revenue.state === "needs_review" ? "alert" : "status"} className={`text-sm font-semibold ${TONE[revenue.state] ?? "text-ink"}`} data-testid="revenue-message">{revenue.message}</p>
      {revenue.reasons?.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-ink">{revenue.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      {revenue.city && <p className="mt-1 text-sm text-ink-muted">{revenue.city} · {revenue.week}{revenue.deliveryRevenue ? ` · delivery revenue $${revenue.deliveryRevenue}` : ""}</p>}
      {owner && revenue.state === "needs_review" && (
        <p className="mt-2 text-sm text-ink">The saved file is waiting for you: <Link to="/admin/carrier-statements" className="font-semibold text-brand underline">review it in the GOFO import history</Link>. Nothing needs to be uploaded again.</p>
      )}
      <p className="mt-2 text-sm text-ink-muted">Pay, claims and the weekly data are not affected by the revenue check.</p>
    </section>
  );
}
