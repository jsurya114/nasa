import React, { useCallback, useEffect, useState } from "react";
import { formatUsd } from "../insights/insightsFormat.js";
import { dismissImport, listImports, messageFor, publishImport } from "./statementsApi.js";

const BUTTON = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50";
const PRIMARY = "min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50";

const WHY = {
  check_failed: "The statement in this file did not pass its checks.",
  owner_required: "A city admin added this week's data; company revenue is published by an owner.",
  correction: "It corrects a statement that already stands.",
  older_version: "It is an older version of a week that was corrected since.",
  publish_failed: "Publishing did not finish.",
};

// The weekly uploads whose revenue is waiting for the owner (issue #252). The workbook was saved when it was uploaded under File Upload, so nothing is chosen or
// uploaded again here: Publish checks the saved file once more and stores it, a correction needs its own confirmation, and Dismiss closes it with a reason.
function ImportCard({ item, onDone }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [asking, setAsking] = useState(null); // "correction" | "dismiss"
  const [replacement, setReplacement] = useState(null);
  const [reason, setReason] = useState("");

  const run = async (action) => {
    setBusy(true); setNote(null);
    try { await action(); } catch (error) { setNote(messageFor(error)); } finally { setBusy(false); }
  };
  const askCorrection = (outcome) => { setReplacement(outcome); setAsking("correction"); };
  const publish = (replaces) => run(async () => {
    const result = await publishImport(item.id, replaces);
    if (result.status === "published" || result.status === "already_imported") return onDone(result.status === "published" ? "Revenue updated" : "Already imported");
    if (result.status === "needs_confirmation") return askCorrection(result.outcome);
    if (result.status === "not_open" || result.status === "not_found") return onDone(null);
    setAsking(null);
    return setNote(result.reasons?.length ? result.reasons.join(" ") : "The statement still does not pass its checks.");
  });
  const dismiss = () => run(async () => { await dismissImport(item.id, reason.trim()); onDone("Dismissed"); });

  return (
    <li className="card-surface space-y-2 p-4" data-testid={`import-${item.id}`}>
      <p className="text-sm font-semibold text-ink">{item.city ? `${item.city} · ${item.week}` : item.sourceLabel}</p>
      <p className="text-sm text-ink-muted">{WHY[item.reasonKind] ?? "Needs your review."} Uploaded {new Date(item.uploadedAt).toLocaleDateString("en-US")} as {item.sourceLabel}.</p>
      {item.reasons.length > 0 && <ul className="list-disc pl-5 text-sm text-ink">{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {item.deliveryRevenue && <p className="text-sm text-ink">Delivery revenue {formatUsd(item.deliveryRevenue)}{item.settlementPayable ? ` · settlement ${formatUsd(item.settlementPayable)}` : ""}.</p>}
      {note && <p role="alert" className="text-sm text-red-700">{note}</p>}
      {asking === "correction" && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="group" aria-label="Confirm the correction">
          <p>This replaces version {replacement?.version} of the statement for this week. The earlier version stays in the history.</p>
          <button type="button" className={PRIMARY} disabled={busy || !replacement?.replaces} onClick={() => publish(replacement.replaces)}>Confirm correction</button>
        </div>
      )}
      {asking === "dismiss" && (
        <div className="space-y-2" role="group" aria-label="Dismiss this import">
          <label className="block text-sm text-ink">Why is it being dismissed?
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" maxLength={300} />
          </label>
          <button type="button" className={BUTTON} disabled={busy || reason.trim().length < 5} onClick={dismiss}>Dismiss import</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {item.canPublish && asking !== "correction" && <button type="button" className={PRIMARY} disabled={busy} onClick={() => (item.reasonKind === "correction" && item.outcome?.replaces ? askCorrection(item.outcome) : publish(null))}>{item.reasonKind === "check_failed" ? "Check again" : item.reasonKind === "correction" ? "Review correction" : "Publish"}</button>}
        <button type="button" className={BUTTON} disabled={busy} onClick={() => setAsking(asking === "dismiss" ? null : "dismiss")}>Dismiss</button>
      </div>
    </li>
  );
}

export default function ImportsWaiting({ onChanged }) {
  const [status, setStatus] = useState("loading");
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState(null);
  const [done, setDone] = useState(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    listImports(controller.signal)
      .then((rows) => { if (!controller.signal.aborted) { setItems(rows); setStatus("ready"); } })
      .catch((error) => { if (!controller.signal.aborted) { setMessage(messageFor(error)); setStatus("error"); } });
    return () => controller.abort();
  }, [version]);

  const finished = (text) => { if (text) setDone(text); reload(); onChanged?.(); };

  if (status === "loading") return null;
  if (status === "error") return <p role="alert" className="text-sm text-red-700">{message} <button type="button" className="font-semibold text-brand underline" onClick={() => { setStatus("loading"); reload(); }}>Try again</button></p>;
  return (
    <section aria-labelledby="waiting-title" className="space-y-3" data-testid="imports-waiting">
      <h2 id="waiting-title" className="text-lg font-bold text-ink">Waiting for your review</h2>
      {done && <p role="status" className="text-sm font-semibold text-brand">{done}</p>}
      {items.length === 0
        ? <p className="card-surface p-4 text-sm text-ink-muted" data-testid="imports-empty">No weekly upload is waiting. Uploads are checked and published from File Upload → Weekly.</p>
        : <ul className="space-y-3">{items.map((item) => <ImportCard key={item.id} item={item} onDone={finished} />)}</ul>}
    </section>
  );
}
