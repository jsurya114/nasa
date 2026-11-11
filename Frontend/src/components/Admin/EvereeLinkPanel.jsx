import React, { useState } from "react";
import axios from "../../redux/slice/axiosInstance";

// Look up, Link and Unlink for one Local driver on Driver payment setup (super admin only; the server checks the role and the city again).
// The server decides everything: a worker is linked only from one exact email or phone match, never by name, and a worker that another driver
// (for example an old, disabled record of the same person) still holds is never offered until that link is removed on purpose.

const BUTTON = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand disabled:opacity-50";
const FIELD = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base";
const BASE = "/admin/payroll/everee/workers";
const MIN_REASON = 3;

const NOTHING = {
  no_match: "No Everee worker has this driver's email or phone. If the person already has an Everee account, confirm the correct email and phone with them, update the driver in Users to match, then look up again. A name match is never enough.",
  ambiguous: "More than one Everee worker matches, or the search may be incomplete. Resolve it in Everee first. Nothing can be linked.",
  conflict: "A worker matches on one detail but the other is different. Confirm the right details with the driver before anything is linked.",
};
const BLOCKED = {
  contact_changed: "The driver changed their own email or phone. Confirm the new details first (the button above), then look up again.",
  driver_data: "This driver's own details are incomplete, so they cannot be looked up. Fix the name, email or phone in Users.",
};
const SOURCE = { email: "email", phone: "phone" };

function Candidate({ match }) {
  return (
    <div className="rounded-xl bg-white p-3 text-sm ring-1 ring-line">
      <p className="font-semibold">Everee worker: {[match.firstName, match.lastName].filter(Boolean).join(" ") || "name not shown"}</p>
      <p className="text-ink-muted">Email {match.maskedEmail ?? "not shown"} · Phone {match.maskedPhone ?? "not shown"}</p>
      <p className="text-ink-muted">Matched on {match.matchedOn.map((k) => SOURCE[k] ?? k).join(" and ")}{match.conflicts?.length ? `; different ${match.conflicts.map((k) => SOURCE[k] ?? k).join(" and ")}` : ""}</p>
    </div>
  );
}

export default function EvereeLinkPanel({ driver, cityId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);

  // The reason and the unsettled-payments tick belong to the result that was reviewed: whenever a result is shown, replaced or dropped they start empty again,
  // so a later look-up (maybe a different holder) never inherits what was typed or ticked for the earlier one.
  const showLookup = (result) => { setReason(""); setChecked(false); setLookup(result); };

  const call = async (path, body) => {
    setBusy(true); setError(null);
    try {
      return (await axios.post(`${BASE}/${path}`, body)).data;
    } catch (err) {
      setError(err.response?.data?.message ?? "The request could not be completed. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const look = async () => {
    setOpen(true); setDone(null); showLookup(null);
    const result = await call("lookup", { cityId: Number(cityId), driverId: driver.driverId });
    if (result) showLookup(result);
  };
  const match = lookup?.matches?.[0] ?? null;
  // Removal is offered only for ONE clean match that another record holds (the server sends the link to remove only then). An ambiguous, incomplete or
  // conflicting result is read-only: the admin sees who holds a candidate, nothing more.
  const holder = lookup?.reason === "worker_linked_to_another_driver" && lookup.matches.length === 1 && match.linkedDriver?.linkId ? match.linkedDriver : null;
  const readOnlyHolders = lookup && !holder ? lookup.matches.filter((m) => m.linkedDriver) : [];

  const link = async () => {
    const result = await call("link", { cityId: Number(cityId), driverId: driver.driverId, workerId: match.workerId });
    if (result) { showLookup(null); setDone("Linked. Ask the driver to reopen the app. The status updates once Everee confirms onboarding."); onChanged(); }
  };
  // Removes the link of the OTHER record. The driver is looked up again straight away, so the admin sees the clean match before linking.
  const unlink = async () => {
    // The link that was reviewed goes with the request: if someone changed it since, the server refuses and a fresh look-up is needed.
    const result = await call("unlink", { cityId: holder.cityId, driverId: holder.driverId, linkId: holder.linkId, reason: reason.trim(), acknowledgeOutstanding: checked });
    showLookup(null); // dropped at once, refused or not: a failed follow-up look-up leaves nothing to press, and nothing typed or ticked is kept
    if (!result) return;
    const again = await call("lookup", { cityId: Number(cityId), driverId: driver.driverId });
    if (again) showLookup(again);
  };

  return (
    <div className="mt-3">
      <button type="button" className={BUTTON} onClick={look} disabled={busy}>{busy && !lookup ? "Looking up…" : "Look up in Everee"}</button>
      {done && <p role="status" className="mt-2 rounded-xl bg-green-50 p-3 text-sm text-green-800">{done}</p>}
      {open && lookup && (
        <div role="region" aria-label="Everee look-up result" className="mt-2 space-y-2 rounded-xl bg-canvas p-3 text-sm">
          {lookup.matches?.map((m) => <Candidate key={m.workerId} match={m} />)}
          {lookup.result === "match" && match.linkedTo === "this_driver" && <p>This driver is already linked to that worker.</p>}
          {lookup.result === "match" && !match.linkedTo && (
            <>
              <p>This is the only worker with this driver's email or phone. Check it is the same person, then link it. Nothing is paid or changed in Everee.</p>
              <button type="button" className={BUTTON} onClick={link} disabled={busy}>Link this worker</button>
            </>
          )}
          {readOnlyHolders.length > 0 && (
            <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">
              {readOnlyHolders.map((m) => `${m.firstName ?? "A worker"} ${m.lastName ?? ""} is linked to driver code ${m.linkedDriver.driverCode} (${m.linkedDriver.enabled ? "enabled" : "disabled"})`).join("; ")}.
              {" "}This look-up is not a single clean match, so nothing can be removed or linked from here.
            </p>
          )}
          {holder && (
            <div className="space-y-2">
              <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">
                That worker is still linked to another driver record: <span className="font-semibold">{holder.name}</span> (driver code {holder.driverCode}, {holder.enabled ? "enabled" : "disabled"}).
                If it is the same person, move the link: remove it from that record with a reason, then link it here. That record keeps its history.
              </p>
              {holder.outstandingPayments && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">That record has Everee payments that are not settled yet. Check them in Pay runs before you move the link.</p>}
              <label className="block font-medium" htmlFor={`unlink-reason-${driver.driverId}`}>Why is the link being moved?</label>
              <input id={`unlink-reason-${driver.driverId}`} className={FIELD} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: same person, moved to the active record" />
              {holder.outstandingPayments && <label className="flex min-h-11 items-start gap-2"><input type="checkbox" className="mt-1 h-5 w-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>I checked the unsettled payments and still want to move the link.</span></label>}
              <button type="button" className={BUTTON} onClick={unlink} disabled={busy || reason.trim().length < MIN_REASON || (holder.outstandingPayments && !checked)}>Remove link from that record</button>
            </div>
          )}
          {NOTHING[lookup.result] && <p>{NOTHING[lookup.result]}</p>}
          {lookup.result === "blocked" && lookup.reason !== "worker_linked_to_another_driver" && <p>{BLOCKED[lookup.reason] ?? "This driver cannot be linked."}{lookup.issues?.length ? ` ${lookup.issues.map((i) => i.message).join("; ")}.` : ""}</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
