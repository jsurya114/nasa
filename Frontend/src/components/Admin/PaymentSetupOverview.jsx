import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import axios from "../../redux/slice/axiosInstance";
import { SkeletonList } from "../../reuse/Skeleton.jsx";
import EvereeLinkPanel from "./EvereeLinkPanel.jsx";

const LABELS = { "not-started": "Not started", creating: "Finding worker", "in-progress": "In progress", verifying: "Verifying", complete: "Complete", "needs-review": "Needs admin review", "classification-required": "Set driver type", "not-required": "Not required (Desi)", "service-unavailable": "Connection unavailable" };
const NEXT = { "not-started": "Ask the driver to start payment setup in their portal.", creating: "NASA is checking whether Everee created this worker. Do not create another.", "in-progress": "Ask the driver to continue payment setup in their portal.", verifying: "NASA is waiting for verified completion.", complete: "Onboarding is complete.", "needs-review": "Review this driver's Everee identity and link before continuing.", "classification-required": "Set Local or Desi in Users.", "not-required": "Everee onboarding is not required for Desi drivers.", "service-unavailable": "Check the Everee connection in Pay runs." };
const REASONS = { link_not_verified_for_tenant: "The link has not been verified for this Everee company.", previously_unlinked: "An admin unlinked this worker. Review before linking again.", possible_existing_worker: "An existing Everee worker may match. Review the identity first.", ambiguous_worker_identity: "More than one worker matches the saved identity.", no_longer_eligible: "Driver details changed during setup. Review their type and agreement.", worker_already_linked: "This Everee worker is already linked. Review the mapping.", agreement_required: "The driver must sign the NASA agreement first.", contact_changed: "The driver changed their email or phone. Check the new details below, then confirm them. Until then they are not matched to an Everee worker." };
const BUTTON = "min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-brand disabled:opacity-50";
const FIELD = "mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base";
const time = (value) => value ? new Date(value).toLocaleString() : "Not checked yet";

export default function PaymentSetupOverview() {
  const [cities, setCities] = useState([]);
  const [cityId, setCityId] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [citiesError, setCitiesError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setCitiesError(false);
    axios.get("/admin/get-admin-cities", { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setCities(data.cities ?? []);
    }).catch(() => { if (!controller.signal.aborted) setCitiesError(true); });
    return () => controller.abort();
  }, [version]);
  useEffect(() => {
    setResult(null); setError(false);
    if (!cityId) { setLoading(false); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    axios.get("/admin/payroll/everee/onboarding-readiness", { params: { cityId, state, page }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cityId, state, page, version]);
  const refresh = () => setVersion((v) => v + 1);
  const [confirming, setConfirming] = useState(null);
  const [confirmError, setConfirmError] = useState(null);
  // The time the admin was shown goes back with the click: if the driver changed their details again meanwhile, the server refuses.
  const confirmContact = async (driver) => {
    setConfirming(driver.driverId); setConfirmError(null);
    try {
      await axios.post("/admin/payroll/drivers/confirm-contact", { cityId: Number(cityId), driverId: driver.driverId, contactChangedAt: driver.contactChangedAt });
    } catch (error) {
      setConfirmError({ driverId: driver.driverId, message: error.response?.data?.message ?? "The contact details could not be confirmed. Try again." });
    } finally {
      setConfirming(null); refresh();
    }
  };
  const summary = result?.summary;
  return <div className="min-h-dvh bg-canvas text-ink">
    <Header />
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-36">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Driver payment setup</h1><p className="mt-1 text-sm text-ink-muted">See who has finished Everee setup and who needs help. This page does not send payments or turn restrictions on.</p></div>
        <Link to="/admin/payroll" className={BUTTON + " inline-flex items-center"}>Back to Payroll</Link>
      </div>
      <section className="card-surface mt-5 grid gap-4 p-4 sm:grid-cols-2">
        <div><label htmlFor="payment-setup-city" className="text-sm font-medium">City</label><select id="payment-setup-city" className={FIELD} value={cityId} onChange={(e) => { setCityId(e.target.value); setPage(1); }}><option value="">Choose a city</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.job}</option>)}</select></div>
        <div><label htmlFor="payment-setup-status" className="text-sm font-medium">Setup status</label><select id="payment-setup-status" className={FIELD} value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(LABELS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
      </section>
      {citiesError && <p role="alert" className="mt-4">Cities could not be loaded. <button className={BUTTON} onClick={refresh}>Try again</button></p>}
      {!cityId && <p className="card-surface mt-4 p-4 text-sm">Choose a city to check its drivers.</p>}
      {loading && <div className="mt-4"><SkeletonList rows={3} label="Loading payment setup" /></div>}
      {error && <p role="alert" className="card-surface mt-4 p-4 text-red-700">Payment setup could not be loaded. <button className={BUTTON} onClick={refresh}>Try again</button></p>}
      {result && <>
        <section className="card-surface mt-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{result.environment === "sandbox" ? "Sandbox testing" : "Production"} · {result.enforced ? "Restrictions are on" : "Readiness preview · restrictions are off"}</h2><button className={BUTTON} onClick={refresh}>Refresh status</button></div>
          <p className="mt-2 text-sm text-ink-muted">{result.enforced ? "Local drivers need verified onboarding before work or any new payment, including cash." : "These counts show who would be held if restrictions were enabled. Nothing is activated here."}</p>
          {!result.onboardingEnabled && <p className="mt-2 text-sm text-amber-800">Driver setup is not enabled yet. Drivers will not be prompted until it is enabled.</p>}
          {!result.configured && <p role="alert" className="mt-2 text-sm text-red-700">Everee is not configured. Completion cannot be verified.</p>}
          <p className="mt-2 text-xs text-ink-muted">Loaded {time(result.checkedAt)}. Driver checks below show when Everee was last read.</p>
        </section>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Local drivers", summary.localDrivers], ["Setup complete", summary.complete], ["Local drivers needing setup", summary.wouldHold], ["Needs admin review", summary.needsReview]].map(([label, count]) => <section key={label} className="card-surface p-4"><h2 className="text-sm text-ink-muted">{label}</h2><p className="mt-1 text-2xl font-bold">{count}</p></section>)}
        </div>
        <section className="card-surface mt-4 p-4 text-sm"><h2 className="font-semibold">{result.enforced ? "Work and payment checks" : "Before enabling restrictions"}</h2><p className="mt-2">Unclassified drivers: {summary.unclassified} · Drivers with open work: {summary.driversWithOpenWork} · Routes with open work: {summary.openWorkRoutes} · Drivers with outstanding Everee payments: {summary.driversWithOutstandingPayments}</p><p className="mt-2 text-ink-muted">Counts cover all active drivers in this city, regardless of the status filter. Open work is a rough count of work not yet closed in the last 60 days. Review open work and payments first; existing transfers continue to be checked.</p></section>
        <section aria-label="Driver setup statuses" className="mt-4 space-y-3">
          {result.drivers.length === 0 && <p className="card-surface p-4">No drivers match this selection.</p>}
          {result.drivers.map((driver) => <article key={driver.driverId} className="card-surface break-words p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{driver.name}</h2><span className={`rounded-full px-3 py-1 text-xs font-semibold ${driver.state === "complete" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>{LABELS[driver.state] ?? "Needs review"}</span></div>
            <p className="mt-2 text-sm">{REASONS[driver.reason] ?? NEXT[driver.state]}</p>
            {driver.state === "complete" && !driver.paymentReady && <p className="mt-1 text-sm text-amber-900">Onboarding is complete, but Everee payment readiness needs review.</p>}
            {driver.reason === "contact_changed" && driver.contactChangedAt && <dl className="mt-2 rounded-xl bg-amber-50 p-3 text-sm" aria-label="New contact details"><div className="flex flex-wrap gap-x-2"><dt className="font-semibold">New email:</dt><dd className="break-all">{driver.contactEmail || "none"}</dd></div><div className="flex flex-wrap gap-x-2"><dt className="font-semibold">New phone:</dt><dd>{driver.contactPhone || "none"}</dd></div></dl>}
            {driver.reason === "contact_changed" && driver.contactChangedAt && <button className={BUTTON + " mt-3"} disabled={confirming === driver.driverId} onClick={() => confirmContact(driver)}>{confirming === driver.driverId ? "Confirming…" : "Confirm contact details"}</button>}
            {driver.state === "needs-review" && <EvereeLinkPanel driver={driver} cityId={cityId} onChanged={refresh} />}
            {confirmError?.driverId === driver.driverId && <p role="alert" className="mt-2 text-sm text-red-700">{confirmError.message}</p>}
            <p className="mt-2 text-xs text-ink-muted">Last checked: {time(driver.lastCheckedAt)}{driver.openWork ? " · Has open work" : ""}{driver.outstandingPayment ? " · Has an outstanding Everee payment" : ""}</p>
          </article>)}
        </section>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{result.total} matching drivers · Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</p><div className="flex gap-2"><button className={BUTTON} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button><button className={BUTTON} disabled={page * result.pageSize >= result.total} onClick={() => setPage((p) => p + 1)}>Next</button></div></div>
      </>}
    </main><Nav />
  </div>;
}
