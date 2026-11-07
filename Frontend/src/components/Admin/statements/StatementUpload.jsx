import React, { useRef, useState } from "react";
import { formatUsd } from "../insights/insightsFormat.js";
import { messageFor, previewStatement, publishStatement } from "./statementsApi.js";
import { STATE_LABELS, canPublish, outcomeText } from "./statementText.js";

const BUTTON = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50";
const PRIMARY = "min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50";

function Line({ label, value, id }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="font-semibold tabular-nums" data-testid={id}>{formatUsd(value)}</dd></div>;
}

// Choose a statement, check it (nothing is stored), read what it would do, then publish. A statement that does not reconcile is refused with every reason.
export default function StatementUpload({ onPublished }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [published, setPublished] = useState(null);

  const choose = (event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setPublished(null); setError(null); };
  const run = async (action) => {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  };
  const check = () => run(async () => { setPublished(null); setPreview(await previewStatement(file)); });
  const publish = () => run(async () => {
    const result = await publishStatement(file);
    setPublished(result);
    if (result.status === "published") { setPreview(null); setFile(null); if (input.current) input.current.value = ""; onPublished(); }
  });

  const m = preview?.matching;
  return (
    <section aria-labelledby="statement-upload-title" className="card-surface space-y-3 p-4 sm:p-5">
      <div>
        <h2 id="statement-upload-title" className="text-lg font-bold text-ink">Add a carrier statement</h2>
        <p className="text-sm text-ink-muted">Choose the GOFO weekly statement (.xlsx) for one city. It is checked against its own totals to the cent first; nothing is stored until you publish, and a statement that does not reconcile is refused.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="statement-file">Carrier statement file</label>
        <input ref={input} id="statement-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose} className="min-h-11 max-w-full text-sm" />
        <button type="button" className={BUTTON} disabled={!file || busy} onClick={check}>Check statement</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {preview?.status === "rejected" && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-testid="statement-rejected">
          <p className="font-semibold">This statement cannot be published.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{preview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}

      {preview?.status === "ready" && (
        <div className="space-y-3 rounded-xl border border-line p-3" data-testid="statement-preview">
          <p className="font-semibold text-ink">{preview.city.name} · {preview.period.label} ({preview.period.start} to {preview.period.end}) · bill {preview.identity.billNumber}</p>
          <p className="text-sm text-ink" data-testid="statement-outcome">{outcomeText(preview.outcome)}</p>
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <Line id="amount-revenue" label="Delivery revenue" value={preview.amounts.deliveryRevenue} />
            <Line id="amount-claims" label="Carrier claims" value={preview.amounts.claims} />
            <Line id="amount-adjustments" label="Ledger adjustments" value={preview.amounts.adjustments} />
            <Line id="amount-payable" label="GOFO settlement payable" value={preview.amounts.settlementPayable} />
            <Line id="amount-matched" label="Matched to NASA's work" value={m.matchedRevenue} />
            <Line id="amount-unallocated" label="Unallocated (matched no driver)" value={m.unallocatedRevenue} />
          </dl>
          {Object.entries(m.states).filter(([state, v]) => state !== "matched" && v.groups > 0).length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-muted" data-testid="statement-unmatched">
              {Object.entries(m.states).filter(([state, v]) => state !== "matched" && v.groups > 0).map(([state, v]) => <li key={state}>{STATE_LABELS[state]}: {v.groups} group{v.groups === 1 ? "" : "s"}, {formatUsd(v.revenue)}. Kept as unallocated revenue.</li>)}
            </ul>
          )}
          {m.nasaOnly.rows > 0 && <p className="text-sm text-ink-muted">{m.nasaOnly.rows} NASA record{m.nasaOnly.rows === 1 ? "" : "s"} ({formatUsd(m.nasaOnly.driverEarnings)} of driver earnings) the carrier did not bill. They count as zero revenue.</p>}
          <button type="button" className={PRIMARY} disabled={!canPublish(preview) || busy} onClick={publish}>Publish statement</button>
        </div>
      )}

      {published && published.status !== "published" && (
        <p role="status" className="text-sm text-ink" data-testid="statement-publish-result">
          {published.status === "already_published" && "This statement was already published. Nothing changed."}
          {published.status === "older_version" && "This is an earlier version of a corrected week. Nothing changed."}
          {published.status === "rejected" && `Not published: ${(published.reasons ?? []).join(" ")}`}
        </p>
      )}
    </section>
  );
}
