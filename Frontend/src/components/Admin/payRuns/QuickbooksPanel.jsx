import React, { useCallback, useEffect, useState } from "react";
import axios from "../../../redux/slice/axiosInstance";

// QuickBooks for Desi (1099) drivers, for a super admin: whether the backend is set up and connected, a read-only test, and linking each Desi driver of the
// chosen city to their existing QuickBooks vendor. Nothing is paid or changed in QuickBooks here. Secrets never reach this page.

const buttonClass = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand disabled:opacity-50";
const badgeClass = (environment) => `rounded-full px-2 py-0.5 text-xs font-semibold ${environment === "production" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`;
const ISSUES = { no_email: "has no email address", contact_changed: "changed their own email or phone: check the new details below, then confirm them before linking" };
const LOOKUP_TEXT = {
  no_match: "No QuickBooks vendor has this driver's email.",
  ambiguous: "More than one QuickBooks vendor has this driver's email; fix it in QuickBooks first.",
  blocked: "This driver cannot be linked.",
};
const messageOf = (err, fallback) => err.response?.data?.message ?? fallback;

function DriverRow({ driver, cityId, onChanged }) {
  const [lookup, setLookup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const call = async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      return (await axios.post(`/admin/payroll/quickbooks/vendors/${path}`, { cityId: Number(cityId), driverId: driver.driverId, ...body })).data;
    } catch (err) {
      setError(messageOf(err, "The request could not be completed"));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const look = async () => { setLookup(await call("lookup")); };
  // The driver changed their own email or phone. The time shown goes back with the click, so details changed again since are not confirmed unseen.
  const confirmContact = async () => {
    setBusy(true);
    setError(null);
    try {
      await axios.post("/admin/payroll/drivers/confirm-contact", { cityId: Number(cityId), driverId: driver.driverId, contactChangedAt: driver.contactChangedAt });
      onChanged();
    } catch (err) {
      setError(messageOf(err, "The contact details could not be confirmed"));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const link = async () => { if (await call("link", { vendorId: lookup.matches[0].vendorId })) { setLookup(null); onChanged(); } };
  const unlink = async () => {
    const reason = window.prompt(`Why unlink ${driver.name} from QuickBooks?`);
    if (reason && (await call("unlink", { reason }))) onChanged();
  };
  const match = lookup?.result === "match" ? lookup.matches[0] : null;
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{driver.name}</p>
          <p className="text-ink-muted">
            {driver.link ? `Linked to vendor ${driver.link.vendorId}${driver.link.vendor1099 ? "" : " (not marked for 1099 in QuickBooks)"}` : driver.issues.length ? driver.issues.map((i) => ISSUES[i] ?? i).join(", ") : "Not linked"}
          </p>
          {driver.contact && <p className="mt-1 rounded-xl bg-amber-50 p-2 text-amber-900">New email: <span className="break-all font-semibold">{driver.contact.email || "none"}</span> · New phone: <span className="font-semibold">{driver.contact.phone || "none"}</span></p>}
        </div>
        {driver.link && <button type="button" onClick={unlink} disabled={busy} className={buttonClass}>Unlink</button>}
        {!driver.link && driver.issues.includes("contact_changed") && driver.contactChangedAt && <button type="button" onClick={confirmContact} disabled={busy} className={buttonClass}>Confirm contact details</button>}
        {!driver.link && !driver.issues.length && <button type="button" onClick={look} disabled={busy} className={buttonClass}>Look up</button>}
      </div>
      {lookup && !match && <p role="status" className="mt-2 text-ink-muted">{LOOKUP_TEXT[lookup.result] ?? "Nothing was found."}</p>}
      {match && (
        <div role="status" className="mt-2 rounded-xl bg-brand-50 p-3">
          <p>Found vendor <span className="font-semibold">{match.displayName}</span> (ID {match.vendorId}).</p>
          {lookup.warnings?.includes("vendor_not_1099") && <p className="mt-1 text-amber-800">This vendor is not marked for 1099 tracking in QuickBooks, so its payments would be left out of the 1099 report.</p>}
          <button type="button" onClick={link} disabled={busy} className={`mt-2 ${buttonClass}`}>Link this vendor</button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </li>
  );
}

// Which QuickBooks accounts a Desi payment is booked to: the expense account the pay is charged to and the bank account it is recorded from.
function AccountSettings() {
  const [data, setData] = useState(undefined);
  const [expense, setExpense] = useState("");
  const [bank, setBank] = useState("");
  const [note, setNote] = useState(null);
  useEffect(() => {
    axios.get("/admin/payroll/quickbooks/settings").then(({ data: body }) => {
      setData(body);
      setExpense(body.saved?.expenseAccountId ?? "");
      setBank(body.saved?.bankAccountId ?? "");
    }).catch((err) => { setData(null); setNote({ bad: true, text: messageOf(err, "The accounts could not be loaded.") }); });
  }, []);
  const save = async () => {
    setNote(null);
    try {
      await axios.put("/admin/payroll/quickbooks/settings", { expenseAccountId: expense, bankAccountId: bank });
      setNote({ text: "Saved." });
    } catch (err) {
      setNote({ bad: true, text: messageOf(err, "The accounts could not be saved.") });
    }
  };
  if (data === undefined) return null;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-ink">Accounts for Desi payments</h3>
      {data && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">Expense account (the pay is booked here)
            <select value={expense} onChange={(e) => setExpense(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3">
              <option value="">Choose an account</option>
              {data.expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">Cash account (the cash payment is recorded as coming from here)
            <select value={bank} onChange={(e) => setBank(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3">
              <option value="">Choose an account</option>
              {data.bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {data && <button type="button" onClick={save} disabled={!expense || !bank} className={`mt-3 ${buttonClass}`}>Save accounts</button>}
      {note && <p role={note.bad ? "alert" : "status"} className={`mt-2 text-sm ${note.bad ? "text-red-700" : "text-green-700"}`}>{note.text}</p>}
    </div>
  );
}

export default function QuickbooksPanel({ cityId = "" }) {
  const [status, setStatus] = useState(undefined); // undefined: loading, null: could not be loaded
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [vendors, setVendors] = useState(null);

  useEffect(() => {
    axios.get("/admin/payroll/quickbooks/status").then(({ data }) => setStatus(data)).catch(() => setStatus(null));
  }, []);

  const connected = status?.connection?.connected === true;
  const loadVendors = useCallback(() => {
    if (!connected || !cityId) { setVendors(null); return; }
    axios.get("/admin/payroll/quickbooks/vendors", { params: { cityId } }).then(({ data }) => setVendors(data)).catch(() => setVendors(null));
  }, [connected, cityId]);
  useEffect(() => { loadVendors(); }, [loadVendors]);

  const connect = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await axios.post("/admin/payroll/quickbooks/connect");
      window.location.assign(data.url); // QuickBooks' own sign-in page; it returns to the backend, which shows a short confirmation
    } catch (err) {
      setResult({ ok: false, reason: messageOf(err, "The connection could not be started") });
      setBusy(false);
    }
  };
  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult((await axios.post("/admin/payroll/quickbooks/check")).data);
    } catch (err) {
      setResult({ ok: false, reason: messageOf(err, "The test could not be run") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface p-4" aria-labelledby="quickbooks">
      <div className="flex items-center gap-2">
        <h2 id="quickbooks" className="text-base font-semibold text-ink">QuickBooks (Desi drivers)</h2>
        {status?.environment && <span className={badgeClass(status.environment)}>{status.environment === "production" ? "Production" : "Sandbox"}</span>}
      </div>
      {status === undefined && <p className="mt-1 text-sm text-ink-muted">Loading…</p>}
      {status === null && <p role="alert" className="mt-1 text-sm text-red-700">The QuickBooks status could not be loaded.</p>}
      {status && !status.configured && (
        <div className="mt-1 text-sm text-ink-muted">
          <p>QuickBooks is not set up in the backend settings:</p>
          <ul className="mt-1 list-disc pl-5">{(status.problems ?? []).map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {status?.configured && !status.enabled && <p className="mt-1 text-sm text-ink-muted">{status.disabledReason}</p>}
      {status?.enabled && (
        <>
          <p className="mt-1 text-sm text-ink-muted">
            {connected ? `Connected to company ${status.connection.realmId}.${status.connection.needsReconnect ? " The connection expires soon; reconnect it." : ""}` : "Not connected yet."}
            {" "}The test only reads the company name. QuickBooks never pays anyone here: it is only the record for 1099s.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={connect} disabled={busy} className={buttonClass}>{connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}</button>
            {connected && <button type="button" onClick={check} disabled={busy} className={buttonClass}>Test connection</button>}
          </div>
        </>
      )}
      {result && (
        <div role="status" className="mt-3 text-sm">
          {result.ok ? <p className="font-semibold text-green-700">Connected{result.companyName ? ` to ${result.companyName}` : ""}.</p> : <p className="font-semibold text-red-700">Not connected: {result.reason}</p>}
          {result.requestId && <p className="mt-1 text-xs text-ink-muted">QuickBooks request ID (for support): {result.requestId}</p>}
        </div>
      )}
      {connected && status.paymentsEnabled && <AccountSettings />}
      {connected && !cityId && <p className="mt-3 text-sm text-ink-muted">Choose a city below to link its Desi drivers to their QuickBooks vendors.</p>}
      {vendors && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-ink">Desi drivers in this city: {vendors.summary.linked} linked, {vendors.summary.unlinked} not linked, {vendors.summary.blocked} blocked</h3>
          {vendors.drivers.length === 0 ? <p className="mt-1 text-sm text-ink-muted">This city has no Desi drivers.</p> : (
            <ul className="mt-1 divide-y divide-line">{vendors.drivers.map((d) => <DriverRow key={d.driverId} driver={d} cityId={cityId} onChanged={loadVendors} />)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
